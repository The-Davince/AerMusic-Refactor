import asyncio
import base64
import hashlib
import json
import re
import secrets
import sqlite3
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

import config as cfg
from utils import db, mailer, oidc_store, oss, security
from utils.log import a, get_log_id, _get_real_ip
from utils.rate_limit import allow
from utils.validate import checkUsername, checkPassword, checkRegPassword, checkNickname, checkEmail

router = APIRouter()

COOKIE = "aermusic_session"
MAX_AUTH_BODY = 64 * 1024
LOGIN_MAX_PER_IP = 100
LOGIN_WINDOW_SECONDS = 600
REGISTER_MAX_PER_IP = 200
REGISTER_WINDOW_SECONDS = 3600
EMAIL_CODE_MAX_PER_IP = 10
EMAIL_CODE_MAX_PER_EMAIL = 5
EMAIL_CODE_WINDOW_SECONDS = 3600
BIO_MAX_CHARS = 1000
CODE_RE = re.compile(r"^[0-9]{6}\Z")
DATA_URL_RE = re.compile(r"^data:image/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)\Z")
AVATAR_NAME_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|webp)\Z")
AVATAR_MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
AVATAR_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "avatars"
MAX_AVATAR_BYTES = 1024 * 1024
MAX_AVATAR_BODY = 2 * 1024 * 1024


def _resp(req, code, msg, status=200, data=None):
    return JSONResponse(status_code=status, content={"code": code, "msg": msg, "data": data, "logId": get_log_id(req)},
                        headers={"Cache-Control": "no-store"})


async def readJsonBody(req: Request, limit: int):
    """读取 JSON body, 超限/非法时返回 (None, 响应)"""
    cl = req.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > limit:
        return None, JSONResponse(status_code=413, content={"code": 413, "msg": "请求体太大", "data": None, "logId": get_log_id(req)})
    chunks = []
    size = 0
    try:
        async for chunk in req.stream():
            size += len(chunk)
            if size > limit:
                return None, JSONResponse(status_code=413, content={"code": 413, "msg": "请求体太大", "data": None, "logId": get_log_id(req)})
            chunks.append(chunk)
    except Exception:
        return None, JSONResponse(status_code=400, content={"code": 400, "msg": "请求体读取失败", "data": None, "logId": get_log_id(req)})
    raw = b"".join(chunks)
    try:
        body = json.loads(raw)
    except Exception:
        return None, JSONResponse(status_code=400, content={"code": 400, "msg": "请求体不是合法JSON", "data": None, "logId": get_log_id(req)})
    if not isinstance(body, dict):
        return None, JSONResponse(status_code=400, content={"code": 400, "msg": "请求体不合法", "data": None, "logId": get_log_id(req)})
    return body, None


def currentUser(req: Request):
    token = req.cookies.get(COOKIE)
    if not token:
        return None
    row = db.get(
        "SELECT u.id, u.username, u.nickname, u.uuid, u.avatar, u.bio, s.expiresat, s.createdat "
        "FROM sessions s JOIN users u ON u.id = s.userid WHERE s.tokenkey = ?",
        (security.tokenKey(token),),
    )
    if not row or row["expiresat"] <= int(time.time()):
        return None
    return row


def _cleanLogName(name) -> str:
    return str(name)[:20].replace("\n", " ").replace("\r", " ")


def _extractUsername(body) -> str:
    u = body.get("username")
    return u.strip() if isinstance(u, str) else ""


def _extractEmail(body) -> str:
    e = body.get("email")
    return e.strip().lower() if isinstance(e, str) else ""


def _emailRateKey(prefix: str, email: str) -> str:
    return prefix + hashlib.sha256(email.encode("utf-8")).hexdigest()


def _userPublic(user) -> dict:
    return {
        "userId": user["id"],
        "username": user["username"],
        "nickname": user["nickname"] or "",
        "uuid": user["uuid"] or "",
        "avatar": user["avatar"] or "",
        "bio": user["bio"] or "",
    }


def _sniffImage(raw: bytes) -> str:
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if raw[:3] == b"\xff\xd8\xff":
        return "jpg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return ""


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


