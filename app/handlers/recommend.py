import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.handlers.auth import currentUser
from utils import db
from utils.log import get_log_id

router = APIRouter()

KINDS = ("favorites", "playlists", "history")
MAX_ITEMS = 500
MAX_PLAYLIST_SONGS = 2000
MAX_RECENT = 50
MAX_SIGNALS = 50
MAX_TEXT = 120
MAX_ID = 128


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


def _build_profile(userid):
    values = _load_rows(userid)
    artists = {}
    albums = {}
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

    def sort_signals(bucket):
        result = list(bucket.values())
        result.sort(key=lambda item: (-item["score"], -item["count"], item.get("name") or ""))
        return result[:MAX_SIGNALS]

    artist_signals = sort_signals(artists)
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
    }


@router.get("/recommend/profile")
async def getProfile(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    data = await asyncio.to_thread(_build_profile, user["id"])
    return _resp(req, 0, "ok", data=data)
