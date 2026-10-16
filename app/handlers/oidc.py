import asyncio
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from urllib.parse import parse_qs, quote, urlencode

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

import config as cfg
from app.handlers import _oidc_page
from app.handlers import auth
from utils import db, oidc_store, jwt as jwtx
from utils.log import a, _get_real_ip
from utils.rate_limit import allow
from utils.security import checkPass

router = APIRouter()
wellknown_router = APIRouter()

MAX_OIDC_BODY = 16 * 1024
CODE_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43,128}\Z")
VERIFIER_RE = re.compile(r"^[A-Za-z0-9\-._~]{43,128}\Z")
AUTHORIZE_MAX_PER_IP = 120
CONSENT_MAX_PER_IP = 100
TOKEN_MAX_PER_IP = 240
USERINFO_MAX_PER_IP = 1200
REVOKE_MAX_PER_IP = 60
WINDOW_10M = 600
WINDOW_1M = 60

_NO_CACHE = {"Cache-Control": "no-store"}


def _resp_json(payload: dict, status: int = 200):
    return JSONResponse(status_code=status, content=payload, headers=_NO_CACHE)


def _json_err(error: str, desc: str, status: int = 400):
    return JSONResponse(status_code=status, content={"error": error, "error_description": desc}, headers=_NO_CACHE)


def _redirect(url: str, status: int = 302):
    return RedirectResponse(url=url, status_code=status, headers=_NO_CACHE)


def _err_redirect(redirect_uri: str, state: str, error: str, desc: str):
    params = {"error": error, "error_description": desc}
    if state:
        params["state"] = state
    sep = "&" if "?" in redirect_uri else "?"
    return _redirect(f"{redirect_uri}{sep}{urlencode(params)}")


def _ok_redirect(redirect_uri: str, code: str, state: str):
    params = {"code": code}
    if state:
        params["state"] = state
    sep = "&" if "?" in redirect_uri else "?"
    return _redirect(f"{redirect_uri}{sep}{urlencode(params)}")


def _html_page(html: str, status: int = 200):
    return HTMLResponse(content=html, status_code=status, headers=_NO_CACHE)


def _limit(req: Request, name: str, limit: int, window: int) -> bool:
    return allow(f"oidc_{name}|" + _get_real_ip(req), limit, window)


def _client_lookup(client_id: str):
    client = cfg.OIDC_CLIENTS.get(client_id)
    return client if isinstance(client, dict) else None


def _client_redirects(client: dict):
    redirects = client.get("redirects") or []
    if isinstance(redirects, str):
        return [redirects]
    return [x for x in redirects if isinstance(x, str)] if isinstance(redirects, (list, tuple)) else []


def _client_scopes(client: dict):
    scopes = client.get("scopes") or ["openid", "profile"]
    if isinstance(scopes, str):
        return {x for x in scopes.split() if x}
    return {x for x in scopes if isinstance(x, str)} if isinstance(scopes, (list, tuple, set)) else set()


def _client_name(client_id: str, client: dict) -> str:
    name = client.get("name")
    if not isinstance(name, str) or not name.strip():
        return client_id
    return name.strip()[:120]


def _secret_ok(received: str, client: dict) -> bool:
    expected = str(client.get("secret") or "")
    if expected.startswith("sha256$"):
        return hmac.compare_digest(hashlib.sha256(received.encode("utf-8")).hexdigest(), expected[7:])
    return bool(expected) and hmac.compare_digest(received, expected)


def _client_auth(req: Request, body: dict):
    client_id = str(body.get("client_id") or "")
    client_secret = str(body.get("client_secret") or "")
    header = req.headers.get("authorization", "")
    if header[:6].lower() == "basic ":
        try:
            decoded = base64.b64decode(header[6:].strip(), validate=True).decode("utf-8")
            client_id, _, client_secret = decoded.partition(":")
        except Exception:
            return "", None, _json_err("invalid_client", "client authentication failed", 401)
    client = _client_lookup(client_id)
    if not client:
        return "", None, _json_err("invalid_client", "client authentication failed", 401)
    if str(client.get("secret") or "") and not _secret_ok(client_secret, client):
        return "", None, _json_err("invalid_client", "client authentication failed", 401)
    return client_id, client, None


def _pkce_value(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("utf-8")).digest()).rstrip(b"=").decode()


