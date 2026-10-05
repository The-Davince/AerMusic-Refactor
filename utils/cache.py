import time
import threading

import config as cfg

_store: dict = {}
_lock = threading.Lock()


def _evict(now: float) -> None:
    soft = max(100, cfg.CACHE_MAX_ENTRIES // 2)
    hard = max(150, cfg.CACHE_MAX_ENTRIES)
    if len(_store) <= soft:
        return
    dead = [k for k, (_, exp) in _store.items() if exp <= now]
    for k in dead:
        _store.pop(k, None)
    if len(_store) > hard:
        keep = sorted(_store.items(), key=lambda kv: kv[1][1], reverse=True)[:soft]
        _store.clear()
        _store.update(dict(keep))


def get(key: str):
    with _lock:
        item = _store.get(key)
        if not item:
            return None
        data, exp = item
        if exp <= time.time():
            _store.pop(key, None)
            return None
        return data


def put(key: str, data, ttl: int) -> None:
    if ttl <= 0:
        return
    now = time.time()
    with _lock:
        _store[key] = (data, now + ttl)
        _evict(now)


def clear() -> None:
    with _lock:
        _store.clear()
