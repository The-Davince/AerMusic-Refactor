import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from utils.log import a, ga, set_req_log_id, clean_parent_chain, _get_real_ip

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "SAMEORIGIN",
}


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        log_id = ga()
        parent = clean_parent_chain(request.headers.get("X-Request-Log-Id", ""))
        set_req_log_id(log_id, parent)
        request.state.reqId = log_id
        t0 = time.time()
        try:
            resp = await call_next(request)
        except Exception as e:
            a(f"http {request.method} {request.url.path} crashed: {type(e).__name__}: {e}", "ERROR", log_id)
            raise
        elapsed = (time.time() - t0) * 1000
        request.state.elapsed_ms = elapsed
        for k, v in SECURITY_HEADERS.items():
            resp.headers.setdefault(k, v)
        resp.headers["X-Log-Id"] = log_id
        if request.url.path != "/api/health":
            a(f"http {request.method} {request.url.path} status={resp.status_code} "
              f"elapsed={round(elapsed, 1)}ms ip={_get_real_ip(request)}", "INFO", log_id)
        return resp


class CorsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        import config as cfg
        origin = request.headers.get("origin", "")
        resp = await call_next(request)
        if origin and origin in cfg.CORS_ALLOWED_ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Credentials"] = "true"
            resp.headers["Vary"] = "Origin"
        return resp