async def _read_body(req: Request):
    raw = await req.body()
    if len(raw) > MAX_OIDC_BODY:
        return None, _json_err("invalid_request", "request body too large", 413)
    if "application/json" in req.headers.get("content-type", ""):
        try:
            data = json.loads(raw or b"{}")
        except Exception:
            return None, _json_err("invalid_request", "body is not valid json")
        return (data if isinstance(data, dict) else {}), None
    try:
        pairs = parse_qs(raw.decode("utf-8"), keep_blank_values=True)
    except Exception:
        return None, _json_err("invalid_request", "body decode failed")
    return {k: v[0] for k, v in pairs.items()}, None


def _read_authorize(req: Request) -> dict:
    q = req.query_params
    return {
        "client_id": (q.get("client_id") or "").strip(),
        "redirect_uri": (q.get("redirect_uri") or "").strip(),
        "response_type": q.get("response_type", ""),
        "scope": q.get("scope", ""),
        "state": q.get("state", ""),
        "nonce": q.get("nonce", ""),
        "prompt": (q.get("prompt") or "").strip(),
        "code_challenge": q.get("code_challenge", ""),
        "code_challenge_method": q.get("code_challenge_method", ""),
    }


def _validate_authorize(values: dict):
    client = _client_lookup(values["client_id"])
    if not client or values["response_type"] != "code":
        return None, _json_err("invalid_request", "client or response_type invalid")
    if values["redirect_uri"] not in _client_redirects(client):
        return None, _json_err("invalid_request", "redirect_uri not registered")
    if not values["state"] or len(values["state"]) > 512:
        return None, _json_err("invalid_request", "state is required")
    if not values["nonce"] or len(values["nonce"]) > 256:
        return None, _json_err("invalid_request", "nonce is required")
    if values["code_challenge_method"] != "S256" or not CODE_CHALLENGE_RE.match(values["code_challenge"]):
        return None, _json_err("invalid_request", "S256 PKCE is required")
    if values["prompt"] not in ("", "none", "consent"):
        return None, _json_err("invalid_request", "prompt invalid")
    requested = {x for x in values["scope"].split() if x}
    if "email" in requested:
        return None, _json_err("invalid_scope", "email scope is not supported")
    if "openid" not in requested or not requested.issubset(_client_scopes(client)):
        return None, _json_err("invalid_scope", "scope invalid")
    values["scope"] = " ".join(sorted(requested))
    return client, None


def _csrf_ok(req: Request, data: dict, token: str) -> bool:
    expected = str(data.get("csrf") or "")
    if not expected or not token or not hmac.compare_digest(expected, token):
        return False
    origin = req.headers.get("origin", "")
    if origin:
        return origin.rstrip("/") == cfg.OIDC_ISSUER
    referer = req.headers.get("referer", "")
    return bool(referer) and referer.startswith(cfg.OIDC_ISSUER + "/")


def _access_payload(userid: int, sid: str, client_id: str, scopes: str) -> dict:
    now = int(time.time())
    return {
        "iss": cfg.OIDC_ISSUER,
        "sub": str(userid),
        "aud": [client_id],
        "client_id": client_id,
        "sid": sid,
        "grant_id": sid,
        "scope": scopes,
        "resource": client_id,
        "oidc": True,
        "iat": now,
        "exp": now + cfg.OIDC_ACCESS_TTL_SECONDS,
        "jti": secrets.token_hex(16),
    }


def _id_payload(userid: int, client_id: str, sid: str, nonce: str, auth_time: int) -> dict:
    now = int(time.time())
    return {
        "iss": cfg.OIDC_ISSUER,
        "sub": str(userid),
        "aud": client_id,
        "azp": client_id,
        "sid": sid,
        "nonce": nonce,
        "auth_time": int(auth_time),
        "iat": now,
        "exp": now + cfg.OIDC_ID_TTL_SECONDS,
        "jti": secrets.token_hex(16),
    }


async def _cleanup_quiet():
    try:
        await oidc_store.cleanup()
    except Exception as error:
        a(f"oidc cleanup err: {type(error).__name__}: {error}", "WARN")


async def _issue_code(values: dict, user: dict):
    auth_time = user.get("createdat") or int(time.time())
    code = await oidc_store.create_code(
        user["id"], values["client_id"], values["redirect_uri"], values["scope"], values["nonce"],
        values["code_challenge"], auth_time)
    await _cleanup_quiet()
    return _ok_redirect(values["redirect_uri"], code, values["state"])


async def _start_consent(values: dict):
    ticket = secrets.token_urlsafe(24)
    await oidc_store.save_request(ticket, {"values": dict(values), "csrf": secrets.token_urlsafe(24)})
    return _redirect(f"/api/oidc/consent?ticket={quote(ticket, safe='')}")


def _disabled():
    return _json_err("not_found", "oidc is disabled", 404)


