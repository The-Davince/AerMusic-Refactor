import threading
import time

import config as cfg
from utils.log import a

try:
    import redis as _redis
except ImportError:
    _redis = None

_client = None
_lock = threading.Lock()
_disabled_until = 0.0
_warned = set()

_SCRIPT = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if current + amount > limit then
    return 0
end
redis.call('INCRBY', KEYS[1], amount)
if current == 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[3])
end
return 1
"""


def _warn_once(kind, message):
    if kind in _warned:
        return
    with _lock:
        if kind in _warned:
            return
        _warned.add(kind)
    a(message, "WARN")


def _mark_failed(error):
    global _disabled_until
    with _lock:
        _disabled_until = time.monotonic() + cfg.REDIS_RETRY_SECONDS
    _warn_once("connection", f"redis rate limit unavailable: {type(error).__name__}, fallback to process memory")


def _get_client():
    global _client
    if not cfg.REDIS_URL or _redis is None:
        return None
    if time.monotonic() < _disabled_until:
        return None
    if _client is not None:
        return _client
    with _lock:
        if _client is None:
            _client = _redis.Redis.from_url(
                cfg.REDIS_URL,
                socket_connect_timeout=cfg.REDIS_TIMEOUT,
                socket_timeout=cfg.REDIS_TIMEOUT,
                health_check_interval=30,
                decode_responses=False,
            )
    return _client


def allow_redis(key, amount, limit, window_seconds):
    if not cfg.REDIS_URL:
        return None
    if _redis is None:
        _warn_once("dependency", "REDIS_URL is configured but redis package is unavailable, fallback to process memory")
        return None
    try:
        client = _get_client()
        if client is None:
            return None
        result = client.eval(
            _SCRIPT,
            1,
            f"{cfg.REDIS_RATE_PREFIX}{key}",
            int(amount),
            int(limit),
            int(window_seconds),
        )
        return bool(int(result))
    except Exception as error:
        _mark_failed(error)
        return None
