import time
import threading
import json

import config as cfg

_store: dict = {}
_lock = threading.Lock()
_bytes = 0


def _size(data) -> int:
    if isinstance(data, (bytes, bytearray, memoryview)):
        return len(data)
    if isinstance(data, str):
        return len(data.encode("utf-8", "replace"))
    try:
        return len(json.dumps(data, ensure_ascii=False, default=str).encode("utf-8"))
    except Exception:
        return len(repr(data).encode("utf-8", "replace"))


def _evict(now: float) -> None:
    global _bytes
    soft = max(100, cfg.CACHE_MAX_ENTRIES // 2)
    hard = max(150, cfg.CACHE_MAX_ENTRIES)
    if len(_store) <= soft and _bytes <= cfg.CACHE_MAX_BYTES:
        return
    dead = [k for k, (_, exp, _) in _store.items() if exp <= now]
    for k in dead:
        item = _store.pop(k, None)
        if item:
            _bytes -= item[2]
    if len(_store) > hard or _bytes > cfg.CACHE_MAX_BYTES:
        keep = []
        total = 0
        for key, item in sorted(_store.items(), key=lambda kv: kv[1][1], reverse=True):
            if len(keep) >= soft or total + item[2] > cfg.CACHE_MAX_BYTES:
                continue
            keep.append((key, item))
            total += item[2]
        _store.clear()
        _store.update(dict(keep))
        _bytes = total


def get(key: str):
    with _lock:
        item = _store.get(key)
        if not item:
            return None
        data, exp, _ = item
        if exp <= time.time():
            global _bytes
            _bytes -= item[2]
            _store.pop(key, None)
            return None
        return data


def put(key: str, data, ttl: int) -> None:
    global _bytes
    if ttl <= 0:
        return
    now = time.time()
    with _lock:
        size = _size(data)
        if size > cfg.CACHE_MAX_BYTES:
            return
        old = _store.get(key)
        if old:
            _bytes -= old[2]
        _store[key] = (data, now + ttl, size)
        _bytes += size
        _evict(now)


def clear() -> None:
    global _bytes
    with _lock:
        _store.clear()
        _bytes = 0
