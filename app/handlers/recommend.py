import asyncio
import json
import math
import random
import re
import threading
import time
from contextvars import ContextVar
from collections import defaultdict, deque

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import config as cfg
from app.handlers.auth import currentUser, readJsonBody
from utils import db, upstream
from utils.log import get_log_id, _get_real_ip
from utils.rate_limit import allow, allow_redis, reserve_redis

router = APIRouter()

KINDS = ("favorites", "playlists", "history")
MAX_ITEMS = 500
MAX_PLAYLIST_SONGS = 2000
MAX_RECENT = 50
MAX_SIGNALS = 50
MAX_TEXT = 120
MAX_ID = 128
EVENT_TYPES = {
    "play_start", "play_progress", "play_complete", "play_skip",
    "favorite_add", "favorite_remove", "playlist_add",
    "dislike", "dislike_remove",
    "search", "view_song", "view_artist", "view_album",
    "playlist_create", "playlist_update", "playlist_delete", "playlist_play",
}
LIBRARY_EVENT_TYPES = {"favorite_add", "favorite_remove", "playlist_add"}

INFO_EVENT_TYPES = {"search", "view_song", "view_artist", "view_album", "playlist_create", "playlist_update", "playlist_delete", "playlist_play"}
EVENT_MAX_BODY = 64 * 1024
EVENT_MAX_BATCH = 50
EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
EVENT_MAX_PER_USER = 5000
EVENT_RATE_LIMIT = 240
EDGE_MAX_BODY = 32 * 1024
EDGE_MAX_BATCH = 50
EDGE_MAX_PER_USER = 2000
EDGE_PROFILE_LIMIT = 300
_event_rate_lock = threading.Lock()
_event_rate = {}

RECOMMEND_MAX_SEEDS = 8
RECOMMEND_SESSION_MAX = 128
RECOMMEND_STATE_MAX = 4096
RECOMMEND_UPSTREAM_BUDGET = 32
RECOMMEND_UPSTREAM_CONCURRENCY = 8
RECOMMEND_GLOBAL_UPSTREAM_CONCURRENCY = 32
_recommend_state_lock = threading.Lock()
_recommend_state = {}
_recommend_upstream_state = ContextVar("recommend_upstream_state", default=None)
_recommend_upstream_limiter = asyncio.Semaphore(RECOMMEND_GLOBAL_UPSTREAM_CONCURRENCY)


def _resp(req, code, msg, status=200, data=None):
    return JSONResponse(status_code=status, content={"code": code, "msg": msg, "data": data, "logId": get_log_id(req)}, headers={"Cache-Control": "no-store"})


def _text(value, limit):
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if not value or len(value) > limit or any(ord(ch) < 32 or 0xD800 <= ord(ch) <= 0xDFFF for ch in value):
        return ""
    return value


def _id(value):
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return value if 0 <= value <= 9223372036854775807 else ""
    return _text(value, MAX_ID)


def _first_value(item, *keys):
    for key in keys:
        value = item.get(key)
        if value is not None:
            return value
    return None


def _artist_values(song):
    raw = _first_value(song, "artists", "ar")
    if not isinstance(raw, list):
        raw = [song.get("artist")] if song.get("artist") is not None else []
    result = []
    for item in raw[:8]:
        if isinstance(item, dict):
            artist_id = _id(_first_value(item, "id", "artistId"))
            name = _text(_first_value(item, "name", "artist"), MAX_TEXT)
        else:
            artist_id = ""
            name = _text(item, MAX_TEXT)
        if artist_id or name:
            result.append((artist_id, name))
    return result


def _album_value(song):
    raw = _first_value(song, "album", "al")
    if not isinstance(raw, dict):
        raw = {}
    album_id = _id(_first_value(song, "albumId")) or _id(_first_value(raw, "id", "albumId"))
    name = _text(_first_value(raw, "name", "album"), MAX_TEXT)
    if not name and isinstance(song.get("album"), str):
        name = _text(song.get("album"), MAX_TEXT)
    return album_id, name


def _song_info(song):
    if not isinstance(song, dict):
        return None
    song_id = _id(_first_value(song, "id", "songId"))
    if song_id == "":
        return None
    artists = _artist_values(song)
    album_id, album_name = _album_value(song)
    return {
        "id": song_id,
        "artists": artists,
        "album": (album_id, album_name),
        "platform": _text(song.get("platform"), 40) or "unknown",
    }


def _load_rows(userid):
    rows = db.query("SELECT kind, data FROM library WHERE userid = ?", (userid,))
    values = {kind: [] for kind in KINDS}
    for row in rows:
        kind = row.get("kind")
        if kind not in values:
            continue
        try:
            parsed = json.loads(row.get("data", ""))
        except (TypeError, ValueError, RecursionError):
            continue
        if isinstance(parsed, list):
            values[kind] = parsed[:MAX_ITEMS]
    return values


def _add_signal(bucket, key, item, weight, platform):
    if not key:
        return
    current = bucket.get(key)
    if current is None:
        bucket[key] = {"id": item[0] or None, "name": item[1] or None, "platform": platform, "count": 0, "score": 0}
    elif not current.get("name") and item[1]:
        current["name"] = item[1]
    current = bucket[key]
    current["count"] += 1
    current["score"] += weight


def _signal_key(value):
    return ("id:" + str(value[0])) if value[0] else ("name:" + value[1].casefold() if value[1] else "")


def _number(value, limit):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    if not math.isfinite(value) or value < 0 or value > limit:
        return None
    return value


def _event_time(value, now):
    if value is None:
        return now
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    value = int(value)
    if 1_000_000_000 <= value < 100_000_000_000:
        value *= 1000
    if value < now - EVENT_RETENTION_MS or value > now + 5 * 60 * 1000:
        return None
    return value


def _parse_event(item, now):
    if not isinstance(item, dict):
        return None
    event = item.get("event", item.get("type"))
    if not isinstance(event, str) or event not in EVENT_TYPES:
        return None
    nested = item.get("song") if isinstance(item.get("song"), dict) else {}

    def value(*keys):
        for key in keys:
            if key in item and item.get(key) is not None:
                return item.get(key)
            if key in nested and nested.get(key) is not None:
                return nested.get(key)
        return None

    song_id = _id(value("songId", "id"))
    if song_id == "":
        return None
    platform = _text(value("platform", "source"), 40) or "unknown"
    artist_id = _id(value("artistId"))
    artist_name = _text(value("artistName", "artist"), MAX_TEXT)
    if isinstance(value("artist"), dict):
        artist = value("artist")
        artist_id = artist_id or _id(_first_value(artist, "id", "artistId"))
        artist_name = artist_name or _text(_first_value(artist, "name", "artist"), MAX_TEXT)
    album_id = _id(value("albumId"))
    album_name = _text(value("albumName"), MAX_TEXT)
    if isinstance(value("album"), dict):
        album = value("album")
        album_id = album_id or _id(_first_value(album, "id", "albumId"))
        album_name = album_name or _text(_first_value(album, "name", "album"), MAX_TEXT)
    position = _number(value("position", "currentTime"), 86400)
    duration = _number(value("duration"), 86400)
    event_at = _event_time(value("at", "timestamp", "createdAt"), now)
    if event_at is None:
        return None
    if event == "play_progress" and position is None:
        return None
    return {
        "event": event,
        "eventid": _text(item.get("eventId", item.get("event_id")), 80),
        "platform": platform,
        "songid": str(song_id),
        "artistid": str(artist_id) if artist_id != "" else "",
        "artistname": artist_name,
        "albumid": str(album_id) if album_id != "" else "",
        "albumname": album_name,
        "position": position,
        "duration": duration,
        "createdat": event_at,
    }


