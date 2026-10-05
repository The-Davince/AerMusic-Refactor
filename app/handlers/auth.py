import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import asyncio
import config as cfg
from utils import db, security
from utils.log import a, get_log_id
from utils.validate import checkUsername, checkPassword

router = APIRouter()

COOKIE = "aermusic_session"


def _resp(req, code, msg, status=200, data=None):
    return JSONResponse(status_code=status, content={"code": code, "msg": msg, "data": data, "logId": get_log_id(req)})


def currentUser(req: Request):
    token = req.cookies.get(COOKIE)
    if not token:
        return None
    row = db.get(
        "SELECT u.id, u.username, s.expiresat FROM sessions s JOIN users u ON u.id = s.userid WHERE s.tokenkey = ?",
        (security.tokenKey(token),),
    )
    if not row or row["expiresat"] <= int(time.time()):
        return None
    return row


def _setSession(resp, userid: int):
    token = security.newToken()
    now = int(time.time())
    db.run(
        "INSERT INTO sessions(tokenkey, userid, expiresat, createdat) VALUES(?,?,?,?)",
        (security.tokenKey(token), userid, now + cfg.SESSION_TTL_SECONDS, now),
    )
    db.run("DELETE FROM sessions WHERE expiresat < ?", (now,))
    resp.set_cookie(
        COOKIE, token,
        max_age=cfg.SESSION_TTL_SECONDS, httponly=True,
        samesite="lax", secure=cfg.SESSION_COOKIE_SECURE, path="/",
    )


@router.post("/user/register")
async def register(req: Request):
    log_id = get_log_id(req)
    try:
        body = await req.json()
    except Exception:
        return _resp(req, 400, "请求体不是合法JSON", 400)
    username = (body.get("username") or "").strip() if isinstance(body, dict) else ""
    password = body.get("password") if isinstance(body, dict) else ""
    if not checkUsername(username):
        return _resp(req, 400, "用户名需2-20位中英文数字下划线", 400)
    if not checkPassword(password):
        return _resp(req, 400, "密码需6-64位", 400)
    if db.get("SELECT id FROM users WHERE username = ?", (username,)):
        return _resp(req, 409, "用户名已被占用", 409)
    dk, salt = await asyncio.to_thread(security.hashPass, password)
    uid = db.run(
        "INSERT INTO users(username, pass, salt, createdat) VALUES(?,?,?,?)",
        (username, dk, salt, int(time.time())),
    )
    a(f"user register: uid={uid} name={username} log_id={log_id}")
    resp = _resp(req, 0, "注册成功", data={"userId": uid, "username": username})
    _setSession(resp, uid)
    return resp


@router.post("/user/login")
async def login(req: Request):
    log_id = get_log_id(req)
    try:
        body = await req.json()
    except Exception:
        return _resp(req, 400, "请求体不是合法JSON", 400)
    username = (body.get("username") or "").strip() if isinstance(body, dict) else ""
    password = body.get("password") if isinstance(body, dict) else ""
    row = db.get("SELECT id, pass, salt FROM users WHERE username = ?", (username,)) if username else None
    if not row or not isinstance(password, str) or not await asyncio.to_thread(security.checkPass, password, row["pass"], row["salt"]):
        a(f"user login failed: name={username[:20]} log_id={log_id}", "WARN")
        return _resp(req, 401, "用户名或密码不对", 401)
    resp = _resp(req, 0, "登录成功", data={"userId": row["id"], "username": username})
    _setSession(resp, row["id"])
    a(f"user login ok: uid={row['id']} log_id={log_id}")
    return resp


@router.post("/user/logout")
async def logout(req: Request):
    token = req.cookies.get(COOKIE)
    if token:
        db.run("DELETE FROM sessions WHERE tokenkey = ?", (security.tokenKey(token),))
    resp = _resp(req, 0, "已退出")
    resp.delete_cookie(COOKIE, path="/")
    return resp


@router.get("/user/me")
async def me(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    return _resp(req, 0, "ok", data={"userId": user["id"], "username": user["username"]})
