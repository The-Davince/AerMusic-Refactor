import importlib
import pkgutil
from contextlib import asynccontextmanager
from html import escape
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import config as cfg
from utils import db, upstream
from utils.log import a, get_log_id
from app.middleware import RequestLogMiddleware, CorsMiddleware, SECURITY_HEADERS

_PAGE_DIR = Path(__file__).resolve().parent.parent / "page"
_PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
_DIST_DIR = Path(__file__).resolve().parent.parent / "dist"

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
        return JSONResponse(status_code=404, content={"code": 404, "msg": "接口不存在", "data": None, "logId": get_log_id(request)})
    return _error_page(404, get_log_id(request))


async def http_exception_handler(request: Request, exc: HTTPException):
    detail = getattr(exc, "detail", None) or "请求无效"
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=exc.status_code, content={"code": exc.status_code, "msg": str(detail), "data": None, "logId": get_log_id(request)})
    return _error_page(exc.status_code, get_log_id(request))


async def server_error_handler(request: Request, exc):
    log_id = get_log_id(request)
    a(f"unhandled server error on {request.url.path}", "ERROR", log_id)
    if request.url.path.startswith("/api/"):
        resp = JSONResponse(status_code=500, content={"code": 500, "msg": "服务器开小差了", "data": None, "logId": log_id})
    else:
        resp = _error_page(500, log_id)
    for k, v in SECURITY_HEADERS.items():
        resp.headers.setdefault(k, v)
    resp.headers["X-Log-Id"] = log_id
    return resp


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.connect(cfg.DATABASE_PATH)
    from setup import TABLES
    for ddl in TABLES:
        db.run(ddl)
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


class CDNStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        resp = await super().get_response(path, scope)
        if resp.status_code == 200:
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


if _PUBLIC_DIR.exists():
    app.mount("/static", CDNStaticFiles(directory=str(_PUBLIC_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(_PAGE_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/favicon.ico")
async def favicon_ico():
    p = _DIST_DIR / "favicon.ico"
    if not p.is_file():
        return JSONResponse(status_code=404, content={"code": 404, "msg": "not found", "data": None})
    return FileResponse(p, headers={"Cache-Control": "public, max-age=86400"})





def _resolve_page(full_path: str):
    page_dir = _PAGE_DIR.resolve()
    if not full_path:
        return page_dir / "index.html"
    rel = full_path.replace("\\", "/").strip("/")
    if not rel:
        return page_dir / "index.html"
    cand = page_dir / f"{rel}.html"
    if cand.is_file() and cand.resolve().is_relative_to(page_dir):
        return cand
    idx = page_dir / rel / "index.html"
    if idx.is_file() and idx.resolve().is_relative_to(page_dir):
        return idx
    return None


def _load_routers():
    handlers_dir = Path(__file__).resolve().parent / "handlers"
    for module_info in pkgutil.iter_modules([str(handlers_dir)]):
        if module_info.name.startswith("_"):
            continue
        mod = importlib.import_module(f"app.handlers.{module_info.name}")
        if hasattr(mod, "router"):
            app.include_router(mod.router, prefix="/api")


_load_routers()


@app.get("/{full_path:path}")
async def spa_fallback(request: Request, full_path: str):
    if full_path == "api" or full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"code": 404, "msg": "接口不存在", "data": None, "logId": get_log_id(request)})
    if full_path.startswith("static/"):
        return JSONResponse(status_code=404, content={"code": 404, "msg": "not found", "data": None, "logId": get_log_id(request)})
    page = _resolve_page(full_path)
    if page and page.is_file():
        return FileResponse(page, headers={"Cache-Control": "no-cache"})
    return _error_page(404, get_log_id(request))
