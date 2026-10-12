import asyncio
import socket
from ipaddress import ip_address
from urllib.parse import urlparse

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

import config as cfg
from utils import cache, upstream
from utils.log import a, get_log_id, _get_real_ip
from utils.rate_limit import allow_local

router = APIRouter()

MUSIC_MAX_PER_IP = 600
MUSIC_WINDOW_SECONDS = 10
COVER_MAX_PER_IP = 2000
COVER_WINDOW_SECONDS = 60

# 路径与旧版前端保持一致, 前端一行不用改
_ROUTES = [
    "song/url",
]


def _route(name: str):
    async def handler(req: Request):
        log_id = get_log_id(req)
        if not allow_local("music|" + _get_real_ip(req), MUSIC_MAX_PER_IP, MUSIC_WINDOW_SECONDS):
            return JSONResponse(status_code=429, content={"code": 429, "msg": "请求过于频繁", "data": None, "logId": log_id})
        try:
            data = await upstream.fetch(name, req.query_params)
        except upstream.UpstreamError as e:
            return JSONResponse(status_code=e.status, content={"code": e.status, "msg": e.msg, "data": None, "logId": log_id})
        except Exception as e:
            a(f"music proxy {name} crashed: {type(e).__name__}: {e}", "ERROR", log_id)
            return JSONResponse(status_code=500, content={"code": 500, "msg": "服务开小差了", "data": None, "logId": log_id})
        resp = JSONResponse(data)
        resp.headers["X-Log-Id"] = log_id
        return resp
    return handler


def _is_blocked_address(value: str) -> bool:
    address = ip_address(value)
    return any((not address.is_global, address.is_private, address.is_loopback,
                address.is_link_local, address.is_reserved, address.is_unspecified,
                address.is_multicast))


for _name in _ROUTES:
    router.add_api_route(f"/{_name}", _route(_name), methods=["GET"])


# 封面代理: 取色需要 canvas 读像素, 网易图床多数不带 CORS 头, 由后端代抓并补 CORS 头
@router.get("/cover")
async def cover(req: Request):
    log_id = get_log_id(req)
    u = (req.query_params.get("u") or "").strip()
    if not u or len(u) > 500:
        return JSONResponse(status_code=400, content={"code": 400, "msg": "参数不合法", "data": None, "logId": log_id})
    try:
        parsed = urlparse(u)
        host = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError:
        return JSONResponse(status_code=400, content={"code": 400, "msg": "参数不合法", "data": None, "logId": log_id})
    if parsed.scheme not in ("http", "https") or not host:
        return JSONResponse(status_code=400, content={"code": 400, "msg": "参数不合法", "data": None, "logId": log_id})
    try:
        address = ip_address(host)
        if _is_blocked_address(str(address)):
            return JSONResponse(status_code=403, content={"code": 403, "msg": "来源不在白名单", "data": None, "logId": log_id})
    except ValueError:
        pass
    if port not in (None, 80, 443):
        return JSONResponse(status_code=403, content={"code": 403, "msg": "来源不在白名单", "data": None, "logId": log_id})
    if not any(host == h or host.endswith("." + h) for h in cfg.COVER_ALLOW_HOSTS):
        return JSONResponse(status_code=403, content={"code": 403, "msg": "来源不在白名单", "data": None, "logId": log_id})
    key = "cover|" + u
    hit = cache.get(key)
    if hit is not None:
        body, ctype = hit
        return Response(content=body, media_type=ctype,
                        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"})
    if not allow_local("cover|" + _get_real_ip(req), COVER_MAX_PER_IP, COVER_WINDOW_SECONDS):
        return JSONResponse(status_code=429, content={"code": 429, "msg": "请求过于频繁", "data": None, "logId": log_id})
    try:
        resolved = await asyncio.to_thread(socket.getaddrinfo, host, port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        addresses = {item[4][0] for item in resolved if item[4]}
        if not addresses or any(_is_blocked_address(value) for value in addresses):
            return JSONResponse(status_code=403, content={"code": 403, "msg": "来源不在白名单", "data": None, "logId": log_id})
    except (OSError, ValueError):
        return JSONResponse(status_code=502, content={"code": 502, "msg": "封面地址无法解析", "data": None, "logId": log_id})
    try:
        resp = await upstream._client.get(u, timeout=10, follow_redirects=False)
    except Exception as e:
        a(f"cover proxy failed: {u} {type(e).__name__}", "WARN", log_id)
        return JSONResponse(status_code=502, content={"code": 502, "msg": "封面获取失败", "data": None, "logId": log_id})
    if resp.status_code != 200 or len(resp.content) > 1024 * 1024:
        return JSONResponse(status_code=502, content={"code": 502, "msg": "封面获取失败", "data": None, "logId": log_id})
    ctype = resp.headers.get("content-type", "application/octet-stream")
    if not ctype.lower().startswith("image/"):
        return JSONResponse(status_code=400, content={"code": 400, "msg": "不是图片", "data": None, "logId": log_id})
    body = resp.content
    cache.put(key, (body, ctype), 3600)
    return Response(content=body, media_type=ctype,
                    headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"})
