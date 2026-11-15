import asyncio
import json
import secrets
import threading
import time
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import config as cfg
from app.handlers.auth import currentUser
from utils import db, security
from utils.log import a, get_log_id, _get_real_ip
from utils.rate_limit import allow

router = APIRouter()

GUEST_NAME_PREFIX = "__guest_"
CLAIM_MAX_LIBRARY_BYTES = 2 * 1024 * 1024
CLAIM_MAX_PLAYLIST_SONGS = 2000
CLAIM_MAX_HISTORY = 200
CLAIM_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
CLAIM_EVENT_MAX = 5000
CLAIM_EDGE_RETENTION_MS = CLAIM_EVENT_RETENTION_MS
CLAIM_EDGE_MAX = 2000
CLAIM_EDGE_WEIGHT_MAX = 3600.0
_cleanup_lock = threading.Lock()
_cleanup_at = 0.0


def _resp(req, code, msg, status=200, data=None):
    return JSONResponse(status_code=status, content={"code": code, "msg": msg, "data": data, "logId": get_log_id(req)},
                        headers={"Cache-Control": "no-store"})


def _token_values(req):
    values = []
    cookie = req.cookies.get(cfg.GUEST_COOKIE)
    if cookie:
        values.append(cookie)
    header = req.headers.get(cfg.GUEST_TOKEN_HEADER)
    if header:
        header = header.strip()
        if header and header not in values and len(header) <= 200:
            values.append(header)
    return values


def _guest_by_token(token, allow_claimed=False):
    if not isinstance(token, str) or not token or len(token) > 200:
        return None
    sql = (
        "SELECT t.tokenkey, t.userid AS id, t.claimedat, t.claimtarget, u.lastseen "
        "FROM guest_tokens t JOIN users u ON u.id = t.userid "
        "WHERE t.tokenkey = ? AND t.expiresat > ? AND u.isguest = 1"
    )
    args = [security.tokenKey(token), int(time.time())]
    if not allow_claimed:
        sql += " AND t.claimedat = 0"
    return db.get(sql, tuple(args))


def _guest_by_any_token(token):
    if not isinstance(token, str) or not token or len(token) > 200:
        return None
    return db.get(
        "SELECT t.tokenkey, t.userid AS id, t.claimedat, t.claimtarget "
        "FROM guest_tokens t JOIN users u ON u.id = t.userid "
        "WHERE t.tokenkey = ? AND u.isguest = 1",
        (security.tokenKey(token),),
    )


def _touch_guest(userid):
    now = int(time.time())
    try:
        db.run(
            "UPDATE users SET lastseen = ? WHERE id = ? AND isguest = 1 AND lastseen < ?",
            (now, userid, now - cfg.GUEST_LAST_SEEN_SECONDS),
        )
    except Exception:
        pass


def _extend_guest_token(tokenkey):
    now = int(time.time())
    try:
        db.run(
            "UPDATE guest_tokens SET expiresat = ?, lastseen = ? WHERE tokenkey = ? AND claimedat = 0",
            (now + cfg.GUEST_TTL_SECONDS, now, tokenkey),
        )
    except Exception:
        pass


def _rotate_guest_token(tokenkey):
    now = int(time.time())
    for _ in range(3):
        token = security.newToken()
        try:
            count = db.run_rowcount(
                "UPDATE guest_tokens SET tokenkey = ?, expiresat = ?, lastseen = ? "
                "WHERE tokenkey = ? AND claimedat = 0",
                (security.tokenKey(token), now + cfg.GUEST_TTL_SECONDS, now, tokenkey),
            )
        except Exception as error:
            if type(error).__name__ not in ("IntegrityError", "UniqueViolation"):
                raise
            continue
        if count:
            return token
    return ""


def _create_guest_token(userid):
    now = int(time.time())
    for _ in range(3):
        token = security.newToken()
        try:
            db.run(
                "INSERT INTO guest_tokens(tokenkey, userid, expiresat, createdat, lastseen) "
                "VALUES(?,?,?,?,?)",
                (security.tokenKey(token), userid, now + cfg.GUEST_TTL_SECONDS, now, now),
            )
            return token
        except Exception as error:
            if type(error).__name__ not in ("IntegrityError", "UniqueViolation"):
                raise
    return ""


