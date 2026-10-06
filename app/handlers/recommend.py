import asyncio
import json
import math
import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.handlers.auth import currentUser, readJsonBody
from utils import db
from utils.log import get_log_id
from utils.rate_limit import allow_redis

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
}
EVENT_MAX_BODY = 64 * 1024
EVENT_MAX_BATCH = 50
EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
EVENT_MAX_PER_USER = 5000
EVENT_RATE_LIMIT = 240
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


def _event_score(item):
    event = item.get("event")
    if event == "play_start":
        return 0.25
    if event == "play_progress":
        duration = item.get("duration") or 0
        position = item.get("position") or 0
        ratio = min(1.0, position / duration) if duration > 0 else 0
        return 0.3 + ratio * 0.5
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
    for event in events:
        score = _event_score(event)
        if not score:
            continue
        age = max(0, now - int(event.get("createdat") or now))
        score *= math.pow(0.5, age / (30 * 24 * 60 * 60 * 1000))
        behavior_types[event["event"]] += 1
        platform = event.get("platform") or "unknown"
        song_key = f"{platform}:id:{event['songid']}"
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