def _allow_event_rate(userid, amount):
    redis_result = allow_redis(userid, amount, EVENT_RATE_LIMIT, 60)
    if redis_result is not None:
        return redis_result
    if cfg.REDIS_ADDRESS:
        return False
    return _allow_local_event_rate(userid, amount)


def _allow_local_event_rate(userid, amount):
    now = time.monotonic()
    with _event_rate_lock:
        queue = _event_rate.setdefault(userid, deque())
        while queue and now - queue[0] >= 60:
            queue.popleft()
        if len(queue) + amount > EVENT_RATE_LIMIT:
            return False
        queue.extend([now] * amount)
        if len(_event_rate) > 2048:
            for key in list(_event_rate):
                if not _event_rate[key] or now - _event_rate[key][-1] >= 60:
                    _event_rate.pop(key, None)
        return True


def _store_events(userid, events):
    rows = [(
        userid, item["eventid"], item["event"], item["platform"], item["songid"],
        item["artistid"], item["artistname"], item["albumid"], item["albumname"],
        item["position"], item["duration"], item["createdat"],
    ) for item in events]
    db.run_many(
        "INSERT INTO recommend_events(userid,eventid,event,platform,songid,artistid,artistname,albumid,albumname,position,duration,createdat) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", rows,
    )
    cutoff = int(time.time() * 1000) - EVENT_RETENTION_MS
    db.run("DELETE FROM recommend_events WHERE userid = ? AND createdat < ?", (userid, cutoff))
    db.run(
        "DELETE FROM recommend_events WHERE userid = ? AND id NOT IN "
        "(SELECT id FROM recommend_events WHERE userid = ? ORDER BY createdat DESC, id DESC LIMIT ?)",
        (userid, userid, EVENT_MAX_PER_USER),
    )


def _load_events(userid):
    cutoff = int(time.time() * 1000) - EVENT_RETENTION_MS
    return db.query(
        "SELECT event,platform,songid,artistid,artistname,albumid,albumname,position,duration,createdat "
        "FROM recommend_events WHERE userid = ? AND createdat >= ? "
        "ORDER BY createdat DESC, id DESC LIMIT ?",
        (userid, cutoff, EVENT_MAX_PER_USER),
    )


def _parse_edge(item):
    if not isinstance(item, dict):
        return None
    dst = _id(_first_value(item, "dstId", "dst", "to"))
    if dst == "":
        return None
    src = _first_value(item, "srcId", "src", "from")
    if isinstance(src, str) and src.startswith("kw:"):
        keyword = _text(src[3:], 64)
        src = "kw:" + keyword if keyword else ""
    else:
        src = _id(src)
    if not src or src == "":
        return None
    platform = _text(_first_value(item, "platform", "source"), 40) or "unknown"
    seconds = _number(_first_value(item, "seconds", "weight"), 600)
    if seconds is None or seconds <= 0:
        return None
    return {
        "platform": platform,
        "srcid": str(src),
        "dstid": str(dst),
        "weight": round(seconds, 3),
    }


def _store_edges(userid, edges):
    now_ms = int(time.time() * 1000)
    rows = [
        (userid, item["platform"], item["srcid"], item["dstid"], item["weight"], now_ms)
        for item in edges
    ]
    db.run_many(
        "INSERT INTO recommend_edges(userid,platform,srcid,dstid,weight,updatedat) VALUES(?,?,?,?,?,?) "
        "ON CONFLICT(userid,platform,srcid,dstid) DO UPDATE SET "
        "weight = CASE WHEN recommend_edges.weight + excluded.weight > 3600 THEN 3600 "
        "ELSE recommend_edges.weight + excluded.weight END, updatedat = excluded.updatedat", rows,
    )
    cutoff = now_ms - EVENT_RETENTION_MS
    db.run("DELETE FROM recommend_edges WHERE userid = ? AND updatedat < ?", (userid, cutoff))
    db.run(
        "DELETE FROM recommend_edges WHERE userid = ? AND (updatedat, platform, srcid, dstid) NOT IN "
        "(SELECT updatedat, platform, srcid, dstid FROM recommend_edges WHERE userid = ? ORDER BY updatedat DESC LIMIT ?)",
        (userid, userid, EDGE_MAX_PER_USER),
    )


def _load_edges(userid):
    cutoff = int(time.time() * 1000) - EVENT_RETENTION_MS
    return db.query(
        "SELECT platform,srcid,dstid,weight FROM recommend_edges "
        "WHERE userid = ? AND updatedat >= ? "
        "ORDER BY weight DESC, updatedat DESC LIMIT ?",
        (userid, cutoff, EDGE_PROFILE_LIMIT),
    )


def _event_score(item):
    event = item.get("event")
    if event == "play_start":
        return 0.25
    if event == "play_progress":
        duration = item.get("duration") or 0
        position = item.get("position") or 0
        ratio = min(1.0, position / duration) if duration > 0 else 0
        return 0.01 + ratio * 0.02
    if event == "play_complete":
        return 2.5
    if event == "play_skip":
        return -1.25
    if event == "favorite_add":
        return 4.0
    if event == "favorite_remove":
        return -3.0
    if event == "playlist_add":
        return 2.0
    if event == "dislike":
        return -4.0
    if event == "dislike_remove":
        return 4.0
    return 0


def _feedback_profile(events, behavior_types):
    starts = behavior_types.get("play_start", 0)
    completes = behavior_types.get("play_complete", 0)
    skips = behavior_types.get("play_skip", 0)
    favorites = behavior_types.get("favorite_add", 0)
    playlist_adds = behavior_types.get("playlist_add", 0)
    terminal = completes + skips
    completion_rate = completes / terminal if terminal else 0
    skip_rate = skips / terminal if terminal else 0
    favorite_rate = min(1, favorites / starts) if starts else 0
    playlist_rate = min(1, playlist_adds / starts) if starts else 0
    active_events = len(events)
    exploration = 0.2
    if 0 < active_events < 10:
        exploration += 0.08
    if completion_rate >= 0.7 and terminal >= 3:
        exploration += 0.06
    if skip_rate >= 0.5 and terminal >= 3:
        exploration -= 0.08
    if favorite_rate >= 0.2 and starts >= 3:
        exploration += 0.03
    exploration = max(0.08, min(0.35, exploration))
    return {
        "completionRate": round(completion_rate, 4),
        "skipRate": round(skip_rate, 4),
        "favoriteRate": round(favorite_rate, 4),
        "playlistRate": round(playlist_rate, 4),
        "activeEvents": active_events,
        "sampleSize": terminal,
        "exploration": round(exploration, 4),
    }


