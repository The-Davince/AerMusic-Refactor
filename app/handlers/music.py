from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from utils import upstream
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
