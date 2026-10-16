import json
import time
from urllib.parse import urlencode

import httpx
from httpx import Limits

from . import cache
from .log import log_ext
import config as cfg

_client: httpx.AsyncClient = None

ENDPOINTS = {
    "song/url": {"up": lambda: cfg.NETEASE_URL_API, "ttl": 600, "need": ("id",), "urlkey": True},
}

import re as _re
_NUM_RE = _re.compile(r"^\d{1,15}(,\d{1,15})*$")


class UpstreamError(Exception):
    def __init__(self, msg: str, status: int = 502):
        self.msg = msg
        self.status = status


def init() -> None:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=cfg.UPSTREAM_TIMEOUT,
            follow_redirects=False,
            limits=Limits(max_connections=cfg.UPSTREAM_MAX_CONNECTIONS,
                          max_keepalive_connections=cfg.UPSTREAM_MAX_KEEPALIVE),
        )


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _build_params(name: str, ep: dict, qp) -> dict:
    params = {}
    for field in ep.get("need", ()):
        val = (qp.get(field) or "").strip()
        if not val:
            raise UpstreamError(f"缺少参数 {field}", 400)
        if field in ("id", "ids"):
            if not _NUM_RE.match(val):
                raise UpstreamError(f"参数 {field} 不合法", 400)
            if len(val) > 200:
                raise UpstreamError(f"参数 {field} 过长", 400)
        else:
            val = val[:120]
        params[field] = val
    if ep.get("urlkey"):
        if not cfg.NETEASE_URL_KEY:
            raise UpstreamError("音源URL服务未配置", 500)
        params["key"] = cfg.NETEASE_URL_KEY
    return params


def _cacheKey(name: str, params: dict) -> str:
    # urlencode 消除 &/= 歧义; key 不参与(避免秘钥进键)
    clean = {k: v for k, v in params.items() if k != "key"}
    return name + "|" + urlencode(sorted(clean.items()))


async def fetch(name: str, qp) -> dict:
    ep = ENDPOINTS.get(name)
    if ep is None:
        raise UpstreamError(f"未知接口 {name}", 404)
    params = _build_params(name, ep, qp)
    key = _cacheKey(name, params)
    hit = cache.get(key)
    if hit is not None:
        return hit
    url = ep["up"]()
    last_err = None
    data = None
    for attempt in range(max(1, cfg.UPSTREAM_RETRIES)):
        t0 = time.time()
        try:
            data = await _request_json(url, params)
            break
        except UpstreamError as error:
            if error.status == 400:
                raise
            last_err = error
            continue
        except (httpx.TimeoutException, httpx.TransportError) as e:
            last_err = UpstreamError("上游API请求失败")
            log_ext("netease", "GET", url, status=0, resp_body=f"{type(e).__name__}: {e}", elapsed_ms=(time.time() - t0) * 1000)
    if data is None:
        raise last_err or UpstreamError("上游API请求失败")
    _post_process(name, data)
    cache.put(key, data, ep["ttl"])
    return data


def _post_process(name: str, data) -> None:
    if name == "song/url" and isinstance(data, dict):
        u = data.get("url")
        if isinstance(u, str) and u.startswith("http://"):
            data["url"] = "https://" + u[len("http://"):]


async def api_get(path: str, params: dict, ttl: int = 0, base: str = "") -> dict:
    # 后端自己的上游调用(代理端点/推荐引擎), 复用同一个 httpx 客户端与进程内缓存
    if _client is None:
        init()
    url = (base or cfg.NETEASE_API_BASE).rstrip("/")
    if path:
        url += "/" + path.strip("/")
    key = "api|" + url + "|" + urlencode(sorted((k, str(v)) for k, v in params.items()))
    if ttl > 0:
        hit = cache.get(key)
        if hit is not None:
            return hit
    last_error = None
    for _ in range(max(1, cfg.UPSTREAM_RETRIES)):
        try:
            data = await _request_json(url, params)
            break
        except UpstreamError as error:
            last_error = error
        except (httpx.TimeoutException, httpx.TransportError) as error:
            last_error = UpstreamError("上游API请求失败")
    else:
        raise last_error or UpstreamError("上游API请求失败")
    if ttl > 0 and isinstance(data, (dict, list)):
        cache.put(key, data, ttl)
    return data


async def _request_json(url: str, params: dict):
    t0 = time.time()
    try:
        async with _client.stream("GET", url, params=params) as resp:
            status = resp.status_code
            if 300 <= status < 400:
                log_ext("netease", "GET", url, status=status, elapsed_ms=(time.time() - t0) * 1000)
                raise UpstreamError("上游不接受重定向", 502)
            if status >= 500:
                log_ext("netease", "GET", url, status=status, elapsed_ms=(time.time() - t0) * 1000)
                raise UpstreamError("上游API请求失败")
            if status >= 400:
                log_ext("netease", "GET", url, status=status, elapsed_ms=(time.time() - t0) * 1000)
                raise UpstreamError("上游API请求失败", 502)
            content_length = resp.headers.get("content-length", "")
            if content_length.isdigit() and int(content_length) > cfg.UPSTREAM_MAX_RESPONSE_BYTES:
                raise UpstreamError("上游响应过大", 502)
            chunks = []
            total = 0
            async for chunk in resp.aiter_bytes():
                total += len(chunk)
                if total > cfg.UPSTREAM_MAX_RESPONSE_BYTES:
                    raise UpstreamError("上游响应过大", 502)
                chunks.append(chunk)
            try:
                data = json.loads(b"".join(chunks))
            except (ValueError, UnicodeDecodeError):
                log_ext("netease", "GET", url, status=status, resp_body="non-json body", elapsed_ms=(time.time() - t0) * 1000)
                raise UpstreamError("上游响应不是合法JSON")
            log_ext("netease", "GET", url, status=status, elapsed_ms=(time.time() - t0) * 1000)
            return data
    except (httpx.TimeoutException, httpx.TransportError) as error:
        log_ext("netease", "GET", url, status=0, resp_body=f"{type(error).__name__}: {error}", elapsed_ms=(time.time() - t0) * 1000)
        raise UpstreamError("上游API请求失败")