def _build_profile(userid):
    values = _load_rows(userid)
    events = _load_events(userid)
    edges = _load_edges(userid)
    artists = {}
    albums = {}
    favorite_albums = {}
    behavior_artists = {}
    behavior_albums = {}
    behavior_songs = {}
    behavior_types = defaultdict(int)
    platforms = {}
    favorite_ids = []
    favorite_keys = []
    recent_ids = []
    recent_keys = []
    favorite_count = 0
    history_count = 0
    playlist_count = 0
    playlist_song_count = 0
    playlist_seen = 0

    def add_song(song, weight, save_favorite=False, save_recent=False):
        nonlocal favorite_count, history_count, playlist_song_count
        info = _song_info(song)
        if not info:
            return
        if save_favorite:
            favorite_count += 1
        if save_recent:
            history_count += 1
        if save_favorite and len(favorite_ids) < MAX_ITEMS and info["id"] not in favorite_ids:
            favorite_ids.append(info["id"])
        if save_recent and len(recent_ids) < MAX_RECENT and info["id"] not in recent_ids:
            recent_ids.append(info["id"])
        song_key = f"{info['platform']}:id:{info['id']}"
        if save_favorite and len(favorite_keys) < MAX_ITEMS and song_key not in favorite_keys:
            favorite_keys.append(song_key)
        if save_recent and len(recent_keys) < MAX_RECENT and song_key not in recent_keys:
            recent_keys.append(song_key)
        platform_key = info["platform"]
        platforms[platform_key] = platforms.get(platform_key, 0) + 1
        for artist in info["artists"]:
            _add_signal(artists, f"{platform_key}:{_signal_key(artist)}", artist, weight, platform_key)
        album = info["album"]
        _add_signal(albums, f"{platform_key}:{_signal_key(album)}", album, weight, platform_key)
        if save_favorite:
            _add_signal(favorite_albums, f"{platform_key}:{_signal_key(album)}", album, weight, platform_key)
        playlist_song_count += 1 if weight == 2 else 0

    favorites = values["favorites"]
    for song in favorites:
        raw_song = song.get("rawSong") if isinstance(song, dict) and isinstance(song.get("rawSong"), dict) else song
        add_song(raw_song, 3, save_favorite=True)

    for playlist in values["playlists"]:
        if not isinstance(playlist, dict):
            continue
        playlist_count += 1
        songs = playlist.get("songs")
        if not isinstance(songs, list):
            continue
        for song in songs:
            if playlist_seen >= MAX_PLAYLIST_SONGS:
                break
            playlist_seen += 1
            add_song(song, 2)
        if playlist_seen >= MAX_PLAYLIST_SONGS:
            break

    for song in values["history"]:
        add_song(song, 1, save_recent=True)

    now = int(time.time() * 1000)
    disliked_state = {}
    for event in events:
        score = _event_score(event)
        if not score:
            continue
        behavior_types[event["event"]] += 1
        platform = event.get("platform") or "unknown"
        song_key = f"{platform}:id:{event['songid']}"
        if event["event"] in ("dislike", "dislike_remove") and song_key not in disliked_state:
            disliked_state[song_key] = event["event"] == "dislike"
        if event["event"] in LIBRARY_EVENT_TYPES or event["event"] in INFO_EVENT_TYPES:
            continue
        age = max(0, now - int(event.get("createdat") or now))
        score *= math.pow(0.5, age / (30 * 24 * 60 * 60 * 1000))
        song = behavior_songs.get(song_key)
        if song is None:
            song = {
                "id": event["songid"], "platform": platform, "key": song_key,
                "score": 0, "count": 0,
            }
            behavior_songs[song_key] = song
        song["score"] += score
        song["count"] += 1
        artist = (event.get("artistid") or "", event.get("artistname") or "")
        if artist[0] or artist[1]:
            _add_signal(behavior_artists, f"{platform}:{_signal_key(artist)}", artist, score, platform)
        album = (event.get("albumid") or "", event.get("albumname") or "")
        if album[0] or album[1]:
            _add_signal(behavior_albums, f"{platform}:{_signal_key(album)}", album, score, platform)

    def sort_signals(bucket):
        result = list(bucket.values())
        result.sort(key=lambda item: (-item["score"], -item["count"], item.get("name") or ""))
        return result[:MAX_SIGNALS]

    behavior_song_values = list(behavior_songs.values())
    behavior_song_values.sort(key=lambda item: (-item["score"], -item["count"], item["key"]))
    behavior_song_values = behavior_song_values[:100]
    disliked_keys = sorted(key for key, disliked in disliked_state.items() if disliked)[:500]

    artist_signals = sort_signals(artists)
    feedback = _feedback_profile(events, behavior_types)
    return {
        "favorites": {"count": favorite_count, "ids": favorite_ids, "keys": favorite_keys},
        "playlists": {"count": playlist_count, "songCount": playlist_song_count},
        "history": {"count": history_count},
        "artists": artist_signals,
        "albums": sort_signals(albums),
        "favoriteAlbums": sort_signals(favorite_albums),
        "likedArtists": artist_signals[:20],
        "recentIds": recent_ids,
        "recentKeys": recent_keys,
        "platforms": [{"name": name, "count": count} for name, count in sorted(platforms.items(), key=lambda item: (-item[1], item[0]))[:20]],
        "behavior": {
            "events": len(events),
            "types": dict(behavior_types),
            "artists": sort_signals(behavior_artists),
            "albums": sort_signals(behavior_albums),
            "songs": behavior_song_values,
            "dislikedIds": [key.split(":id:", 1)[1] for key in disliked_keys if ":id:" in key],
            "dislikedKeys": disliked_keys,
        },
        "graph": {
            "edges": [
                {
                    "platform": edge.get("platform") or "unknown",
                    "src": edge.get("srcid") or "",
                    "dst": edge.get("dstid") or "",
                    "weight": round(float(edge.get("weight") or 0), 3),
                }
                for edge in edges
            ],
        },
        "feedback": {
            "completionRate": feedback["completionRate"],
            "skipRate": feedback["skipRate"],
            "favoriteRate": feedback["favoriteRate"],
            "playlistRate": feedback["playlistRate"],
            "activeEvents": feedback["activeEvents"],
            "sampleSize": feedback["sampleSize"],
        },
        "exploration": {"ratio": feedback["exploration"]},
    }