@wellknown_router.get("/.well-known/openid-configuration")
async def openid_configuration(req: Request):
    if not cfg.OIDC_ENABLED:
        return _disabled()
    issuer = cfg.OIDC_ISSUER
    return _resp_json({
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/api/oidc/authorize",
        "token_endpoint": f"{issuer}/api/oidc/token",
        "userinfo_endpoint": f"{issuer}/api/oidc/userinfo",
        "revocation_endpoint": f"{issuer}/api/oidc/revoke",
        "jwks_uri": f"{issuer}/.well-known/jwks.json",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["EdDSA"],
        "scopes_supported": ["openid", "profile"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
        "code_challenge_methods_supported": ["S256"],
        "prompt_values_supported": ["none", "consent"],
    })


@wellknown_router.get("/.well-known/jwks.json")
async def jwks(req: Request):
    if not cfg.OIDC_ENABLED:
        return _disabled()
    return JSONResponse(content=jwtx.get_jwks(), headers={"Cache-Control": "public, max-age=300"})


@router.get("/oidc/authorize")
async def oidc_authorize(req: Request):
    if not cfg.OIDC_ENABLED:
        return _disabled()
    if not _limit(req, "authorize", AUTHORIZE_MAX_PER_IP, WINDOW_10M):
        return _json_err("temporarily_unavailable", "too many requests", 429)
    values = _read_authorize(req)
    client, error = _validate_authorize(values)
    if error:
        return error
    user = auth.currentUser(req)
    if values["prompt"] == "none":
        if not user:
            return _err_redirect(values["redirect_uri"], values["state"], "login_required", "no active session")
        consented = await oidc_store.consent_scopes(user["id"], values["client_id"])
        if not set(values["scope"].split()).issubset(consented):
            return _err_redirect(values["redirect_uri"], values["state"], "consent_required", "user consent required")
        return await _issue_code(values, user)
    if user:
        consented = await oidc_store.consent_scopes(user["id"], values["client_id"])
        if values["prompt"] != "consent" and set(values["scope"].split()).issubset(consented):
            return await _issue_code(values, user)
    return await _start_consent(values)


@router.get("/oidc/consent")
async def oidc_consent(req: Request):
    if not cfg.OIDC_ENABLED:
        return _disabled()
    if not _limit(req, "consent", CONSENT_MAX_PER_IP, WINDOW_10M):
        return _json_err("temporarily_unavailable", "too many requests", 429)
    data = await oidc_store.load_request((req.query_params.get("ticket") or "").strip())
    if not data:
        return _html_page(_oidc_page.render_error("授权请求已失效, 请返回应用重新发起"), 404)
    values = dict(data["values"])
    client, error = _validate_authorize(values)
    if error or not client:
        return _html_page(_oidc_page.render_error("授权请求已失效, 请返回应用重新发起"), 400)
    user = auth.currentUser(req)
    account = (user["nickname"] or user["username"]) if user else ""
    return _html_page(_oidc_page.render_consent(
        (req.query_params.get("ticket") or "").strip(), data["csrf"],
        _client_name(values["client_id"], client), set(values["scope"].split()), account))


@router.post("/oidc/login")
async def oidc_login(req: Request):
    if not cfg.OIDC_ENABLED:
        return _disabled()
    if not _limit(req, "consent", CONSENT_MAX_PER_IP, WINDOW_10M):
        return _json_err("temporarily_unavailable", "too many requests", 429)
    body, error = await _read_body(req)
    if error:
        return error
    ticket = str(body.get("ticket") or "")
    data = await oidc_store.load_request(ticket)
    if not data:
        return _html_page(_oidc_page.render_error("授权请求已失效, 请返回应用重新发起"), 404)
    values = dict(data["values"])
    client, error = _validate_authorize(values)
    if error or not client:
        return _html_page(_oidc_page.render_error("授权请求已失效, 请返回应用重新发起"), 400)
    client_name = _client_name(values["client_id"], client)
    scopes = set(values["scope"].split())
    if not _csrf_ok(req, data, str(body.get("csrf_token") or "")):
        return _html_page(_oidc_page.render_consent(ticket, data["csrf"], client_name, scopes, "", "登录校验失败, 请刷新页面后重试"), 403)
    username = str(body.get("username") or "").strip()
    password = body.get("password")
    row = db.get("SELECT id, pass, salt FROM users WHERE lower(username) = lower(?)", (username,)) if username else None
    if not row:
        await asyncio.to_thread(checkPass, password if isinstance(password, str) else "", "0" * 64, "00" * 16)
    if not row or not isinstance(password, str) or not await asyncio.to_thread(checkPass, password, row["pass"], row["salt"]):
        a(f"oidc login failed: name={username[:20].replace(chr(10), ' ')}", "WARN")
        return _html_page(_oidc_page.render_consent(ticket, data["csrf"], client_name, scopes, "", "用户名或密码不对"), 401)
    resp = _redirect(f"/api/oidc/consent?ticket={quote(ticket, safe='')}", 303)
    auth._setSession(resp, row["id"])
    await _cleanup_quiet()
    a(f"oidc login ok: uid={row['id']}")
    return resp


@router.post("/oidc/consent/decision")
async def oidc_consent_decision(req: Request):
    if not cfg.OIDC_ENABLED:
        return _disabled()
    if not _limit(req, "consent", CONSENT_MAX_PER_IP, WINDOW_10M):
        return _json_err("temporarily_unavailable", "too many requests", 429)
    body, error = await _read_body(req)
    if error:
        return error
    ticket = str(body.get("ticket") or "")
    decision = str(body.get("decision") or "").strip().lower()
    data = await oidc_store.load_request(ticket)
    if not data:
        return _html_page(_oidc_page.render_error("授权请求已失效, 请返回应用重新发起"), 404)
    values = dict(data["values"])
    client, error = _validate_authorize(values)
    if error or not client:
        return _html_page(_oidc_page.render_error("授权请求已失效, 请返回应用重新发起"), 400)
    client_name = _client_name(values["client_id"], client)
    scopes = set(values["scope"].split())
    user = auth.currentUser(req)
    if not user:
        return _html_page(_oidc_page.render_consent(ticket, data["csrf"], client_name, scopes, "", "登录已过期, 请重新登录"), 401)
    if not _csrf_ok(req, data, str(body.get("csrf_token") or "")):
        return _html_page(_oidc_page.render_error("授权确认已过期, 请刷新页面后重试"), 403)
    if decision not in ("approve", "deny"):
        return _html_page(_oidc_page.render_error("授权请求无效"), 400)
    await oidc_store.drop_request(ticket)
    if decision == "deny":
        return _err_redirect(values["redirect_uri"], values["state"], "access_denied", "user denied authorization")
    try:
        consented = await oidc_store.consent_scopes(user["id"], values["client_id"])
        await oidc_store.save_consent(user["id"], values["client_id"], consented | scopes)
    except Exception as error:
        a(f"oidc consent save err: {type(error).__name__}: {error}", "ERROR")
        return _err_redirect(values["redirect_uri"], values["state"], "server_error", "consent save failed")
    return await _issue_code(values, user)


@router.post("/oidc/token")
async def oidc_token(req: Request):
    if not cfg.OIDC_ENABLED:
        return _disabled()
    if not _limit(req, "token", TOKEN_MAX_PER_IP, WINDOW_1M):
        return _json_err("temporarily_unavailable", "too many requests", 429)
    body, error = await _read_body(req)
    if error:
        return error
    client_id, client, error = _client_auth(req, body)
    if error:
        return error
    grant = str(body.get("grant_type") or "")
    if grant == "authorization_code":
        code = str(body.get("code") or "")
        redirect_uri = str(body.get("redirect_uri") or "")
        verifier = str(body.get("code_verifier") or "")
        if not code or not redirect_uri or not VERIFIER_RE.match(verifier):
            return _json_err("invalid_request", "code, redirect_uri and code_verifier are required")
        row = await oidc_store.consume_code(code, client_id, redirect_uri)
        if not row:
            return _json_err("invalid_grant", "authorization code invalid")
        if not hmac.compare_digest(str(row["code_challenge"]), _pkce_value(verifier)):
            return _json_err("invalid_grant", "PKCE verification failed")
        user = await asyncio.to_thread(db.get, "SELECT id, username FROM users WHERE id = ?", (row["userid"],))
        if not user:
            return _json_err("invalid_grant", "account unavailable")
        sid = secrets.token_urlsafe(24)
        await oidc_store.create_session(sid, row["userid"], client_id, row["scope"], row["auth_time"])
        result = {
            "access_token": jwtx.sign_jwt(_access_payload(user["id"], sid, client_id, row["scope"])),
            "token_type": "Bearer",
            "expires_in": cfg.OIDC_ACCESS_TTL_SECONDS,
            "id_token": jwtx.sign_jwt(_id_payload(user["id"], client_id, sid, row["nonce"], row["auth_time"])),
            "scope": row["scope"],
        }
        if str(client.get("secret") or ""):
            refresh = secrets.token_urlsafe(48)
            await oidc_store.create_refresh(refresh, sid, row["userid"], client_id, row["scope"])
            result["refresh_token"] = refresh
        await _cleanup_quiet()
        return _resp_json(result)
    if grant == "refresh_token":
        if not str(client.get("secret") or ""):
            return _json_err("unauthorized_client", "refresh_token grant requires a confidential client")
        token = str(body.get("refresh_token") or "")
        if not token:
            return _json_err("invalid_request", "refresh_token is required")
        found = await oidc_store.find_refresh(token)
        if not found or found["client_id"] != client_id:
            return _json_err("invalid_grant", "refresh token invalid")
        row, state = await oidc_store.consume_refresh(token)
        if state == "reused":
            await oidc_store.revoke_session(row["sid"])
            a("oidc refresh token reuse detected, session revoked", "WARN")
            return _json_err("invalid_grant", "refresh token reuse detected")
        if state != "ok":
            return _json_err("invalid_grant", "refresh token invalid")
        if row["client_id"] != client_id:
            return _json_err("invalid_grant", "refresh token invalid")
        session = await oidc_store.session_active(row["sid"], client_id, row["userid"])
        if not session:
            return _json_err("invalid_grant", "grant revoked")
        user = await asyncio.to_thread(db.get, "SELECT id FROM users WHERE id = ?", (row["userid"],))
        if not user:
            return _json_err("invalid_grant", "account unavailable")
        await oidc_store.touch_session(row["sid"])
        refresh = secrets.token_urlsafe(48)
        await oidc_store.create_refresh(refresh, row["sid"], row["userid"], client_id, session["scopes"])
        await _cleanup_quiet()
        return _resp_json({
            "access_token": jwtx.sign_jwt(_access_payload(user["id"], row["sid"], client_id, session["scopes"])),
            "token_type": "Bearer",
            "expires_in": cfg.OIDC_ACCESS_TTL_SECONDS,
            "refresh_token": refresh,
            "scope": session["scopes"],
        })
    return _json_err("unsupported_grant_type", "grant type unsupported")


@router.get("/oidc/userinfo")
@router.post("/oidc/userinfo")
async def oidc_userinfo(req: Request):
    if not cfg.OIDC_ENABLED:
        return _disabled()
    if not _limit(req, "userinfo", USERINFO_MAX_PER_IP, WINDOW_1M):
        return _json_err("temporarily_unavailable", "too many requests", 429)
    header = req.headers.get("authorization", "")
    token = header[7:].strip() if header[:7].lower() == "bearer " else ""
    if not token:
        return _json_err("invalid_token", "bearer token required", 401)
    payload = jwtx.verify_jwt(token)
    client_id = str((payload or {}).get("client_id") or "")
    if not payload or payload.get("oidc") is not True or not client_id:
        return _json_err("invalid_token", "bearer token invalid", 401)
    if not _client_lookup(client_id) or payload.get("resource") != client_id or payload.get("aud") != [client_id]:
        return _json_err("invalid_token", "bearer token invalid", 401)
    try:
        userid = int(payload.get("sub") or "")
    except (TypeError, ValueError):
        return _json_err("invalid_token", "bearer token invalid", 401)
    if not await oidc_store.session_active(payload.get("sid"), client_id, userid):
        return _json_err("invalid_token", "session revoked", 401)
    user = await asyncio.to_thread(
        db.get, "SELECT id, username, nickname, avatar, bio FROM users WHERE id = ?", (userid,))
    if not user:
        return _json_err("invalid_token", "account unavailable", 401)
    result = {"sub": str(user["id"])}
    if "profile" in set(str(payload.get("scope") or "").split()):
        result["nickname"] = user["nickname"] or user["username"]
        result["avatar"] = user["avatar"] or ""
        result["bio"] = user["bio"] or ""
    return _resp_json(result)


@router.post("/oidc/revoke")
async def oidc_revoke(req: Request):
    if not cfg.OIDC_ENABLED:
        return _disabled()
    if not _limit(req, "revoke", REVOKE_MAX_PER_IP, WINDOW_1M):
        return _json_err("temporarily_unavailable", "too many requests", 429)
    body, error = await _read_body(req)
    if error:
        return error
    client_id, client, error = _client_auth(req, body)
    if error:
        return error
    token = str(body.get("token") or "")
    if token:
        if token.count(".") == 2:
            payload = jwtx.verify_jwt(token)
            if payload and payload.get("client_id") == client_id and payload.get("sid"):
                await oidc_store.revoke_session(payload["sid"])
        else:
            row = await oidc_store.find_refresh(token)
            if row and row["client_id"] == client_id:
                await oidc_store.revoke_session(row["sid"])
    return _resp_json({})