@router.post("/user/email/code")
async def email_code(req: Request):
    log_id = get_log_id(req)
    body, err = await readJsonBody(req, MAX_AUTH_BODY)
    if err:
        return err
    email = _extractEmail(body)
    if not checkEmail(email):
        return _resp(req, 400, "邮箱格式不正确", 400)
    if db.get("SELECT id FROM users WHERE email = ?", (email,)):
        return _resp(req, 409, "该邮箱已被注册", 409)
    if not allow(_emailRateKey("ecode_cool|", email), 1, cfg.EMAIL_SEND_COOLDOWN):
        return _resp(req, 429, "验证码刚发过, 请稍后再试", 429)
    if not allow(_emailRateKey("ecode_mail|", email), EMAIL_CODE_MAX_PER_EMAIL, EMAIL_CODE_WINDOW_SECONDS):
        return _resp(req, 429, "该邮箱发送次数过多, 请稍后再试", 429)
    if not allow("ecode_ip|" + _get_real_ip(req), EMAIL_CODE_MAX_PER_IP, EMAIL_CODE_WINDOW_SECONDS):
        return _resp(req, 429, "发送过于频繁, 请稍后再试", 429)
    code = "".join(str(secrets.randbelow(10)) for _ in range(6))
    mailer.save_code(email, "register", code, cfg.SMTP_CODE_TTL)
    ok, msg = await mailer.send_code_email(email, code)
    if not ok:
        mailer.drop_code(email, "register")
        return _resp(req, 500, msg, 500)
    a(f"email code send: to={email} log_id={log_id}")
    return _resp(req, 0, "验证码已发送至邮箱")


@router.post("/user/register")
async def register(req: Request):
    log_id = get_log_id(req)
    if not allow("reg|" + _get_real_ip(req), REGISTER_MAX_PER_IP, REGISTER_WINDOW_SECONDS):
        a(f"user register rate limited: log_id={log_id}", "WARN", log_id)
        return _resp(req, 429, "注册过于频繁, 请稍后再试", 429)
    body, err = await readJsonBody(req, MAX_AUTH_BODY)
    if err:
        return err
    username = _extractUsername(body)
    password = body.get("password")
    raw_nickname = body.get("nickname")
    nickname = raw_nickname.strip() if isinstance(raw_nickname, str) else ""
    email = _extractEmail(body)
    raw_code = body.get("code")
    code = str(raw_code).strip() if isinstance(raw_code, (str, int)) else ""
    if not checkUsername(username):
        return _resp(req, 400, "用户名需2-20位中英文数字下划线", 400)
    if not checkRegPassword(password):
        return _resp(req, 400, "密码需8-64位且同时包含字母和数字", 400)
    if not checkNickname(nickname):
        return _resp(req, 400, "昵称需1-20位中英文数字下划线连字符", 400)
    if not checkEmail(email):
        return _resp(req, 400, "邮箱格式不正确", 400)
    if not CODE_RE.match(code):
        return _resp(req, 400, "验证码需6位数字", 400)
    if db.get("SELECT id FROM users WHERE lower(username) = lower(?)", (username,)):
        return _resp(req, 409, "用户名已被占用", 409)
    if db.get("SELECT id FROM users WHERE email = ?", (email,)):
        return _resp(req, 409, "邮箱已被注册", 409)
    ok, msg = mailer.check_code(email, "register", code)
    if not ok:
        a(f"user register code fail: name={_cleanLogName(username)} log_id={log_id}", "WARN")
        return _resp(req, 400, msg, 400)
    dk, salt = await asyncio.to_thread(security.hashPass, password)
    try:
        uid = db.run(
            "INSERT INTO users(username, pass, salt, createdat, nickname, uuid, email, emailverified) VALUES(?,?,?,?,?,?,?,?)",
            (username, dk, salt, int(time.time()), nickname, str(uuid.uuid4()), email, 1),
        )
    except sqlite3.IntegrityError:
        return _resp(req, 409, "用户名或邮箱已被占用", 409)
    except Exception as error:
        if type(error).__name__ not in ("IntegrityError", "UniqueViolation"):
            raise
        return _resp(req, 409, "用户名或邮箱已被占用", 409)
    a(f"user register: uid={uid} name={_cleanLogName(username)} log_id={log_id}")
    resp = _resp(req, 0, "注册成功", data={"userId": uid, "username": username})
    _setSession(resp, uid)
    return resp


@router.post("/user/login")
async def login(req: Request):
    log_id = get_log_id(req)
    if not allow("login|" + _get_real_ip(req), LOGIN_MAX_PER_IP, LOGIN_WINDOW_SECONDS):
        a(f"user login rate limited: log_id={log_id}", "WARN", log_id)
        return _resp(req, 429, "登录过于频繁, 请稍后再试", 429)
    body, err = await readJsonBody(req, MAX_AUTH_BODY)
    if err:
        return err
    username = _extractUsername(body)
    password = body.get("password")
    row = db.get("SELECT id, pass, salt FROM users WHERE lower(username) = lower(?)", (username,)) if username else None
    if not row:
        await asyncio.to_thread(security.checkPass, password if isinstance(password, str) else "", "0" * 64, "00" * 16)
    if not row or not isinstance(password, str) or not await asyncio.to_thread(security.checkPass, password, row["pass"], row["salt"]):
        a(f"user login failed: name={_cleanLogName(username)} log_id={log_id}", "WARN")
        return _resp(req, 401, "用户名或密码不对", 401)
    resp = _resp(req, 0, "登录成功", data={"userId": row["id"], "username": username})
    _setSession(resp, row["id"])
    a(f"user login ok: uid={row['id']} log_id={log_id}")
    return resp


