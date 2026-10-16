import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from urllib.parse import urlparse
import ipaddress

import config as cfg
from utils import upstream
from utils.log import a, get_log_id, _get_real_ip
from utils.rate_limit import allow

router = APIRouter()

PROXY_MAX_PER_IP = 1500
PROXY_WINDOW_SECONDS = 10
MAX_PARAMS = 12
MAX_PARAM_LEN = 120
MAX_KEY_LEN = 24
PROXY_MAX_CONCURRENCY = 64
_proxy_slots = asyncio.Semaphore(PROXY_MAX_CONCURRENCY)


def _is_internal_base(base: str) -> bool:
    try:
        host = (urlparse(base).hostname or "").lower().rstrip(".")
        if not host:
            return False
        if host in ("localhost",) or host.endswith((".local", ".internal")) or "." not in host:
            return True
        return ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False

# 上游与本站同机/内网时, 前端不再直连上游, 改走这里(白名单=前端实际用到的路径, 防止变成开放入口)
ALLOWED_PATHS = (
    "cloudsearch",
    "song/detail",
    "simi/song",
    "simi/artist",
    "simi/playlist",
    "recommend/songs",
    "artist/top/song",
    "artist/detail",
    "artist/album",
    "artists",
    "album",
    "top/playlist",
    "playlist/track/all",
    "personalized",
    "personalized/newsong",
    "search/suggest",
)


def _clean_params(query) -> dict:
    params = {}
    for key, value in query.items():
        if len(params) >= MAX_PARAMS or not key or len(key) > MAX_KEY_LEN:
            break
        if not key.replace("_", "").isalnum():
            continue
        value = str(value)
        if any(ord(ch) < 32 for ch in value):
            continue
        params[key] = value[:MAX_PARAM_LEN]
    return params


def _fail(status: int, msg: str, log_id: str):
    return JSONResponse(status_code=status, content={"code": status, "msg": msg, "data": None, "logId": log_id})


@router.get("/up/{path:path}")
async def upstreamProxy(req: Request, path: str):
    log_id = get_log_id(req)
    if path not in ALLOWED_PATHS:
        return _fail(404, "接口不存在", log_id)
    if not _is_internal_base(cfg.NETEASE_API_BASE):
        return _fail(404, "接口不存在", log_id)
    if not allow("up|" + _get_real_ip(req), PROXY_MAX_PER_IP, PROXY_WINDOW_SECONDS):
        return _fail(429, "请求过于频繁", log_id)
    try:
        async with _proxy_slots:
            data = await upstream.api_get(path, _clean_params(req.query_params), ttl=cfg.UP_PROXY_TTL)
    except upstream.UpstreamError as e:
        return _fail(e.status, e.msg, log_id)
    except Exception as e:
        a(f"upstream proxy {path} crashed: {type(e).__name__}: {e}", "ERROR", log_id)
        return _fail(500, "服务开小差了", log_id)
    resp = JSONResponse(data)
    resp.headers["X-Log-Id"] = log_id
    return resp


@router.get("/upl")
async def lyricProxy(req: Request):
    log_id = get_log_id(req)
    if not _is_internal_base(cfg.NETEASE_LYRIC_BASE):
        return _fail(404, "接口不存在", log_id)
    if not allow("upl|" + _get_real_ip(req), PROXY_MAX_PER_IP, PROXY_WINDOW_SECONDS):
        return _fail(429, "请求过于频繁", log_id)
    try:
        async with _proxy_slots:
            data = await upstream.api_get("", _clean_params(req.query_params), base=cfg.NETEASE_LYRIC_BASE)
    except upstream.UpstreamError as e:
        return _fail(e.status, e.msg, log_id)
    except Exception as e:
        a(f"lyric proxy crashed: {type(e).__name__}: {e}", "ERROR", log_id)
        return _fail(500, "服务开小差了", log_id)
    resp = JSONResponse(data)
    resp.headers["X-Log-Id"] = log_id
    return resp
