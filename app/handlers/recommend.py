import asyncio
import json
import math
import random
import re
import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.handlers.auth import currentUser, readJsonBody
from utils import db, upstream
from utils.log import get_log_id, _get_real_ip
from utils.rate_limit import allow_local, allow_redis

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
        userid, item["event"], item["platform"], item["songid"],
        item["artistid"], item["artistname"], item["albumid"], item["albumname"],
        item["position"], item["duration"], item["createdat"],
    ) for item in events]
    db.run_many(
        "INSERT INTO recommend_events(userid,event,platform,songid,artistid,artistname,albumid,albumname,position,duration,createdat) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)", rows,
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
RECOMMEND_SOURCE_TTL = 300
RECOMMEND_DETAIL_TTL = 600
RECOMMEND_POOL = 24
RECOMMEND_DETAIL_MAX = 20
RECOMMEND_SOURCE_WEIGHTS = {
    "similar": 1.0,
    "artist": 0.72,
    "new": 0.42,
    "similarArtist": 0.64,
    "similarPlaylist": 0.6,
    "hotPlaylist": 0.5,
}
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
    try:
        return await upstream.api_get(path, params, ttl=ttl)
    except Exception:
        return None


async def _tracks_of_playlists(playlists):
    if not playlists:
        return []
    picked = random.sample(playlists, min(2, len(playlists)))
    results = await asyncio.gather(
        *[_up("playlist/track/all", {"id": _numeric_id(item.get("id")), "limit": 30}) for item in picked if _numeric_id(item.get("id"))],
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


async def _gather_sources(seed_id, artist_id):
    jobs = [("new", _source_new_songs())]
    if seed_id:
        jobs.append(("similar", _source_similar(seed_id)))
        jobs.append(("similarPlaylist", _tracks_of_playlists(_list_of(await _up("simi/playlist", {"id": seed_id}), "playlists"))))
    else:
        jobs.append(("hotPlaylist", _source_hot_playlist()))
    if artist_id:
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


def _recommend_signals(profile):
    profile = profile if isinstance(profile, dict) else {}
    favorites = profile.get("favorites") if isinstance(profile.get("favorites"), dict) else {}
    behavior = profile.get("behavior") if isinstance(profile.get("behavior"), dict) else {}
    graph = profile.get("graph") if isinstance(profile.get("graph"), dict) else {}
    played = {str(value) for value in (profile.get("recentKeys") or [])}
    played.update(str(value) for value in (profile.get("recentIds") or []))
    disliked = {str(value) for value in (behavior.get("dislikedKeys") or [])}
    disliked.update(str(value) for value in (behavior.get("dislikedIds") or []))
    favorite = {str(value) for value in (favorites.get("keys") or [])}
    favorite.update(str(value) for value in (favorites.get("ids") or []))
    behavior_songs = {}
    for item in (behavior.get("songs") or []):
        if not isinstance(item, dict):
            continue
        key = _text(item.get("key"), MAX_ID)
        if key:
            behavior_songs[key] = float(item.get("score") or 0)
    edges = defaultdict(dict)
    for edge in (graph.get("edges") or []):
        if not isinstance(edge, dict):
            continue
        dst = _numeric_id(edge.get("dst"))
        src = _text(edge.get("src"), MAX_ID)
        if not dst or not src:
            continue
        platform = _text(edge.get("platform"), 40) or RECOMMEND_PLATFORM
        weight = float(edge.get("weight") or 0)
        key = f"{platform}:id:{dst}"
        if weight > edges[key].get(src, 0):
            edges[key][src] = weight
    return {
        "played": played,
        "disliked": disliked,
        "favorite": favorite,
        "liked_artists": {_key_of(item) for item in (profile.get("likedArtists") or []) if isinstance(item, dict)},
        "favorite_albums": {_key_of(item) for item in (profile.get("albums") or []) if isinstance(item, dict)},
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
    for key in keys:
        value = scores.get(key) or 0
        if value > raw:
            raw = float(value)
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


def _rank_candidates(sources, signals, seed_artist_keys, recent_artists):
    candidates = {}
    for name, songs in sources:
        weight = RECOMMEND_SOURCE_WEIGHTS.get(name, 0.5)
        for song in songs:
            keys = _song_keys(song)
            if not keys:
                continue
            if any(key in signals["played"] or key in signals["disliked"] for key in keys):
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
        score = entry["weight"] + (0.34 if "similar" in entry["sources"] else 0)
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
    ids = [_numeric_id(value) for value in (profile.get("recentIds") or [])][:8]
    ids = [value for value in ids if value]
    if not ids:
        return {}
    data = await _up("song/detail", {"ids": ",".join(ids)}, ttl=RECOMMEND_DETAIL_TTL)
    counts = {}
    for song in _list_of(data, "songs"):
        for key in _artist_keys(song):
            counts[key] = counts.get(key, 0) + 1
    return counts


def _pick_seed(profile):
    for value in (profile.get("recentIds") or []):
        song_id = _numeric_id(value)
        if song_id:
            return song_id
    favorites = profile.get("favorites") if isinstance(profile.get("favorites"), dict) else {}
    ids = [_numeric_id(value) for value in (favorites.get("ids") or [])]
    ids = [value for value in ids if value]
    return random.choice(ids) if ids else ""


async def _seed_artist_id(seed_id):
    if not seed_id:
        return ""
    data = await _up("song/detail", {"ids": seed_id}, ttl=RECOMMEND_DETAIL_TTL)
    songs = _list_of(data, "songs")
    if not songs:
        return ""
    artists = _artist_values(songs[0])
    return str(artists[0][0]) if artists and artists[0][0] != "" else ""


@router.get("/recommend/get")
async def getRecommend(req: Request):
    log_id = get_log_id(req)
    if not allow_local("recget|" + _get_real_ip(req), RECOMMEND_MAX_PER_MIN, 60):
        return _resp(req, 429, "请求过于频繁", 429)
    try:
        limit = int(req.query_params.get("limit") or RECOMMEND_LIMIT_DEFAULT)
    except ValueError:
        limit = RECOMMEND_LIMIT_DEFAULT
    limit = max(1, min(RECOMMEND_LIMIT_MAX, limit))
    user = currentUser(req)
    profile = await asyncio.to_thread(_build_profile, user["id"]) if user else {}
    seed_id = _numeric_id(req.query_params.get("seed")) or _pick_seed(profile)
    signals = _recommend_signals(profile)
    if seed_id:
        signals["played"].update(_song_keys({"id": seed_id}))
    artist_id = await _seed_artist_id(seed_id)
    sources, recent_artists = await asyncio.gather(
        _gather_sources(seed_id, artist_id),
        _recent_artist_counts(profile),
    )
    signals["recent_artists"] = recent_artists
    seed_artist_keys = [f"{RECOMMEND_PLATFORM}:id:{artist_id}"] if artist_id else []
    ranked = _rank_candidates(sources, signals, seed_artist_keys, recent_artists)
    picks = await _enrich_details(ranked[:limit])
    return _resp(req, 0, "ok", data={
        "songs": [_out_song(item["song"]) for item in picks],
        "seed": seed_id,
        "personalized": bool(user),
        "sources": {name: len(songs) for name, songs in sources},
        "logId": log_id,
    })
