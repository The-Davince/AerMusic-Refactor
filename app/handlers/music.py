from urllib.parse import urlparse

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

import config as cfg
from utils import cache, upstream
from utils.log import a, get_log_id

router = APIRouter()

# 路径与旧版前端保持一致, 前端一行不用改
_ROUTES = [
    "search", "song/detail", "song/url", "lyric",
    "artist/detail", "artists", "artist/album", "album",
    "search/suggest", "simi/song", "simi/artist", "artist/top/song",
    "recommend/songs", "personalized/newsong", "personalized",
    "top/playlist", "playlist/track/all",
]


def _route(name: str):
    async def handler(req: Request):
        log_id = get_log_id(req)
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
    except ValueError:
        return JSONResponse(status_code=400, content={"code": 400, "msg": "参数不合法", "data": None, "logId": log_id})
    if parsed.scheme not in ("http", "https") or not host:
        return JSONResponse(status_code=400, content={"code": 400, "msg": "参数不合法", "data": None, "logId": log_id})
    if not any(host == h or host.endswith("." + h) for h in cfg.COVER_ALLOW_HOSTS):
        return JSONResponse(status_code=403, content={"code": 403, "msg": "来源不在白名单", "data": None, "logId": log_id})
    key = "cover|" + u
    hit = cache.get(key)
    if hit is not None:
        body, ctype = hit
    else:
        try:
            resp = await upstream._client.get(u, timeout=10)
        except Exception as e:
            a(f"cover proxy failed: {u} {type(e).__name__}", "WARN", log_id)
            return JSONResponse(status_code=502, content={"code": 502, "msg": "封面获取失败", "data": None, "logId": log_id})
        if resp.status_code != 200 or len(resp.content) > 2 * 1024 * 1024:
            return JSONResponse(status_code=502, content={"code": 502, "msg": "封面获取失败", "data": None, "logId": log_id})
        ctype = resp.headers.get("content-type", "application/octet-stream")
        if not ctype.lower().startswith("image/"):
            return JSONResponse(status_code=400, content={"code": 400, "msg": "不是图片", "data": None, "logId": log_id})
        body = resp.content
        cache.put(key, (body, ctype), 86400)
    return Response(content=body, media_type=ctype,
                    headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"})
