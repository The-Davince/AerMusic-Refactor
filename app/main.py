import importlib
import pkgutil
from contextlib import asynccontextmanager
from html import escape
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

import config as cfg
from utils import db, upstream
from utils.log import a, get_log_id
from app.middleware import RequestLogMiddleware, CorsMiddleware

_WEB_DIR = Path(__file__).resolve().parent.parent / "web"

_ERROR_MESSAGES = {
    400: "请求无效",
    401: "未登录或登录已过期",
    403: "没有权限访问",
    404: "页面不存在",
    500: "服务器开小差了, 请稍后再试",
}


def _error_page(status_code: int, log_id: str):
    body = (f"<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
            f"<title>{status_code} AerMusic</title></head>"
            f"<body style=\"background:#121212;color:#fff;font-family:system-ui;"
            f"display:flex;align-items:center;justify-content:center;height:100vh;margin:0;\">"
            f"<div style=\"text-align:center\"><h1>{status_code}</h1>"
            f"<p>{escape(_ERROR_MESSAGES.get(status_code, ''))}</p>"
            f"<p style=\"opacity:.4;font-size:12px\">logId: {escape(log_id or '-')}</p></div></body></html>")
    return HTMLResponse(body, status_code=status_code, headers={"Cache-Control": "no-store"})


async def not_found_handler(request: Request, exc):
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=404, content={"code": 404, "msg": "接口不存在", "logId": get_log_id(request)})
    return _error_page(404, get_log_id(request))


async def http_exception_handler(request: Request, exc: HTTPException):
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=exc.status_code, content={"code": exc.status_code, "msg": "请求无效", "logId": get_log_id(request)})
    return _error_page(exc.status_code, get_log_id(request))


async def server_error_handler(request: Request, exc):
    log_id = get_log_id(request)
    a(f"unhandled server error on {request.url.path}", "ERROR", log_id)
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=500, content={"code": 500, "msg": "服务器开小差了", "logId": log_id})
    return _error_page(500, log_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.connect(cfg.DATABASE_PATH)
    upstream.init()
    a(f"server started: {cfg.APP_NAME}")
    yield
    await upstream.aclose()
    db.close()
    a("stopping server")


app = FastAPI(title=cfg.APP_NAME, lifespan=lifespan, openapi_url=None, docs_url=None, redoc_url=None)
app.add_exception_handler(404, not_found_handler)
app.add_exception_handler(500, server_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_middleware(CorsMiddleware)
app.add_middleware(RequestLogMiddleware)


class AssetStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        resp = await super().get_response(path, scope)
        if resp.status_code == 200:
            resp.headers["Cache-Control"] = "public, max-age=3600"
        elif resp.status_code == 404:
            resp = JSONResponse(status_code=404, content={"code": 404, "msg": "asset not found"})
        return resp


if _WEB_DIR.exists():
    app.mount("/assets", AssetStaticFiles(directory=str(_WEB_DIR / "assets")), name="assets")


_index_cache: str = None


def _renderIndex() -> str:
    global _index_cache
    if _index_cache is None:
        raw = (_WEB_DIR / "index.html").read_text(encoding="utf-8")
        _index_cache = raw.replace("__APP_VER__", cfg.APP_VERSION)
    return _index_cache


@app.get("/")
async def index():
    return HTMLResponse(_renderIndex(), headers={"Cache-Control": "no-cache"})


@app.get("/index.html")
async def index_html():
    return HTMLResponse(_renderIndex(), headers={"Cache-Control": "no-cache"})


@app.get("/favicon.ico")
async def favicon_ico():
    return FileResponse(_WEB_DIR / "favicon.ico", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/favicon.svg")
async def favicon_svg():
    return FileResponse(_WEB_DIR / "favicon.svg", headers={"Cache-Control": "public, max-age=86400"})


def _load_routers():
    handlers_dir = Path(__file__).resolve().parent / "handlers"
    for module_info in pkgutil.iter_modules([str(handlers_dir)]):
        if module_info.name.startswith("_"):
            continue
        mod = importlib.import_module(f"app.handlers.{module_info.name}")
        if hasattr(mod, "router"):
            app.include_router(mod.router, prefix="/api")


_load_routers()
