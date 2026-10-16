import threading
import time
from collections import deque

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

_RESERVE_SCRIPT = """
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local selected = {}
for i = 3, #ARGV do
    local value = ARGV[i]
    if redis.call('SISMEMBER', KEYS[1], value) == 0 and redis.call('SISMEMBER', KEYS[2], value) == 0 then
        redis.call('SADD', KEYS[1], value)
        redis.call('SADD', KEYS[2], value)
        table.insert(selected, value)
        if #selected >= limit then
            break
        end
    end
end
if #selected > 0 then
    redis.call('EXPIRE', KEYS[1], ttl)
    redis.call('EXPIRE', KEYS[2], ttl)
end
return selected
"""


def _warn_once(kind, message, level="WARN"):
    if kind in _warned:
        return
    with _lock:
        if kind in _warned:
            return
        _warned.add(kind)
    a(message, level)


def _mark_failed(error):
    global _disabled_until
    with _lock:
        _disabled_until = time.monotonic() + cfg.REDIS_RETRY_SECONDS
    if isinstance(error, ValueError):
        _warn_once("config", f"redis config invalid: {error}", "ERROR")
    else:
        _warn_once("connection", f"redis rate limit unavailable: {type(error).__name__}, requests fail closed while retrying")


def _parse_address(address):
    if address.startswith("["):
        host, _, rest = address[1:].partition("]")
        port = int(rest.lstrip(":") or 6379)
    else:
        host, _, port_str = address.rpartition(":")
        if host and ":" not in host and port_str.isdigit():
            port = int(port_str)
        else:
            host, port = address, 6379
    if not 0 < port <= 65535:
        raise ValueError(f"REDIS_ADDRESS port out of range: {port}")
    return host, port


def _get_client():
    global _client
    if not cfg.REDIS_ADDRESS or _redis is None:
        return None
    if time.monotonic() < _disabled_until:
        return None
    if _client is not None:
        return _client
    with _lock:
        if _client is None:
            host, port = _parse_address(cfg.REDIS_ADDRESS)
            _client = _redis.Redis(
                host=host,
                port=port,
                username=cfg.REDIS_USERNAME or None,
                password=cfg.REDIS_PASSWORD or None,
                db=cfg.REDIS_DB,
                socket_connect_timeout=cfg.REDIS_TIMEOUT,
                socket_timeout=cfg.REDIS_TIMEOUT,
                health_check_interval=30,
                decode_responses=False,
            )
    return _client


def allow_redis(key, amount, limit, window_seconds):
    if not cfg.REDIS_ADDRESS:
        return None
    if _redis is None:
        _warn_once("dependency", "REDIS_ADDRESS is configured but redis package is unavailable, requests fail closed")
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


def reserve_redis(day_key, session_key, values, limit, ttl):
    if not cfg.REDIS_ADDRESS or not values:
        return None
    if _redis is None:
        _warn_once("dependency", "REDIS_ADDRESS is configured but redis package is unavailable")
        return None
    try:
        client = _get_client()
        if client is None:
            return None
        raw = client.eval(
            _RESERVE_SCRIPT,
            2,
            f"{cfg.REDIS_RATE_PREFIX}recommend:{day_key}",
            f"{cfg.REDIS_RATE_PREFIX}recommend:{session_key}",
            int(ttl),
            int(limit),
            *[str(value) for value in values],
        )
        return [item.decode("utf-8") if isinstance(item, bytes) else str(item) for item in raw]
    except Exception as error:
        _mark_failed(error)
        return None


_local_windows = {}
_local_lock = threading.Lock()
_LOCAL_MAX_KEYS = 8192
_LOCAL_CLEAN_BATCH = 256


def allow_local(key, limit, window_seconds):
    now = time.monotonic()
    with _local_lock:
        queue = _local_windows.setdefault(key, deque())
        while queue and now - queue[0] >= window_seconds:
            queue.popleft()
        if len(_local_windows) > 4096:
            for old_key in list(_local_windows)[:_LOCAL_CLEAN_BATCH]:
                if old_key != key:
                    old_queue = _local_windows.get(old_key)
                    if old_queue is not None and (not old_queue or now - old_queue[-1] >= window_seconds):
                        _local_windows.pop(old_key, None)
        while len(_local_windows) > _LOCAL_MAX_KEYS:
            victim = next(iter(_local_windows))
            if victim == key:
                keys = iter(_local_windows)
                next(keys, None)
                victim = next(keys, key)
            if victim == key:
                break
            _local_windows.pop(victim, None)
        if len(queue) >= limit:
            return False
        queue.append(now)
        return True


def allow(key, limit, window_seconds):
    shared = allow_redis(key, 1, limit, window_seconds)
    if shared is not None:
        return shared
    if cfg.REDIS_ADDRESS:
        return False
    return allow_local(key, limit, window_seconds)