def _insert_guest_user(pass_hash, salt):
    now = int(time.time())
    for _ in range(3):
        username = GUEST_NAME_PREFIX + secrets.token_hex(16)
        try:
            return db.run(
                "INSERT INTO users(username, pass, salt, createdat, nickname, isguest, lastseen) "
                "VALUES(?,?,?,?,?,?,?)",
                (username, pass_hash, salt, now, "游客", 1, now),
            )
        except Exception as error:
            if type(error).__name__ not in ("IntegrityError", "UniqueViolation"):
                raise
    return 0


def _set_guest_cookie(resp, token):
    resp.set_cookie(
        cfg.GUEST_COOKIE, token,
        max_age=cfg.GUEST_TTL_SECONDS, httponly=True,
        samesite="lax", secure=cfg.SESSION_COOKIE_SECURE, path="/",
    )


def _same_origin(req):
    origin = req.headers.get("origin")
    if origin:
        hosts = (req.headers.get("host", ""), req.headers.get("x-forwarded-host", ""))
        for host in hosts:
            if host and origin in (f"https://{host}", f"http://{host}"):
                return True
        return False
    site = req.headers.get("sec-fetch-site")
    if site and site not in ("same-origin", "none"):
        return False
    return True


def currentPrincipal(req):
    user = currentUser(req)
    if user:
        return user
    for token in _token_values(req):
        row = _guest_by_token(token)
        if row:
            _touch_guest(row["id"])
            return {"id": row["id"], "username": "", "isguest": 1}
    return None


def _guest_has_data(userid):
    for row in db.query("SELECT data FROM library WHERE userid = ?", (userid,)):
        try:
            value = json.loads(row["data"])
        except (TypeError, ValueError):
            continue
        if value:
            return True
    for sql in (
        "SELECT 1 FROM recommend_events WHERE userid = ? LIMIT 1",
        "SELECT 1 FROM recommend_edges WHERE userid = ? LIMIT 1",
    ):
        if db.get(sql, (userid,)):
            return True
    return False


@router.post("/guest/ensure")
async def ensureGuest(req: Request):
    if not cfg.GUEST_ENABLED:
        return _resp(req, 404, "游客账户未开启", 404)
    if not _same_origin(req):
        return _resp(req, 403, "来源不合法", 403)
    if not allow("guestensure|" + _get_real_ip(req), 120, 60):
        return _resp(req, 429, "游客请求过于频繁", 429)
    user = currentUser(req)
    if user:
        return _resp(req, 0, "ok", data={"userId": user["id"], "isGuest": False, "hasData": False})
    mirror = req.query_params.get("mirror") == "1"
    for token in _token_values(req):
        row = _guest_by_token(token)
        if not row:
            continue
        _touch_guest(row["id"])
        new_token = ""
        if mirror or token != req.cookies.get(cfg.GUEST_COOKIE):
            new_token = _rotate_guest_token(row["tokenkey"])
        else:
            _extend_guest_token(row["tokenkey"])
        resp = _resp(req, 0, "ok", data={"guestId": row["id"], "isGuest": True, "hasData": _guest_has_data(row["id"]), "token": new_token})
        _set_guest_cookie(resp, new_token or token)
        maybe_cleanup()
        return resp
    if not allow("guest|" + _get_real_ip(req), cfg.GUEST_CREATE_MAX_PER_IP, cfg.GUEST_CREATE_WINDOW_SECONDS):
        return _resp(req, 429, "创建游客过于频繁", 429)
    dk, salt = await asyncio.to_thread(security.hashPass, security.newToken())
    userid = await asyncio.to_thread(_insert_guest_user, dk, salt)
    if not userid:
        return _resp(req, 500, "创建游客失败", 500)
    token = _create_guest_token(userid)
    if not token:
        try:
            _delete_guest(userid)
        except Exception:
            pass
        return _resp(req, 500, "创建游客失败", 500)
    resp = _resp(req, 0, "ok", data={"guestId": userid, "isGuest": True, "hasData": False, "token": token})
    _set_guest_cookie(resp, token)
    maybe_cleanup()
    return resp


