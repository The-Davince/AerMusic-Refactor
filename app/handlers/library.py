import json
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.handlers.auth import currentUser
from utils import db
from utils.log import a, get_log_id

router = APIRouter()

KINDS = ("favorites", "playlists", "history")


def _resp(req, code, msg, status=200, data=None):
    return JSONResponse(status_code=status, content={"code": code, "msg": msg, "data": data, "logId": get_log_id(req)})


@router.get("/library")
async def getAll(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    rows = db.query("SELECT kind, data, updatedat FROM library WHERE userid = ?", (user["id"],))
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
    try:
        body = await req.json()
    except Exception:
        return _resp(req, 400, "请求体不是合法JSON", 400)
    if not isinstance(body, dict):
        return _resp(req, 400, "请求体不合法", 400)
    payload = body.get("data")
    updatedAt = body.get("updatedAt") or int(time.time() * 1000)
    if not isinstance(updatedAt, int) or updatedAt < 0:
        return _resp(req, 400, "updatedAt不合法", 400)
    raw = json.dumps(payload, ensure_ascii=False)
    if len(raw) > 2 * 1024 * 1024:
        return _resp(req, 413, "数据太大了", 413)
    db.run(
        "INSERT INTO library(userid, kind, data, updatedat) VALUES(?,?,?,?) "
        "ON CONFLICT(userid, kind) DO UPDATE SET data = excluded.data, updatedat = excluded.updatedat "
        "WHERE excluded.updatedat >= library.updatedat",
        (user["id"], kind, raw, updatedAt),
    )
    a(f"library put: uid={user['id']} kind={kind} bytes={len(raw)} log_id={get_log_id(req)}")
    return _resp(req, 0, "ok", data={"kind": kind, "updatedAt": updatedAt})