@router.get("/recommend/profile")
async def getProfile(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    if not allow(f"recprofile|user:{user['id']}", RECOMMEND_PROFILE_MAX_PER_MIN, 60):
        return _resp(req, 429, "画像请求过于频繁", 429)
    data = await asyncio.to_thread(_build_profile, user["id"])
    return _resp(req, 0, "ok", data=data)


@router.post("/recommend/events")
async def postEvents(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    body, err = await readJsonBody(req, EVENT_MAX_BODY)
    if err:
        return err
    raw_events = body.get("events") if isinstance(body.get("events"), list) else [body]
    if not raw_events or len(raw_events) > EVENT_MAX_BATCH:
        return _resp(req, 400, "事件数量不合法", 400)
    if not await asyncio.to_thread(_allow_event_rate, user["id"], len(raw_events)):
        return _resp(req, 429, "事件提交过于频繁", 429)
    now = int(time.time() * 1000)
    events = [parsed for item in raw_events if (parsed := _parse_event(item, now))]
    rejected = len(raw_events) - len(events)
    if not events:
        return _resp(req, 400, "没有合法事件", 400, {"accepted": 0, "rejected": rejected})
    try:
        await asyncio.to_thread(_store_events, user["id"], events)
    except Exception:
        return _resp(req, 500, "事件保存失败", 500)
    return _resp(req, 0, "ok", data={"accepted": len(events), "rejected": rejected})


@router.post("/recommend/edges")
async def postEdges(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    body, err = await readJsonBody(req, EDGE_MAX_BODY)
    if err:
        return err
    raw_edges = body.get("edges") if isinstance(body.get("edges"), list) else [body]
    if not raw_edges or len(raw_edges) > EDGE_MAX_BATCH:
        return _resp(req, 400, "边数量不合法", 400)
    if not await asyncio.to_thread(_allow_event_rate, user["id"], len(raw_edges)):
        return _resp(req, 429, "边提交过于频繁", 429)
    edges = [parsed for item in raw_edges if (parsed := _parse_edge(item))]
    rejected = len(raw_edges) - len(edges)
    if not edges:
        return _resp(req, 400, "没有合法边", 400, {"accepted": 0, "rejected": rejected})
    try:
        await asyncio.to_thread(_store_edges, user["id"], edges)
    except Exception:
        return _resp(req, 500, "边保存失败", 500)
    return _resp(req, 0, "ok", data={"accepted": len(edges), "rejected": rejected})


# ===== 后端推荐引擎: 前端 getSimilar/日推的服务端版, 供 /recommend/get 使用 =====

RECOMMEND_PLATFORM = "cloudmusic"
RECOMMEND_LIMIT_DEFAULT = 5
RECOMMEND_LIMIT_MAX = 20
RECOMMEND_MAX_PER_MIN = 150
RECOMMEND_PROFILE_MAX_PER_MIN = 30
RECOMMEND_SOURCE_TTL = 300
RECOMMEND_DETAIL_TTL = 600
RECOMMEND_POOL = 24
RECOMMEND_DETAIL_MAX = 20
RECOMMEND_SOURCE_WEIGHTS = {
    "similar": 1.0,
    "artist": 0.72,
    "new": 0.42,
    "similarArtist": 0.64,
    "hotPlaylist": 0.5,
    "publicPlaylist": 0.38,
    "highQualityPlaylist": 0.46,
    "topPlaylist": 0.42,
}
RECOMMEND_PUBLIC_PLAYLIST_LIMIT = 8
RECOMMEND_PUBLIC_PLAYLIST_PICK = 2
RECOMMEND_PUBLIC_TRACK_LIMIT = 24
RECOMMEND_RIP_OFF_RE = re.compile(r"翻唱|翻录|盗版|dj版|抖音版")
RECOMMEND_INSTRUMENTAL_RE = re.compile(r"伴奏|纯音乐|纯享|卡拉\s*ok|karaoke|instrumental")
RECOMMEND_VARIANT_BRACKET_RE = re.compile(
    r"\s*[（(][^（）()]*\s*(伴奏|纯音乐|纯享|instrumental|卡拉|karaoke|live|remix|remaster|master|钢琴版|吉他版|弦乐版|高音版|低音版|粤语|国语|翻唱|官方)[^（）()]*\s*[)）]\s*")
RECOMMEND_VARIANT_TAIL_RE = re.compile(
    r"\s*(伴奏|纯音乐|纯享版|instrumental|卡拉\s*ok|karaoke|live\s*版?|remix|remaster[a-z]*|钢琴版|吉他版|弦乐版|高音版|低音版|粤语|国语|翻唱|官方)\s*$")
RECOMMEND_VARIANT_YEAR_RE = re.compile(r"\s*\d{4}\s*(版|年度)?\s*$")


def _numeric_id(value):
    text = str(value if value is not None else "").strip()
    return text if text.isdigit() and len(text) <= 15 else ""


def _list_of(data, *keys):
    if not isinstance(data, dict):
        return []
    for scope in (data, data.get("data")):
        if not isinstance(scope, dict):
            continue
        for key in keys:
            value = scope.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


async def _up(path, params, ttl=RECOMMEND_SOURCE_TTL):
    state = _recommend_upstream_state.get()
    if state is None:
        state = {"left": RECOMMEND_UPSTREAM_BUDGET, "semaphore": asyncio.Semaphore(RECOMMEND_UPSTREAM_CONCURRENCY)}
    if state["left"] <= 0:
        return None
    state["left"] -= 1
    try:
        async with state["semaphore"]:
            async with _recommend_upstream_limiter:
                return await upstream.api_get(path, params, ttl=ttl)
    except Exception:
        return None


async def _tracks_of_playlists(playlists, pick_limit=2, track_limit=30):
    playlists = [item for item in playlists if _numeric_id(item.get("id"))] if playlists else []
    if not playlists:
        return []
    picked = random.sample(playlists, min(pick_limit, len(playlists)))
    results = await asyncio.gather(
        *[_up("playlist/track/all", {"id": _numeric_id(item.get("id")), "limit": track_limit}) for item in picked if _numeric_id(item.get("id"))],
        return_exceptions=True)
    songs = []
    for result in results:
        songs.extend(_list_of(result, "songs"))
    return songs


async def _source_similar(song_id):
    return _list_of(await _up("simi/song", {"id": song_id}), "songs")


async def _source_artist_top(artist_id):
    if not artist_id:
        return []
    return _list_of(await _up("artist/top/song", {"id": artist_id}), "songs")


async def _source_new_songs():
    items = _list_of(await _up("personalized/newsong", {"limit": 30}), "result")
    return [item["song"] if isinstance(item.get("song"), dict) else item for item in items]


async def _source_similar_artist(artist_id):
    if not artist_id:
        return []
    artists = _list_of(await _up("simi/artist", {"id": artist_id}), "artists")
    picked = random.sample(artists, min(2, len(artists))) if artists else []
    results = await asyncio.gather(
        *[_source_artist_top(_numeric_id(artist.get("id"))) for artist in picked],
        return_exceptions=True)
    songs = []
    for result in results:
        if isinstance(result, list):
            songs.extend(result)
    return songs


async def _source_hot_playlist():
    data = await _up("top/playlist", {"cat": "华语", "limit": 20, "order": "hot"}, ttl=RECOMMEND_DETAIL_TTL)
    return await _tracks_of_playlists(_list_of(data, "playlists"))


async def _source_public_playlist():
    data = await _up("personalized", {"limit": RECOMMEND_PUBLIC_PLAYLIST_LIMIT}, ttl=RECOMMEND_DETAIL_TTL)
    return await _tracks_of_playlists(
        _list_of(data, "result"), RECOMMEND_PUBLIC_PLAYLIST_PICK, RECOMMEND_PUBLIC_TRACK_LIMIT)


async def _source_high_quality_playlist():
    data = await _up("top/playlist/highquality", {"limit": RECOMMEND_PUBLIC_PLAYLIST_LIMIT}, ttl=RECOMMEND_DETAIL_TTL)
    return await _tracks_of_playlists(
        _list_of(data, "playlists"), RECOMMEND_PUBLIC_PLAYLIST_PICK, RECOMMEND_PUBLIC_TRACK_LIMIT)


async def _source_top_playlist():
    data = await _up("toplist", {}, ttl=RECOMMEND_DETAIL_TTL)
    return await _tracks_of_playlists(
        _list_of(data, "list"), RECOMMEND_PUBLIC_PLAYLIST_PICK, RECOMMEND_PUBLIC_TRACK_LIMIT)


async def _gather_sources(seed_ids, artist_ids, include_explore=False):
    seed_ids = [value for value in seed_ids if value]
    artist_ids = [value for value in artist_ids if value]
    jobs = [("new", _source_new_songs())]
    for seed_id in seed_ids:
        jobs.append(("similar", _source_similar(seed_id)))
    if not seed_ids:
        jobs.append(("hotPlaylist", _source_hot_playlist()))
    if include_explore:
        jobs.extend([
            ("publicPlaylist", _source_public_playlist()),
            ("highQualityPlaylist", _source_high_quality_playlist()),
            ("topPlaylist", _source_top_playlist()),
        ])
    for artist_id in artist_ids:
        jobs.append(("artist", _source_artist_top(artist_id)))
        jobs.append(("similarArtist", _source_similar_artist(artist_id)))
    names = [name for name, _ in jobs]
    results = await asyncio.gather(*[job for _, job in jobs], return_exceptions=True)
    out = []
    for name, result in zip(names, results):
        out.append((name, result if isinstance(result, list) else []))
    return out


def _key_of(item):
    platform = _text(item.get("platform"), 40) or RECOMMEND_PLATFORM
    value = (_id(item.get("id")), _text(item.get("name"), MAX_TEXT))
    return platform + ":" + _signal_key(value)


def _song_keys(song):
    song_id = _numeric_id(_first_value(song, "id", "songId"))
    if not song_id:
        return []
    return [song_id, f"{RECOMMEND_PLATFORM}:id:{song_id}"]


def _artist_keys(song):
    keys = []
    for artist_id, name in _artist_values(song):
        if artist_id != "":
            keys.append(f"{RECOMMEND_PLATFORM}:id:{artist_id}")
        if name:
            keys.append(f"{RECOMMEND_PLATFORM}:name:{name.casefold()}")
    return keys


def _album_keys(song):
    album_id, name = _album_value(song)
    keys = []
    if album_id != "":
        keys.append(f"{RECOMMEND_PLATFORM}:id:{album_id}")
    if name:
        keys.append(f"{RECOMMEND_PLATFORM}:name:{name.casefold()}")
    return keys


def _score_map(items):
    result = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        try:
            score = float(item.get("score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        result[_key_of(item)] = score
    return result


def _scoped_numeric_ids(values, keys):
    ids = {str(value) for value in (values or []) if value not in (None, "")}
    keys = {str(value) for value in (keys or []) if value not in (None, "")}
    if not keys:
        return ids
    scoped = {
        key.split(":id:", 1)[1]
        for key in keys
        if key.startswith(f"{RECOMMEND_PLATFORM}:id:") and key.split(":id:", 1)[1]
    }
    return ids & scoped


def _recommend_signals(profile):
    profile = profile if isinstance(profile, dict) else {}
    favorites = profile.get("favorites") if isinstance(profile.get("favorites"), dict) else {}
    behavior = profile.get("behavior") if isinstance(profile.get("behavior"), dict) else {}
    graph = profile.get("graph") if isinstance(profile.get("graph"), dict) else {}
    recent_keys = {str(value) for value in (profile.get("recentKeys") or [])}
    disliked_keys = {str(value) for value in (behavior.get("dislikedKeys") or [])}
    favorite_keys = {str(value) for value in (favorites.get("keys") or [])}
    played = recent_keys | _scoped_numeric_ids(profile.get("recentIds"), recent_keys)
    disliked = disliked_keys | _scoped_numeric_ids(behavior.get("dislikedIds"), disliked_keys)
    favorite = favorite_keys | _scoped_numeric_ids(favorites.get("ids"), favorite_keys)
    behavior_songs = {}
    for item in (behavior.get("songs") or []):
        if not isinstance(item, dict):
            continue
        key = _text(item.get("key"), MAX_ID)
        if key:
            try:
                behavior_songs[key] = float(item.get("score") or 0)
            except (TypeError, ValueError):
                continue
    edges = defaultdict(dict)
    for edge in (graph.get("edges") or []):
        if not isinstance(edge, dict):
            continue
        dst = _numeric_id(edge.get("dst"))
        src = _text(edge.get("src"), MAX_ID)
        if not dst or not src:
            continue
        platform = _text(edge.get("platform"), 40) or RECOMMEND_PLATFORM
        try:
            weight = float(edge.get("weight") or 0)
        except (TypeError, ValueError):
            continue
        key = f"{platform}:id:{dst}"
        if weight > edges[key].get(src, 0):
            edges[key][src] = weight
    return {
        "played": played,
        "disliked": disliked,
        "favorite": favorite,
        "liked_artists": {_key_of(item) for item in (profile.get("likedArtists") or []) if isinstance(item, dict)},
        "favorite_albums": {_key_of(item) for item in (profile.get("favoriteAlbums") or []) if isinstance(item, dict)},
        "behavior_songs": behavior_songs,
        "behavior_artists": _score_map(behavior.get("artists")),
        "behavior_albums": _score_map(behavior.get("albums")),
        "edges": edges,
        "recent_src": {str(value) for value in (profile.get("recentKeys") or [])},
        "recent_artists": {},
    }


def _song_text(song):
    alias = song.get("alia")
    parts = [str(song.get("name") or "")]
    if isinstance(alias, list):
        parts.extend(str(item) for item in alias)
    return " ".join(parts).casefold()


def _hotness(song):
    try:
        pop = max(0.0, float(song.get("pop") or song.get("popularity") or 0))
    except (TypeError, ValueError):
        pop = 0.0
    try:
        plays = max(0.0, float(song.get("playCount") or song.get("pc") or 0))
    except (TypeError, ValueError):
        plays = 0.0
    score = min(0.3, pop / 100 * 0.3)
    if plays > 0:
        score += min(0.2, math.log10(plays + 1) / 8 * 0.2)
    return score


def _behavior_score(scores, keys, limit):
    raw = 0.0
    found = False
    for key in keys:
        try:
            value = float(scores.get(key) or 0)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(value):
            continue
        if not found or abs(value) > abs(raw) or (abs(value) == abs(raw) and value > raw):
            raw = value
            found = True
    scaled = raw if raw < 0 else math.log2(1 + raw)
    return max(-limit, min(limit, scaled))


def _edge_boost(signals, keys, cap):
    boost = 0.0
    for key in keys:
        for src, weight in (signals["edges"].get(key) or {}).items():
            if src.startswith("kw:") or src in signals["recent_src"]:
                boost = max(boost, min(cap, weight / 240))
    return boost


def _variant_key(song):
    base = re.sub(r"\s+", " ", RECOMMEND_VARIANT_YEAR_RE.sub("", RECOMMEND_VARIANT_TAIL_RE.sub(
        "", RECOMMEND_VARIANT_BRACKET_RE.sub("", str(song.get("name") or "").strip().casefold())))).strip()
    names = sorted({name.casefold() for _, name in _artist_values(song) if name})
    return (base or _numeric_id(song.get("id"))) + "#" + "|".join(names)


def _collapse_variants(items):
    seen = set()
    result = []
    for item in items:
        key = _variant_key(item["song"])
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _pick_diverse(items, limit):
    picked, deferred = [], []
    artist_counts, album_counts = defaultdict(int), defaultdict(int)

    def bump(item):
        for artist_id in item["artists"]:
            artist_counts[artist_id] += 1
        for album_id in item["albums"]:
            album_counts[album_id] += 1

    def over_cap(item):
        if any(artist_counts.get(artist_id, 0) >= 2 for artist_id in item["artists"]):
            return True
        return any(album_counts.get(album_id, 0) >= 2 for album_id in item["albums"])

    for item in items:
        if over_cap(item):
            deferred.append(item)
        else:
            picked.append(item)
            bump(item)
    result = picked[:limit]
    for item in deferred:
        if len(result) >= limit:
            break
        if not over_cap(item):
            result.append(item)
            bump(item)
    if len(result) < limit:
        for item in deferred:
            if len(result) >= limit:
                break
            if item not in result:
                result.append(item)
    return result[:limit]


def _recommend_state_for(owner, session_id):
    today = time.strftime("%Y%m%d", time.localtime())
    key = owner
    with _recommend_state_lock:
        state = _recommend_state.get(key)
        if not state or state.get("day") != today:
            state = {"day": today, "day_seen": set(), "sessions": {}}
            _recommend_state[key] = state
        sessions = state["sessions"]
        seen = sessions.get(session_id)
        if seen is None:
            seen = set()
            sessions[session_id] = seen
        if len(sessions) > RECOMMEND_SESSION_MAX:
            for old in list(sessions)[:len(sessions) - RECOMMEND_SESSION_MAX]:
                sessions.pop(old, None)
        if len(_recommend_state) > RECOMMEND_STATE_MAX:
            for old in list(_recommend_state)[:len(_recommend_state) - RECOMMEND_STATE_MAX]:
                _recommend_state.pop(old, None)
        return set(state["day_seen"]) | set(seen)


def _mark_recommend_state(owner, session_id, song_ids):
    if not song_ids:
        return
    today = time.strftime("%Y%m%d", time.localtime())
    key = owner
    with _recommend_state_lock:
        state = _recommend_state.setdefault(key, {"day": today, "day_seen": set(), "sessions": {}})
        if state.get("day") != today:
            state["day"] = today
            state["day_seen"] = set()
            state["sessions"] = {}
        session = state["sessions"].setdefault(session_id, set())
        state["day_seen"].update(song_ids)
        session.update(song_ids)
        if len(state["day_seen"]) > MAX_ITEMS * 10:
            state["day_seen"] = set(list(state["day_seen"])[-MAX_ITEMS * 10:])


def _reserve_recommend_candidates(owner, session_id, candidates, limit):
    today = time.strftime("%Y%m%d", time.localtime())
    key = owner
    with _recommend_state_lock:
        state = _recommend_state.get(key)
        if not state or state.get("day") != today:
            state = {"day": today, "day_seen": set(), "sessions": {}}
            _recommend_state[key] = state
        session = state["sessions"].setdefault(session_id, set())
        seen = set(state["day_seen"]) | set(session)
        selected = []
        picked = set()
        for item in candidates:
            song_id = str(item.get("id") or "")
            if not song_id or song_id in seen or song_id in picked:
                continue
            picked.add(song_id)
            selected.append(item)
            if len(selected) >= limit:
                break
        state["day_seen"].update(picked)
        session.update(picked)
        if len(state["day_seen"]) > MAX_ITEMS * 10:
            state["day_seen"] = set(list(state["day_seen"])[-MAX_ITEMS * 10:])
        if len(session) > MAX_ITEMS * 10:
            session.difference_update(set(list(session)[:-MAX_ITEMS * 10]))
        return selected


def _recommend_day_ttl():
    now = time.time()
    current = time.localtime(now)
    next_day = time.mktime((current.tm_year, current.tm_mon, current.tm_mday + 1, 0, 0, 0, 0, 0, -1))
    return max(60, int(next_day - now) + 60)


def _reserve_candidates(owner, session_id, candidates, limit):
    if not candidates:
        return []
    if not cfg.REDIS_ADDRESS:
        return _reserve_recommend_candidates(owner, session_id, candidates, limit)
    today = time.strftime("%Y%m%d", time.localtime())
    values = [str(item.get("id") or "") for item in candidates if item.get("id")]
    selected_ids = reserve_redis(
        f"day:{today}:{owner}",
        f"session:{today}:{owner}:{session_id}",
        values,
        limit,
        _recommend_day_ttl(),
    )
    if selected_ids is None:
        return None
    selected = set(selected_ids)
    return [item for item in candidates if str(item.get("id") or "") in selected][:limit]


def _familiarity_score(sources):
    if "similar" in sources:
        return 0.7
    if "similarArtist" in sources:
        return 0.5
    if "artist" in sources:
        return 0.45
    if "hotPlaylist" in sources or "new" in sources:
        return 0.15
    return 0.1


def _rank_candidates(sources, signals, seed_artist_keys, recent_artists, excluded=None, familiarity=0.5):
    excluded = excluded or set()
    candidates = {}
    for name, songs in sources:
        weight = RECOMMEND_SOURCE_WEIGHTS.get(name, 0.5)
        for song in songs:
            keys = _song_keys(song)
            if not keys:
                continue
            if any(key in excluded or key in signals["played"] or key in signals["disliked"] for key in keys):
                continue
            entry = candidates.get(keys[0])
            if entry is None:
                entry = {"song": song, "id": keys[0], "sources": set(), "weight": 0,
                         "artists": _artist_keys(song), "albums": _album_keys(song)}
                candidates[keys[0]] = entry
            entry["sources"].add(name)
            entry["weight"] = max(entry["weight"], weight)
    items = []
    for entry in candidates.values():
        song = entry["song"]
        text = _song_text(song)
        score = entry["weight"]
        if "similar" in entry["sources"]:
            score += 0.34
        if RECOMMEND_RIP_OFF_RE.search(text):
            score -= 0.35
        if RECOMMEND_INSTRUMENTAL_RE.search(text):
            score -= 1.2
        if seed_artist_keys and any(key in seed_artist_keys for key in entry["artists"]):
            score += 0.18
        if any(key in signals["liked_artists"] for key in entry["artists"]):
            score += 0.24
        if any(key in signals["favorite"] for key in _song_keys(song)):
            score += 0.3
        if any(key in signals["favorite_albums"] for key in entry["albums"]):
            score += 0.16
        score += _behavior_score(signals["behavior_songs"], [f"{RECOMMEND_PLATFORM}:id:{entry['id']}"], 4) * 0.16
        score += _behavior_score(signals["behavior_artists"], entry["artists"], 4) * 0.1
        score += _behavior_score(signals["behavior_albums"], entry["albums"], 4) * 0.08
        score += _edge_boost(signals, _song_keys(song), 0.3)
        score += _hotness(song)
        score += min(0.08, (len(entry["sources"]) - 1) * 0.04)
        recent = max([recent_artists.get(key, 0) for key in entry["artists"]] or [0])
        score -= min(0.42, recent * 0.14)
        score *= max(0.15, 1.0 - abs(_familiarity_score(entry["sources"]) - familiarity))
        score += random.uniform(-0.035, 0.035)
        entry["score"] = score
        items.append(entry)
    random.shuffle(items)
    items.sort(key=lambda item: item["score"], reverse=True)
    items = _collapse_variants(items)
    direct = _pick_diverse([item for item in items if "similar" in item["sources"]], 19)
    explore = _pick_diverse([item for item in items if "similar" not in item["sources"]], 8)
    selected = []
    direct_index = explore_index = 0
    while len(selected) < RECOMMEND_POOL and (direct_index < len(direct) or explore_index < len(explore)):
        for _ in range(2):
            if direct_index < len(direct) and len(selected) < RECOMMEND_POOL:
                selected.append(direct[direct_index])
                direct_index += 1
        if explore_index < len(explore) and len(selected) < RECOMMEND_POOL:
            selected.append(explore[explore_index])
            explore_index += 1
        if direct_index >= len(direct):
            while explore_index < len(explore) and len(selected) < RECOMMEND_POOL:
                selected.append(explore[explore_index])
                explore_index += 1
    pool = _pick_diverse(selected, RECOMMEND_POOL)
    head = pool[:8]
    random.shuffle(head)
    return head + pool[8:]


def _out_song(song):
    album_raw = _first_value(song, "al", "album")
    album = album_raw if isinstance(album_raw, dict) else {}
    try:
        duration = int(float(song.get("dt") or song.get("duration") or 0))
    except (TypeError, ValueError):
        duration = 0
    try:
        pop = int(float(song.get("pop") or song.get("popularity") or 0))
    except (TypeError, ValueError):
        pop = 0
    return {
        "id": _numeric_id(_first_value(song, "id", "songId")),
        "name": str(song.get("name") or "")[:MAX_TEXT],
        "ar": [{"id": artist_id, "name": name} for artist_id, name in _artist_values(song)],
        "al": {
            "id": _numeric_id(album.get("id")) or _numeric_id(_first_value(song, "albumId")),
            "name": str(album.get("name") or "")[:MAX_TEXT],
            "picUrl": str(album.get("picUrl") or "")[:500],
        },
        "dt": duration,
        "pop": pop,
        "platform": RECOMMEND_PLATFORM,
    }


def _needs_detail(song):
    if not song.get("name") or not _artist_values(song):
        return True
    album_raw = _first_value(song, "al", "album")
    album = album_raw if isinstance(album_raw, dict) else {}
    if not str(album.get("picUrl") or ""):
        return True
    return not (song.get("dt") or song.get("duration"))


async def _enrich_details(picks):
    if not picks:
        return picks
    missing = [item for item in picks if _needs_detail(item["song"])]
    ids = [_numeric_id(item["song"].get("id")) for item in missing[:RECOMMEND_DETAIL_MAX]]
    ids = [value for value in ids if value]
    if not ids:
        return picks
    data = await _up("song/detail", {"ids": ",".join(ids)}, ttl=RECOMMEND_DETAIL_TTL)
    detail = {str(item.get("id")): item for item in _list_of(data, "songs")}
    for item in picks:
        full = detail.get(str(item["id"]))
        if not full:
            continue
        merged = dict(full)
        for key, value in item["song"].items():
            if value not in (None, "", [], {}):
                merged.setdefault(key, value)
        item["song"] = merged
    return picks


async def _recent_artist_counts(profile):
    recent_keys = {str(value) for value in (profile.get("recentKeys") or [])}
    ids = []
    for value in (profile.get("recentIds") or []):
        song_id = _numeric_id(value)
        if not song_id or (recent_keys and f"{RECOMMEND_PLATFORM}:id:{song_id}" not in recent_keys):
            continue
        ids.append(song_id)
        if len(ids) >= 8:
            break
    if not ids:
        return {}
    data = await _up("song/detail", {"ids": ",".join(ids)}, ttl=RECOMMEND_DETAIL_TTL)
    counts = {}
    for song in _list_of(data, "songs"):
        for key in _artist_keys(song):
            counts[key] = counts.get(key, 0) + 1
    return counts


def _pick_seeds(profile):
    seeds = []
    recent_keys = {str(value) for value in (profile.get("recentKeys") or [])}
    favorite_keys = {
        str(value) for value in ((profile.get("favorites") or {}).get("keys") or [])
    } if isinstance(profile.get("favorites"), dict) else set()

    def add(values, keys):
        for value in values:
            song_id = _numeric_id(value)
            if not song_id:
                continue
            if keys and f"{RECOMMEND_PLATFORM}:id:{song_id}" not in keys:
                continue
            seeds.append(song_id)

    add(profile.get("recentIds") or [], recent_keys)
    favorites = profile.get("favorites") if isinstance(profile.get("favorites"), dict) else {}
    add(favorites.get("ids") or [], favorite_keys)
    return list(dict.fromkeys(seeds))[:RECOMMEND_MAX_SEEDS]


def _pick_seed(profile):
    seeds = _pick_seeds(profile)
    return seeds[0] if seeds else ""


async def _seed_artist_id(seed_id):
    artists = await _seed_artist_ids([seed_id] if seed_id else [])
    return artists[0] if artists else ""


async def _seed_artist_ids(seed_ids):
    seed_ids = list(dict.fromkeys(value for value in seed_ids if value))
    if not seed_ids:
        return []
    data = await _up("song/detail", {"ids": ",".join(seed_ids)}, ttl=RECOMMEND_DETAIL_TTL)
    songs = _list_of(data, "songs")
    found = {str(item.get("id")): item for item in songs if _numeric_id(item.get("id"))}
    artists = []
    for seed_id in seed_ids:
        song = found.get(seed_id)
        if not song:
            continue
        values = _artist_values(song)
        if values and values[0][0] != "":
            artists.append(str(values[0][0]))
    return list(dict.fromkeys(artists))


def _parse_recommend_ids(req):
    raw = req.query_params.get("ids")
    if raw is None or raw.strip() == "":
        raw = req.query_params.get("seed") or ""
    values = [part.strip() for part in raw.split(",") if part.strip()]
    if len(values) > RECOMMEND_MAX_SEEDS or any(not _numeric_id(value) for value in values):
        return None
    return list(dict.fromkeys(_numeric_id(value) for value in values))


def _client_profile(req):
    raw = req.query_params.get("profile") or ""
    if len(raw) > 16000:
        return {}
    try:
        profile = json.loads(raw)
    except (TypeError, ValueError, RecursionError):
        return {}
    if not isinstance(profile, dict):
        return {}
    def values(section, key, limit=120):
        value = section.get(key) if isinstance(section, dict) else []
        return value[:limit] if isinstance(value, list) else []
    favorites = profile.get("favorites") if isinstance(profile.get("favorites"), dict) else {}
    behavior = profile.get("behavior") if isinstance(profile.get("behavior"), dict) else {}
    recent_ids = values(profile, "recentIds", 50)
    recent_keys = values(profile, "recentKeys", 50)
    liked_artists = values(profile, "likedArtists")
    albums = values(profile, "albums")
    favorite_albums = values(profile, "favoriteAlbums")
    history_songs = values(profile, "historySongs", 50)
    playlist_songs = values(profile, "playlistSongs", 80)
    def add_client_song(song, recent):
        info = _song_info(song)
        if not info:
            return
        if recent:
            if len(recent_ids) < 50 and info["id"] not in recent_ids:
                recent_ids.append(info["id"])
            song_key = f"{info['platform']}:id:{info['id']}"
            if len(recent_keys) < 50 and song_key not in recent_keys:
                recent_keys.append(song_key)
        for artist in info["artists"]:
            liked_artists.append({"id": artist[0], "name": artist[1], "platform": info["platform"]})
        album_id, album_name = info["album"]
        if album_id or album_name:
            albums.append({"id": album_id, "name": album_name, "platform": info["platform"]})
    for song in history_songs:
        add_client_song(song, True)
    for song in playlist_songs:
        add_client_song(song, False)
    return {
        "favorites": {"ids": values(favorites, "ids"), "keys": values(favorites, "keys")},
        "recentIds": recent_ids,
        "recentKeys": recent_keys,
        "likedArtists": liked_artists[:120],
        "albums": albums[:120],
        "favoriteAlbums": favorite_albums[:120],
        "behavior": {
            "dislikedIds": values(behavior, "dislikedIds", 100),
            "dislikedKeys": values(behavior, "dislikedKeys", 100),
            "songs": values(behavior, "songs", 100),
            "artists": values(behavior, "artists", 100),
            "albums": values(behavior, "albums", 100),
        },
        "graph": {"edges": values((profile.get("graph") or {}), "edges", 100)} if isinstance(profile.get("graph"), dict) else {},
    }


def _recommend_session(req, user):
    raw = req.query_params.get("session_id") or ""
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", raw):
        raw = "default"
    owner = f"user:{user['id']}" if user else f"anon:{_get_real_ip(req)}"
    return owner, raw


@router.get("/recommend/get")
async def getRecommend(req: Request):
    token = _recommend_upstream_state.set({
        "left": RECOMMEND_UPSTREAM_BUDGET,
        "semaphore": asyncio.Semaphore(RECOMMEND_UPSTREAM_CONCURRENCY),
    })
    try:
        return await _get_recommend(req)
    finally:
        _recommend_upstream_state.reset(token)


async def _get_recommend(req: Request):
    log_id = get_log_id(req)
    rate_key = "recget|" + _get_real_ip(req)
    if not allow(rate_key, RECOMMEND_MAX_PER_MIN, 60):
        return _resp(req, 429, "请求过于频繁", 429)
    try:
        limit = int(req.query_params.get("limit") or RECOMMEND_LIMIT_DEFAULT)
    except ValueError:
        limit = RECOMMEND_LIMIT_DEFAULT
    limit = max(1, min(RECOMMEND_LIMIT_MAX, limit))
    user = currentUser(req)
    explicit_ids = _parse_recommend_ids(req)
    if explicit_ids is None:
        return _resp(req, 400, "种子歌曲不合法", 400)
    profile = await asyncio.to_thread(_build_profile, user["id"]) if user else _client_profile(req)
    seed_ids = explicit_ids or _pick_seeds(profile)
    seed_ids = list(dict.fromkeys(value for value in seed_ids if value))[:RECOMMEND_MAX_SEEDS]
    if explicit_ids:
        data = await _up("song/detail", {"ids": ",".join(seed_ids)}, ttl=RECOMMEND_DETAIL_TTL)
        if data is None:
            return _resp(req, 502, "推荐上游暂不可用", 502, data={"songs": [], "degraded": True, "seed": seed_ids[0] if seed_ids else "", "logId": log_id})
        valid_ids = {str(item.get("id")) for item in _list_of(data, "songs") if _numeric_id(item.get("id"))}
        if not valid_ids or any(value not in valid_ids for value in seed_ids):
            return _resp(req, 400, "种子歌曲不存在", 400)
    signals = _recommend_signals(profile)
    for seed_id in seed_ids:
        signals["played"].update(_song_keys({"id": seed_id}))
    artist_ids = await _seed_artist_ids(seed_ids)
    owner, session_id = _recommend_session(req, user)
    excluded = _recommend_state_for(owner, session_id)
    try:
        familiarity = float(req.query_params.get("familiarity") or 0.5)
    except (TypeError, ValueError):
        familiarity = 0.5
    familiarity = max(0.0, min(1.0, familiarity))
    include_explore = not seed_ids
    sources, recent_artists = await asyncio.gather(
        _gather_sources(seed_ids, artist_ids, include_explore=include_explore),
        _recent_artist_counts(profile),
    )
    signals["recent_artists"] = recent_artists
    seed_artist_keys = [f"{RECOMMEND_PLATFORM}:id:{artist_id}" for artist_id in artist_ids]
    ranked = _rank_candidates(sources, signals, seed_artist_keys, recent_artists, excluded, familiarity)
    if len(ranked) < limit and any(songs for _, songs in sources) and not include_explore:
        fallback = await _gather_sources([], [], include_explore=True)
        sources.extend(fallback)
        ranked = _rank_candidates(sources, signals, seed_artist_keys, recent_artists, excluded, familiarity)
    picks = _reserve_candidates(owner, session_id, ranked, limit)
    if picks is None:
        return _resp(req, 503, "推荐状态暂不可用", 503, data={"songs": [], "degraded": True, "seed": seed_ids[0] if seed_ids else "", "logId": log_id})
    picks = await _enrich_details(picks)
    if not picks and not any(songs for _, songs in sources):
        return _resp(req, 502, "推荐上游暂不可用", 502, data={"songs": [], "degraded": True, "seed": seed_ids[0] if seed_ids else "", "logId": log_id})
    return _resp(req, 0, "ok", data={
        "songs": [_out_song(item["song"]) for item in picks],
        "seed": seed_ids[0] if seed_ids else "",
        "ids": seed_ids,
        "personalized": bool(user or profile),
        "degraded": len(picks) < limit,
        "sources": {name: sum(len(items) for source_name, items in sources if source_name == name) for name in {name for name, _ in sources}},
        "logId": log_id,
    })