@router.get("/guest/me")
async def guestMe(req: Request):
    user = currentUser(req)
    if user:
        return _resp(req, 0, "ok", data={"userId": user["id"], "isGuest": False, "hasData": False})
    for token in _token_values(req):
        row = _guest_by_token(token)
        if row:
            _touch_guest(row["id"])
            return _resp(req, 0, "ok", data={"guestId": row["id"], "isGuest": True, "hasData": _guest_has_data(row["id"])})
    return _resp(req, 401, "没有游客身份", 401)


@router.post("/guest/claim")
async def claimGuest(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    if not cfg.GUEST_ENABLED:
        return _resp(req, 404, "游客账户未开启", 404)
    if not allow("guestclaim|" + _get_real_ip(req), 30, 60):
        return _resp(req, 429, "合并过于频繁", 429)
    tokens = list(reversed(_token_values(req)))
    if not tokens:
        return _resp(req, 400, "没有游客身份", 400)
    code = 404
    msg = "游客身份不存在"
    data = None
    for token in tokens:
        try:
            code, msg, data = await asyncio.to_thread(_claim_guest, token, user["id"])
        except Exception as error:
            a(f"guest claim failed: uid={user['id']} {type(error).__name__}: {error}", "WARN")
            return _resp(req, 500, "合并失败", 500)
        if code != 404:
            break
    if code:
        return _resp(req, code, msg, code)
    resp = _resp(req, 0, "ok", data=data or {})
    resp.delete_cookie(cfg.GUEST_COOKIE, path="/")
    return resp


@router.delete("/guest")
async def deleteGuest(req: Request):
    if not allow("guestdel|" + _get_real_ip(req), 10, 60):
        return _resp(req, 429, "操作过于频繁", 429)
    row = None
    for token in reversed(_token_values(req)):
        row = _guest_by_any_token(token)
        if row:
            break
    if not row:
        resp = _resp(req, 0, "ok", data={"deleted": False})
        resp.delete_cookie(cfg.GUEST_COOKIE, path="/")
        return resp
    try:
        await asyncio.to_thread(_delete_guest, row["id"])
    except Exception as error:
        a(f"guest delete failed: id={row['id']} {type(error).__name__}: {error}", "WARN")
        return _resp(req, 500, "删除失败", 500)
    resp = _resp(req, 0, "ok", data={"deleted": True})
    resp.delete_cookie(cfg.GUEST_COOKIE, path="/")
    return resp


def _claim_guest(token, target_id):
    now = int(time.time())
    now_ms = now * 1000
    with db.transaction() as tx:
        sql = "SELECT tokenkey, userid AS id, claimedat, claimtarget FROM guest_tokens WHERE tokenkey = ?"
        if tx.pg:
            sql += " FOR UPDATE"
        row = tx.get(sql, (security.tokenKey(token),))
        if not row:
            return 404, "游客身份不存在", None
        if int(row["claimedat"] or 0):
            if int(row["claimtarget"] or 0) == target_id:
                return 0, "ok", {"alreadyClaimed": True}
            return 409, "游客数据已合并到其他账号", None
        if int(row["id"]) == target_id:
            return 400, "不能合并到游客自己", None
        guest = tx.get("SELECT id FROM users WHERE id = ? AND isguest = 1", (row["id"],))
        if not guest:
            return 404, "游客身份不存在", None
        tx.run("UPDATE users SET lastseen = ? WHERE id = ? AND isguest = 1", (now, row["id"]))
        tx.run(
            "UPDATE guest_tokens SET claimedat = ?, claimtarget = ?, lastseen = ? "
            "WHERE tokenkey = ? AND claimedat = 0",
            (now, target_id, now, row["tokenkey"]),
        )
        counts = _merge_guest_data(tx, int(row["id"]), target_id, now_ms)
        tx.run("DELETE FROM playlist_shares WHERE userid = ?", (row["id"],))
        tx.run("DELETE FROM library WHERE userid = ?", (row["id"],))
        tx.run("DELETE FROM recommend_events WHERE userid = ?", (row["id"],))
        tx.run("DELETE FROM recommend_edges WHERE userid = ?", (row["id"],))
        tx.run("UPDATE users SET lastseen = ? WHERE id = ? AND isguest = 1", (now, row["id"]))
        return 0, "ok", {"alreadyClaimed": False, "counts": counts}


def _load_library(tx, userid):
    values = {kind: {"data": None, "updatedAt": 0} for kind in ("favorites", "playlists", "history")}
    for row in tx.query("SELECT kind, data, updatedat FROM library WHERE userid = ?", (userid,)):
        if row["kind"] not in values:
            continue
        try:
            data = json.loads(row["data"])
        except (TypeError, ValueError):
            data = None
        values[row["kind"]] = {"data": data, "updatedAt": int(row["updatedat"] or 0)}
    return values


def _write_library(tx, userid, kind, data, updated_at):
    raw = json.dumps(data, ensure_ascii=False)
    tx.run(
        "INSERT INTO library(userid, kind, data, updatedat) VALUES(?,?,?,?) "
        "ON CONFLICT(userid, kind) DO UPDATE SET data = excluded.data, updatedat = excluded.updatedat",
        (userid, kind, raw, updated_at),
    )


def _merge_guest_data(tx, guest_id, target_id, now_ms):
    target_lib = _load_library(tx, target_id)
    guest_lib = _load_library(tx, guest_id)
    counts = {}
    for kind in ("favorites", "playlists", "history"):
        target = target_lib[kind]
        guest = guest_lib[kind]
        guest_data = guest["data"] if isinstance(guest["data"], list) else []
        if not guest_data:
            counts[kind] = {"added": 0, "skipped": 0}
            continue
        target_data = target["data"] if isinstance(target["data"], list) else []
        if kind == "favorites":
            merged, skipped = _merge_favorites(target_data, guest_data)
        elif kind == "playlists":
            merged, skipped = _merge_playlists(target_data, guest_data, target_id)
        else:
            merged, skipped = _merge_history(target_data, guest_data)
        updated_at = max(target["updatedAt"], guest["updatedAt"], now_ms) + 1
        _write_library(tx, target_id, kind, merged, updated_at)
        counts[kind] = {"added": max(0, len(merged) - len(target_data)), "skipped": skipped}
    counts["events"] = _merge_events(tx, guest_id, target_id, now_ms)
    counts["edges"] = _merge_edges(tx, guest_id, target_id, now_ms)
    return counts


def _json_bytes(value):
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


def _fit_list(items, keep, limit):
    result = list(items)
    skipped = 0
    while len(result) > keep and _json_bytes(result) > limit:
        drop = max(1, (len(result) - keep) // 10)
        del result[-drop:]
        skipped += drop
    if len(result) > keep and _json_bytes(result) > limit:
        skipped += len(result) - keep
        result = result[:keep]
    return result, skipped


def _library_song_key(song):
    if not isinstance(song, dict):
        return ""
    platform = str(song.get("platform") or "cloudmusic").strip()[:40] or "cloudmusic"
    value = song.get("id")
    if value is None:
        value = song.get("songId")
    song_id = str(value if value is not None else "").strip()
    return f"{platform}:id:{song_id}" if song_id else ""


def _song_fingerprint(song):
    if not isinstance(song, dict):
        return ""
    return "|".join([
        str(song.get("name") or ""),
        str(song.get("artist") or ""),
        str(song.get("album") or ""),
    ])


def _played_at(item):
    if not isinstance(item, dict):
        return 0.0
    try:
        return float(item.get("playedAt") or 0)
    except (TypeError, ValueError):
        return 0.0


def _fill_missing(target, source):
    for key, value in source.items():
        if key in ("songs", "userId", "uuid"):
            continue
        if key == "rawSong" and isinstance(value, dict):
            raw = target.get("rawSong")
            if not isinstance(raw, dict):
                target["rawSong"] = value
                continue
            for sub_key, sub_value in value.items():
                if sub_key not in raw or raw.get(sub_key) in (None, "", [], {}):
                    raw[sub_key] = sub_value
            continue
        if key not in target or target.get(key) in (None, "", [], {}):
            target[key] = value


def _merge_favorites(target, guest):
    result = []
    index = {}
    for item in target:
        if not isinstance(item, dict):
            continue
        key = _library_song_key(item)
        if key and key in index:
            continue
        result.append(item)
        if key:
            index[key] = item
    keep = len(result)
    for item in guest:
        if not isinstance(item, dict):
            continue
        key = _library_song_key(item)
        if not key:
            continue
        current = index.get(key)
        if current is not None:
            _fill_missing(current, item)
            continue
        result.append(item)
        index[key] = item
    return _fit_list(result, keep, CLAIM_MAX_LIBRARY_BYTES)


def _merge_history(target, guest):
    values = {}
    for item in target:
        if not isinstance(item, dict):
            continue
        key = _library_song_key(item)
        if key and key not in values:
            values[key] = item
    for item in guest:
        if not isinstance(item, dict):
            continue
        key = _library_song_key(item)
        if not key:
            continue
        current = values.get(key)
        if current is None:
            values[key] = item
        elif _played_at(item) > _played_at(current):
            values[key] = item
        else:
            _fill_missing(current, item)
    result = list(values.values())
    result.sort(key=_played_at, reverse=True)
    result = result[:CLAIM_MAX_HISTORY]
    return _fit_list(result, 0, CLAIM_MAX_LIBRARY_BYTES)


def _playlist_keys(playlist):
    keys = []
    if not isinstance(playlist, dict):
        return keys
    uuid_value = str(playlist.get("uuid") or "").strip()
    if uuid_value:
        keys.append("u:" + uuid_value)
    id_value = playlist.get("id")
    if id_value not in (None, ""):
        keys.append("i:" + str(id_value))
    return keys


def _playlist_fingerprint(playlist):
    if not isinstance(playlist, dict):
        return ""
    songs = playlist.get("songs") if isinstance(playlist.get("songs"), list) else []
    ids = sorted(str(song.get("id")) for song in songs if isinstance(song, dict) and song.get("id") is not None)
    name = str(playlist.get("name") or "")
    create_time = str(playlist.get("createTime") or "")
    if not name and not ids:
        return ""
    return "|".join([name, create_time, ",".join(ids)])


def _playlist_song_key(song):
    key = _library_song_key(song)
    return key or _song_fingerprint(song)


def _merge_playlist_songs(target, guest):
    target_songs = target.get("songs") if isinstance(target.get("songs"), list) else []
    guest_songs = guest.get("songs") if isinstance(guest.get("songs"), list) else []
    result = []
    seen = set()
    for song in target_songs:
        key = _playlist_song_key(song)
        if key and key in seen:
            continue
        result.append(song)
        if key:
            seen.add(key)
    for song in guest_songs:
        key = _playlist_song_key(song)
        if key and key in seen:
            continue
        result.append(song)
        if key:
            seen.add(key)
        if len(result) >= CLAIM_MAX_PLAYLIST_SONGS:
            break
    target["songs"] = result[:CLAIM_MAX_PLAYLIST_SONGS]


def _merge_playlists(target, guest, target_userid):
    result = []
    by_uuid = {}
    by_id = {}
    by_fp = {}
    for playlist in target:
        if not isinstance(playlist, dict):
            continue
        result.append(playlist)
        for key in _playlist_keys(playlist):
            table = by_uuid if key.startswith("u:") else by_id
            table.setdefault(key[2:], playlist)
        fingerprint = _playlist_fingerprint(playlist)
        if fingerprint:
            by_fp.setdefault(fingerprint, playlist)
    keep = len(result)
    for playlist in guest:
        if not isinstance(playlist, dict):
            continue
        match = None
        for key in _playlist_keys(playlist):
            table = by_uuid if key.startswith("u:") else by_id
            match = table.get(key[2:])
            if match:
                break
        if match is None:
            fingerprint = _playlist_fingerprint(playlist)
            if fingerprint:
                match = by_fp.get(fingerprint)
        if match is not None:
            _fill_missing(match, playlist)
            _merge_playlist_songs(match, playlist)
            match["userId"] = target_userid
            continue
        if not playlist.get("uuid"):
            playlist["uuid"] = str(uuid.uuid4())
        playlist["userId"] = target_userid
        result.append(playlist)
        for key in _playlist_keys(playlist):
            table = by_uuid if key.startswith("u:") else by_id
            table.setdefault(key[2:], playlist)
        fingerprint = _playlist_fingerprint(playlist)
        if fingerprint:
            by_fp.setdefault(fingerprint, playlist)
    for playlist in result:
        if isinstance(playlist, dict):
            playlist["userId"] = target_userid
    return _fit_list(result, keep, CLAIM_MAX_LIBRARY_BYTES)


def _merge_events(tx, guest_id, target_id, now_ms):
    cutoff = now_ms - CLAIM_EVENT_RETENTION_MS
    added = tx.run(
        "INSERT INTO recommend_events(userid,eventid,event,platform,songid,artistid,artistname,"
        "albumid,albumname,tags,position,duration,createdat) "
        "SELECT ?,eventid,event,platform,songid,artistid,artistname,"
        "albumid,albumname,tags,position,duration,createdat "
        "FROM recommend_events WHERE userid = ? AND createdat >= ? AND eventid <> '' "
        "ON CONFLICT DO NOTHING",
        (target_id, guest_id, cutoff),
    )
    tx.run("DELETE FROM recommend_events WHERE userid = ? AND createdat < ?", (target_id, cutoff))
    tx.run(
        "DELETE FROM recommend_events WHERE userid = ? AND id NOT IN "
        "(SELECT id FROM recommend_events WHERE userid = ? ORDER BY createdat DESC, id DESC LIMIT ?)",
        (target_id, target_id, CLAIM_EVENT_MAX),
    )
    return {"added": max(0, added)}


def _merge_edges(tx, guest_id, target_id, now_ms):
    cutoff = now_ms - CLAIM_EDGE_RETENTION_MS
    merged = tx.run(
        "INSERT INTO recommend_edges(userid,platform,srcid,dstid,weight,updatedat) "
        "SELECT ?,platform,srcid,dstid,weight,updatedat FROM recommend_edges "
        "WHERE userid = ? AND updatedat >= ? "
        "ON CONFLICT(userid,platform,srcid,dstid) DO UPDATE SET "
        "weight = CASE WHEN recommend_edges.weight + excluded.weight > ? THEN ? "
        "ELSE recommend_edges.weight + excluded.weight END, "
        "updatedat = CASE WHEN recommend_edges.updatedat > excluded.updatedat "
        "THEN recommend_edges.updatedat ELSE excluded.updatedat END",
        (target_id, guest_id, cutoff, CLAIM_EDGE_WEIGHT_MAX, CLAIM_EDGE_WEIGHT_MAX),
    )
    tx.run("DELETE FROM recommend_edges WHERE userid = ? AND updatedat < ?", (target_id, cutoff))
    tx.run(
        "DELETE FROM recommend_edges WHERE userid = ? AND (updatedat, platform, srcid, dstid) NOT IN "
        "(SELECT updatedat, platform, srcid, dstid FROM recommend_edges WHERE userid = ? "
        "ORDER BY weight DESC, updatedat DESC LIMIT ?)",
        (target_id, target_id, CLAIM_EDGE_MAX),
    )
    return {"merged": max(0, merged)}


def _delete_guest(userid):
    with db.transaction() as tx:
        tx.run("DELETE FROM playlist_shares WHERE userid = ?", (userid,))
        tx.run("DELETE FROM recommend_events WHERE userid = ?", (userid,))
        tx.run("DELETE FROM recommend_edges WHERE userid = ?", (userid,))
        tx.run("DELETE FROM library WHERE userid = ?", (userid,))
        tx.run("DELETE FROM guest_tokens WHERE userid = ?", (userid,))
        tx.run("DELETE FROM users WHERE id = ? AND isguest = 1", (userid,))


def cleanup_guests():
    now = int(time.time())
    cutoff = now - cfg.GUEST_TTL_SECONDS
    for _ in range(10):
        rows = db.query(
            "SELECT id FROM users WHERE isguest = 1 AND lastseen < ? LIMIT ?",
            (cutoff, cfg.GUEST_CLEANUP_BATCH),
        )
        if not rows:
            break
        for row in rows:
            try:
                _delete_guest(int(row["id"]))
            except Exception as error:
                a(f"guest cleanup failed: id={row['id']} {type(error).__name__}: {error}", "WARN")
    db.run("DELETE FROM guest_tokens WHERE expiresat < ?", (now,))
    db.run("DELETE FROM guest_tokens WHERE claimedat > 0 AND claimedat < ?", (cutoff,))


def maybe_cleanup():
    global _cleanup_at
    now = time.time()
    if now - _cleanup_at < 3600:
        return
    if not _cleanup_lock.acquire(False):
        return
    _cleanup_at = now

    def run():
        try:
            cleanup_guests()
        finally:
            _cleanup_lock.release()

    threading.Thread(target=run, daemon=True).start()
