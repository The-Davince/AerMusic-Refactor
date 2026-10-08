import time
from urllib.parse import urlencode

import httpx

from . import cache
from .log import log_ext
import config as cfg

_client: httpx.AsyncClient = None

# 全站唯一的上游接口表, 前端路径 /api/<name> 一一对应
ENDPOINTS = {
    "search":               {"up": lambda: cfg.NETEASE_API_BASE + "/cloudsearch",   "ttl": 300,  "need": ("keywords",),              "limit": True},
    "song/detail":          {"up": lambda: cfg.NETEASE_API_BASE + "/song/detail",   "ttl": 600,  "need": ("ids",)},
    "song/url":             {"up": lambda: cfg.NETEASE_URL_API,                     "ttl": 600,  "need": ("id",),                    "urlkey": True},
    "lyric":                {"up": lambda: cfg.NETEASE_LYRIC_BASE,                  "ttl": 600,  "need": ("id",)},
    "artist/detail":        {"up": lambda: cfg.NETEASE_API_BASE + "/artist/detail", "ttl": 600,  "need": ("id",)},
    "artists":              {"up": lambda: cfg.NETEASE_API_BASE + "/artists",       "ttl": 600,  "need": ("id",)},
    "artist/album":         {"up": lambda: cfg.NETEASE_API_BASE + "/artist/album",  "ttl": 600,  "need": ("id",),                    "limit": True},
    "album":                {"up": lambda: cfg.NETEASE_API_BASE + "/album",         "ttl": 600,  "need": ("id",)},
    "search/suggest":       {"up": lambda: cfg.NETEASE_API_BASE + "/search/suggest","ttl": 120,  "need": ("keywords",)},
    "simi/song":            {"up": lambda: cfg.NETEASE_API_BASE + "/simi/song",     "ttl": 300,  "need": ("id",)},
    "simi/artist":          {"up": lambda: cfg.NETEASE_API_BASE + "/simi/artist",   "ttl": 300,  "need": ("id",)},
    "simi/playlist":        {"up": lambda: cfg.NETEASE_API_BASE + "/simi/playlist", "ttl": 300,  "need": ("id",)},
    "artist/top/song":      {"up": lambda: cfg.NETEASE_API_BASE + "/artist/top/song","ttl": 600, "need": ("id",)},
    "recommend/songs":      {"up": lambda: cfg.NETEASE_API_BASE + "/recommend/songs","ttl": 1800},
    "personalized/newsong": {"up": lambda: cfg.NETEASE_API_BASE + "/personalized/newsong","ttl": 1800, "limit": True},
    "personalized":         {"up": lambda: cfg.NETEASE_API_BASE + "/personalized",  "ttl": 1800, "limit": True},
    "top/playlist":         {"up": lambda: cfg.NETEASE_API_BASE + "/top/playlist",  "ttl": 1800, "need": (),                         "limit": True},
    "playlist/track/all":   {"up": lambda: cfg.NETEASE_API_BASE + "/playlist/track/all","ttl": 600, "need": ("id",),                   "limit": True},
}

import re as _re
_NUM_RE = _re.compile(r"^\d{1,15}(,\d{1,15})*$")
_ORDER_RE = _re.compile(r"^(hot|new)$")


class UpstreamError(Exception):
    def __init__(self, msg: str, status: int = 502):
        self.msg = msg
        self.status = status


def init() -> None:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=cfg.UPSTREAM_TIMEOUT, follow_redirects=True)


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
    if ep.get("limit"):
        try:
            limit = int(qp.get("limit") or 30)
        except ValueError:
            limit = 30
        params["limit"] = max(1, min(limit, cfg.MAX_LIMIT))
    if name == "search":
        try:
            t = int(qp.get("type") or 1)
        except ValueError:
            t = 1
        params["type"] = t if t in (1, 10, 100) else 1
    if name == "top/playlist":
        params["cat"] = (qp.get("cat") or "华语").strip()[:40]
        order = (qp.get("order") or "hot").strip()[:10]
        params["order"] = order if _ORDER_RE.match(order) else "hot"
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
            resp = await _client.get(url, params=params)
            log_ext("netease", "GET", url, status=resp.status_code, elapsed_ms=(time.time() - t0) * 1000)
            if resp.status_code >= 500:
                last_err = UpstreamError("上游API请求失败")
                continue
            if resp.status_code >= 400:
                raise UpstreamError("上游API请求失败", 502)
            try:
                data = resp.json()
            except ValueError:
                last_err = UpstreamError("上游响应不是合法JSON")
                log_ext("netease", "GET", url, status=resp.status_code, resp_body="non-json body", elapsed_ms=(time.time() - t0) * 1000)
                continue
            break
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