@router.post("/user/logout")
async def logout(req: Request):
    user = currentUser(req)
    token = req.cookies.get(COOKIE)
    if token:
        db.run("DELETE FROM sessions WHERE tokenkey = ?", (security.tokenKey(token),))
    if user:
        try:
            await oidc_store.revoke_user_sessions(user["id"])
        except Exception as error:
            a(f"logout oidc revoke err: {type(error).__name__}: {error}", "WARN")
    resp = _resp(req, 0, "已退出")
    resp.delete_cookie(COOKIE, path="/")
    return resp


@router.get("/user/me")
async def me(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    return _resp(req, 0, "ok", data=_userPublic(user))


@router.put("/user/profile")
async def profile(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    body, err = await readJsonBody(req, MAX_AUTH_BODY)
    if err:
        return err
    nickname = user["nickname"] or ""
    bio = user["bio"] or ""
    if "nickname" in body:
        value = body.get("nickname")
        value = value.strip() if isinstance(value, str) else ""
        if not checkNickname(value):
            return _resp(req, 400, "昵称需1-20位中英文数字下划线连字符", 400)
        nickname = value
    if "bio" in body:
        value = body.get("bio")
        value = value.strip() if isinstance(value, str) else ""
        if len(value) > BIO_MAX_CHARS:
            return _resp(req, 400, "个人简介最多1000字", 400)
        bio = value
    db.run("UPDATE users SET nickname = ?, bio = ? WHERE id = ?", (nickname, bio, user["id"]))
    updated = db.get("SELECT id, username, nickname, uuid, avatar, bio FROM users WHERE id = ?", (user["id"],))
    return _resp(req, 0, "已更新", data=_userPublic(updated))


@router.post("/user/avatar")
async def avatar_upload(req: Request):
    user = currentUser(req)
    if not user:
        return _resp(req, 401, "未登录", 401)
    if not allow("avatar|" + str(user["id"]), 30, 600):
        return _resp(req, 429, "上传过于频繁, 请稍后再试", 429)
    body, err = await readJsonBody(req, MAX_AVATAR_BODY)
    if err:
        return err
    data_url = body.get("dataUrl")
    match = DATA_URL_RE.match(data_url) if isinstance(data_url, str) else None
    if not match:
        return _resp(req, 400, "仅支持 png/jpg/webp 图片", 400)
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except Exception:
        return _resp(req, 400, "图片数据不合法", 400)
    if len(raw) > MAX_AVATAR_BYTES:
        return _resp(req, 400, "头像不能超过1MB", 400)
    ext = _sniffImage(raw)
    if not ext:
        return _resp(req, 400, "图片内容不是有效的 png/jpg/webp", 400)
    old = str(user["avatar"] or "")
    try:
        url = await oss.uploadBytes(raw, "." + ext, AVATAR_MIME[ext])
    except Exception as e:
        a(f"avatar oss upload failed: uid={user['id']} {type(e).__name__}: {e}", "WARN")
        url = None
    if url:
        db.run("UPDATE users SET avatar = ? WHERE id = ?", (url, user["id"]))
        await oss.deleteByUrl(old)
        a(f"avatar upload: uid={user['id']} size={len(raw)} storage=oss")
        return _resp(req, 0, "头像已更新", data={"avatar": url})
    filename = f"{uuid.uuid4().hex}.{ext}"
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread((AVATAR_DIR / filename).write_bytes, raw)
    url = f"/api/user/avatar/{filename}"
    db.run("UPDATE users SET avatar = ? WHERE id = ?", (url, user["id"]))
    old_name = old.rsplit("/", 1)[-1]
    if AVATAR_NAME_RE.match(old_name) and old_name != filename:
        try:
            (AVATAR_DIR / old_name).unlink(missing_ok=True)
        except Exception:
            pass
    a(f"avatar upload: uid={user['id']} size={len(raw)} storage=local")
    return _resp(req, 0, "头像已更新", data={"avatar": url})


@router.get("/user/avatar/{filename}")
async def avatar_file(req: Request, filename: str):
    if not AVATAR_NAME_RE.match(filename):
        return _resp(req, 404, "头像不存在", 404)
    path = AVATAR_DIR / filename
    if not path.is_file():
        return _resp(req, 404, "头像不存在", 404)
    return FileResponse(path, media_type=AVATAR_MIME[filename.rsplit(".", 1)[-1]],
                        headers={"Cache-Control": "public, max-age=86400"})
