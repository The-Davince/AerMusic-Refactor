import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from utils.log import a, ga, set_req_log_id, clean_parent_chain, _get_real_ip

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "SAMEORIGIN",
    # 只锁不砸业务的三条: 自定义样式/音源要按用户填的外网 URL 加载 JS/CSS(style-core 动态 <script>),
    # 不能锁 script-src/connect-src, 否则开发者特性直接失效
    "Content-Security-Policy": "object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


def _safe_path(path: str) -> str:
    return path.replace("\n", "").replace("\r", "")


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        log_id = ga()
        parent = clean_parent_chain(request.headers.get("X-Request-Log-Id", ""))
        set_req_log_id(log_id, parent)
        request.state.reqId = log_id
        t0 = time.time()
        request.state.t0 = t0
        try:
            resp = await call_next(request)
        except Exception as e:
            a(f"http {request.method} {_safe_path(request.url.path)} crashed: {type(e).__name__}: {e}", "ERROR", log_id)
            raise
        elapsed = (time.time() - t0) * 1000
        request.state.elapsed_ms = elapsed
        for k, v in SECURITY_HEADERS.items():
            resp.headers.setdefault(k, v)
        resp.headers["X-Log-Id"] = log_id
        if request.url.path != "/api/health":
            a(f"http {request.method} {_safe_path(request.url.path)} status={resp.status_code} "
              f"elapsed={round(elapsed, 1)}ms ip={_get_real_ip(request)}", "INFO", log_id)
        return resp


class CorsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        import config as cfg
        origin = request.headers.get("origin", "")
        allowed = origin and origin in cfg.CORS_ALLOWED_ORIGINS
        if request.method == "OPTIONS" and allowed:
            resp = Response(status_code=204)
        else:
            resp = await call_next(request)
        if allowed:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Credentials"] = "true"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
            resp.headers["Vary"] = "Origin"
        return resp
