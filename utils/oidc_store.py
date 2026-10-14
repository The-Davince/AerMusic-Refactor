import asyncio
import hashlib
import json
import secrets
import time

import config as cfg
from utils import db


def token_hash(token: str) -> str:
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def _now() -> int:
    return int(time.time())


async def save_request(ticket: str, data: dict) -> None:
    now = _now()
    raw = json.dumps(data, ensure_ascii=False)
    await asyncio.to_thread(
        db.run,
        "INSERT INTO oidc_requests(ticket, data, expiresat) VALUES(?,?,?) "
        "ON CONFLICT(ticket) DO UPDATE SET data=?, expiresat=?",
        (ticket, raw, now + cfg.OIDC_CONSENT_TTL_SECONDS, raw, now + cfg.OIDC_CONSENT_TTL_SECONDS),
    )


async def load_request(ticket: str) -> dict:
    if not ticket or len(ticket) > 128:
        return None
    row = await asyncio.to_thread(db.get, "SELECT data, expiresat FROM oidc_requests WHERE ticket = ?", (ticket,))
    if not row or row["expiresat"] <= _now():
        return None
    try:
        data = json.loads(row["data"])
    except Exception:
        return None
    return data if isinstance(data, dict) and isinstance(data.get("values"), dict) else None


async def drop_request(ticket: str) -> None:
    await asyncio.to_thread(db.run, "DELETE FROM oidc_requests WHERE ticket = ?", (ticket,))


async def create_code(userid: int, client_id: str, redirect_uri: str, scope: str,
                      nonce: str, code_challenge: str, auth_time: int) -> str:
    code = secrets.token_urlsafe(32)
    await asyncio.to_thread(
        db.run,
        "INSERT INTO oidc_codes(code_hash, userid, client_id, redirect_uri, scope, nonce, code_challenge, auth_time, expiresat) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (token_hash(code), userid, client_id, redirect_uri, scope, nonce, code_challenge,
         int(auth_time), _now() + cfg.OIDC_CODE_TTL_SECONDS),
    )
    return code


async def consume_code(code: str, client_id: str, redirect_uri: str) -> dict:
    digest = token_hash(code)
    row = await asyncio.to_thread(db.get, "SELECT * FROM oidc_codes WHERE code_hash = ?", (digest,))
    if not row or row["usedat"] or row["expiresat"] <= _now():
        return None
    if row["client_id"] != client_id or row["redirect_uri"] != redirect_uri:
        return None
    used = await asyncio.to_thread(
        db.run_rowcount, "UPDATE oidc_codes SET usedat = ? WHERE code_hash = ? AND usedat IS NULL", (_now(), digest))
    return row if used == 1 else None


async def create_session(sid: str, userid: int, client_id: str, scopes: str, auth_time: int) -> None:
    now = _now()
    await asyncio.to_thread(
        db.run,
        "INSERT INTO oidc_sessions(sid, userid, client_id, scopes, auth_time, createdat, lastseen, expiresat) "
        "VALUES(?,?,?,?,?,?,?,?)",
        (sid, userid, client_id, scopes, int(auth_time), now, now, now + cfg.OIDC_REFRESH_TTL_SECONDS),
    )


async def session_active(sid: str, client_id: str, userid: int) -> dict:
    if not sid:
        return None
    row = await asyncio.to_thread(db.get, "SELECT * FROM oidc_sessions WHERE sid = ?", (sid,))
    if not row or row["revokedat"] or row["expiresat"] <= _now():
        return None
    if row["client_id"] != client_id or int(row["userid"]) != int(userid):
        return None
    return row


async def touch_session(sid: str) -> None:
    await asyncio.to_thread(db.run, "UPDATE oidc_sessions SET lastseen = ? WHERE sid = ?", (_now(), sid))


async def revoke_session(sid: str) -> None:
    now = _now()
    def _job():
        db.run("UPDATE oidc_sessions SET revokedat = ? WHERE sid = ? AND revokedat IS NULL", (now, sid))
        db.run("UPDATE oidc_refresh_tokens SET revokedat = ? WHERE sid = ? AND revokedat IS NULL", (now, sid))
    await asyncio.to_thread(_job)


async def revoke_user_sessions(userid: int) -> int:
    """用户登出后撤销其全部 OIDC 会话与刷新令牌"""
    now = _now()
    def _job():
        n = db.run_rowcount(
            "UPDATE oidc_sessions SET revokedat = ? WHERE userid = ? AND revokedat IS NULL", (now, int(userid)))
        db.run("UPDATE oidc_refresh_tokens SET revokedat = ? WHERE userid = ? AND revokedat IS NULL", (now, int(userid)))
        return n
    return await asyncio.to_thread(_job)


async def create_refresh(token: str, sid: str, userid: int, client_id: str, scopes: str) -> None:
    now = _now()
    await asyncio.to_thread(
        db.run,
        "INSERT INTO oidc_refresh_tokens(token_hash, sid, userid, client_id, scopes, createdat, expiresat) VALUES(?,?,?,?,?,?,?)",
        (token_hash(token), sid, userid, client_id, scopes, now, now + cfg.OIDC_REFRESH_TTL_SECONDS),
    )


async def consume_refresh(token: str) -> tuple:
    """返回 (row, state); state: ok 正常轮换 / reused 重放 / invalid 无效"""
    digest = token_hash(token)
    row = await asyncio.to_thread(db.get, "SELECT * FROM oidc_refresh_tokens WHERE token_hash = ?", (digest,))
    if not row:
        return None, "invalid"
    if row["usedat"]:
        return row, "reused"
    if row["revokedat"] or row["expiresat"] <= _now():
        return row, "invalid"
    used = await asyncio.to_thread(
        db.run_rowcount,
        "UPDATE oidc_refresh_tokens SET usedat = ? WHERE token_hash = ? AND usedat IS NULL AND revokedat IS NULL",
        (_now(), digest),
    )
    if used != 1:
        return row, "reused"
    return row, "ok"


async def find_refresh(token: str) -> dict:
    return await asyncio.to_thread(db.get, "SELECT * FROM oidc_refresh_tokens WHERE token_hash = ?", (token_hash(token),))


async def consent_scopes(userid: int, client_id: str) -> set:
    row = await asyncio.to_thread(
        db.get, "SELECT scopes FROM oidc_consents WHERE userid = ? AND client_id = ?", (int(userid), client_id))
    return {x for x in str(row["scopes"] or "").split() if x} if row else set()


async def save_consent(userid: int, client_id: str, scopes: set) -> None:
    now = _now()
    await asyncio.to_thread(
        db.run,
        "INSERT INTO oidc_consents(userid, client_id, scopes, createdat, updatedat) VALUES(?,?,?,?,?) "
        "ON CONFLICT(userid, client_id) DO UPDATE SET scopes=?, updatedat=?",
        (int(userid), client_id, " ".join(sorted(scopes)), now, now, " ".join(sorted(scopes)), now),
    )


async def cleanup() -> None:
    """清过期的 OIDC 行, 启动与发码/发 token 顺手调用"""
    now = _now()
    def _job():
        db.run("DELETE FROM oidc_requests WHERE expiresat < ?", (now,))
        db.run("DELETE FROM oidc_codes WHERE expiresat < ?", (now,))
        db.run("DELETE FROM oidc_refresh_tokens WHERE expiresat < ?", (now,))
        db.run("DELETE FROM oidc_sessions WHERE expiresat < ?", (now,))
    await asyncio.to_thread(_job)
