import asyncio
import json
import re
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.handlers.auth import currentUser, readJsonBody
from utils import db
from utils.log import a, get_log_id, _get_real_ip
from utils.rate_limit import allow_local

router = APIRouter()

KINDS = ("favorites", "playlists", "history")
MAX_LIBRARY_BYTES = 2 * 1024 * 1024
SHARE_MAX_PER_IP = 120
SHARE_WINDOW_SECONDS = 60
SHARE_MAX_SONGS = 2000
_UUID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def _resp(req, code, msg, status=200, data=None):
    return JSONResponse(status_code=status, content={"code": code, "msg": msg, "data": data, "logId": get_log_id(req)},
                        headers={"Cache-Control": "no-store"})


def _playlistsOf(userid):
    row = db.get("SELECT data FROM library WHERE userid = ? AND kind = ?", (userid, "playlists"))
    if not row:
        return []
    try:
        parsed = json.loads(row["data"])
    except ValueError:
        return []
    return parsed if isinstance(parsed, list) else []


def _findPlaylist(playlists, uuid):
    for item in playlists:
        if isinstance(item, dict) and str(item.get("uuid") or "") == uuid:
            return item
    return None


@router.get("/library")
async def getAll(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    rows = await asyncio.to_thread(
        db.query, "SELECT kind, data, updatedat FROM library WHERE userid = ?", (user["id"],)
    )
    data = {k: {"data": None, "updatedAt": 0} for k in KINDS}
    for r in rows:
        if r["kind"] in data:
            try:
                parsed = json.loads(r["data"])
            except ValueError:
                parsed = None
            data[r["kind"]] = {"data": parsed, "updatedAt": r["updatedat"]}
    return _resp(req, 0, "ok", data=data)


@router.put("/library/{kind}")
async def putKind(req: Request, kind: str):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    if kind not in KINDS:
        return _resp(req, 404, f"未知数据类型 {kind}", 404)
    body, err = await readJsonBody(req, MAX_LIBRARY_BYTES)
    if err:
        return err
    payload = body.get("data")
    updatedAt = body.get("updatedAt")
    now_ms = int(time.time() * 1000)
    if not isinstance(updatedAt, int) or isinstance(updatedAt, bool) or updatedAt < 0 or updatedAt > now_ms + 5 * 60 * 1000:
        updatedAt = now_ms
    raw = json.dumps(payload, ensure_ascii=False)
    if len(raw) > MAX_LIBRARY_BYTES:
        return _resp(req, 413, "数据太大了", 413)

    def _write():
        db.run(
            "INSERT INTO library(userid, kind, data, updatedat) VALUES(?,?,?,?) "
            "ON CONFLICT(userid, kind) DO UPDATE SET data = excluded.data, updatedat = excluded.updatedat "
            "WHERE excluded.updatedat >= library.updatedat",
            (user["id"], kind, raw, updatedAt),
        )
        row = db.get("SELECT updatedat FROM library WHERE userid = ? AND kind = ?", (user["id"], kind))
        return row["updatedat"] if row else updatedAt

    applied_at = await asyncio.to_thread(_write)
    a(f"library put: uid={user['id']} kind={kind} bytes={len(raw)} applied={applied_at == updatedAt} log_id={get_log_id(req)}")
    return _resp(req, 0, "ok", data={"kind": kind, "updatedAt": applied_at, "applied": applied_at == updatedAt})


@router.put("/library/share/{uuid}")
async def putShare(req: Request, uuid: str):
    """分享歌单: 只登记 uuid 归属, 歌单本体仍从 library 现读, 不复制数据"""
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    if not _UUID_RE.match(uuid):
        return _resp(req, 400, "参数不合法", 400)
    playlists = await asyncio.to_thread(_playlistsOf, user["id"])
    if not _findPlaylist(playlists, uuid):
        return _resp(req, 404, "歌单不存在", 404)
    await asyncio.to_thread(
        db.run,
        "INSERT INTO playlist_shares(uuid, userid, createdat) VALUES(?,?,?) "
        "ON CONFLICT(uuid) DO UPDATE SET userid = excluded.userid, createdat = excluded.createdat",
        (uuid, user["id"], int(time.time() * 1000)),
    )
    return _resp(req, 0, "ok", data={"uuid": uuid})


@router.get("/library/share/{uuid}")
async def getShare(req: Request, uuid: str):
    if not _UUID_RE.match(uuid):
        return _resp(req, 400, "参数不合法", 400)
    if not allow_local("plshare|" + _get_real_ip(req), SHARE_MAX_PER_IP, SHARE_WINDOW_SECONDS):
        return _resp(req, 429, "请求过于频繁", 429)
    row = await asyncio.to_thread(db.get, "SELECT userid FROM playlist_shares WHERE uuid = ?", (uuid,))
    if not row:
        return _resp(req, 404, "歌单不存在或已取消分享", 404)
    playlists = await asyncio.to_thread(_playlistsOf, row["userid"])
    pl = _findPlaylist(playlists, uuid)
    if not pl:
        return _resp(req, 404, "歌单不存在或已取消分享", 404)
    songs = pl.get("songs")
    data = {
        "uuid": uuid,
        "name": str(pl.get("name") or "")[:80],
        "cover": str(pl.get("cover") or "")[:500],
        "songs": songs[:SHARE_MAX_SONGS] if isinstance(songs, list) else [],
    }
    return _resp(req, 0, "ok", data=data)
