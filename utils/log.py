import os
import sys as _sys
import re
import json
import time
import uuid
import hashlib
import threading
import asyncio
from contextvars import ContextVar
from datetime import datetime
from typing import Optional, Any
from collections import deque

_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
os.makedirs(_dir, exist_ok=True)
_lock = threading.Lock()
_queue: deque = deque()
_stopEvent = threading.Event()
_threadI: Optional[threading.Thread] = None

def _gen_log_id() -> str:
    now = datetime.now()
    ts = now.strftime("%Y%m%d%H%M%S")
    rand = uuid.uuid4().hex[:20]
    return f"{ts}{rand}"

def _gen_action_id(raw_request: str) -> str:
    now = datetime.now()
    ts = now.strftime("%Y%m%d%H%M%S")
    md5 = hashlib.md5(raw_request.encode("utf-8")).hexdigest()[:16]
    rand = uuid.uuid4().hex[:4]
    return f"{ts}{md5}{rand}"

def _getLog() -> str:
    today = datetime.now().strftime("%Y%m%d")
    return os.path.join(_dir, f"{today}.log")

_LOG_LEVEL_COLORS = {"DEBUG": "96", "INFO": "92", "WARN": "93", "ERROR": "91", "CRITICAL": "1;91", "ACTION": "95"}
_LOG_KEY_RE = re.compile(r"(?<![A-Za-z0-9_\-])([A-Za-z_][A-Za-z0-9_]*)(=)")
_LOG_EXT_RE = re.compile(r"(\[EXT:[^\]]*\])")


def _color_id(id_str: str) -> str:
    parts = [p for p in id_str.split(" -> ")]
    seg = [f"\x1b[90m{p}\x1b[0m" if i < len(parts) - 1 else f"\x1b[94m{p}\x1b[0m" for i, p in enumerate(parts)]
    return "\x1b[90m[\x1b[0m" + "\x1b[90m -> \x1b[0m".join(seg) + "\x1b[90m]\x1b[0m"


def _color_content(text: str) -> str:
    text = _LOG_EXT_RE.sub(lambda m: f"\x1b[1;95m{m.group(1)}\x1b[0m", text)
    out = []
    pos = 0
    for m in _LOG_KEY_RE.finditer(text):
        if m.start() > pos:
            out.append(text[pos:m.start()])
        out.append(f"\x1b[96m{m.group(1)}=\x1b[0m")
        pos = m.end()
    if pos < len(text):
        out.append(text[pos:])
    return "".join(out)


def _enable_vt_win() -> None:
    try:
        if os.name == "nt":
            import ctypes
            ctypes.windll.kernel32.SetConsoleMode(ctypes.windll.kernel32.GetStdHandle(-11), 0x0007)
    except Exception:
        pass


_enable_vt_win()
_color_tty = bool(_sys.stdout and _sys.stdout.isatty()) and os.environ.get("LOG_COLOR", "1") not in ("0", "false")


def _log(level: str, id_str: str, content: str) -> None:
    now = datetime.now()
    ts = now.strftime("%Y-%m-%d %H:%M:%S")
    timestamp = int(now.timestamp()*1000)
    line = f"[{level}][{id_str}][{ts}][{timestamp}] {content}\n"
    with _lock:
        log_file = _getLog()
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(line)
        if _color_tty:
            lc = _LOG_LEVEL_COLORS.get(level, "0")
            _sys.stdout.write(
                f"\x1b[{lc}m[{level}]\x1b[0m"
                + _color_id(id_str)
                + f"\x1b[90m[{ts}]\x1b[0m"
                + f"\x1b[90m[{timestamp}]\x1b[0m "
                + _color_content(content)
                + "\n")
        else:
            _sys.stdout.write(line)
        _sys.stdout.flush()

_ctx_log_id: ContextVar = ContextVar("log_id", default=None)
_ctx_parent: ContextVar = ContextVar("log_parent", default=None)
_CHAIN_SEG_RE = re.compile(r"^[A-Za-z0-9\-]{6,64}$")


def set_req_log_id(log_id: str, parent: Optional[str] = None):
    _ctx_log_id.set(log_id)
    _ctx_parent.set(parent or None)


def clean_parent_chain(raw: str) -> Optional[str]:
    if not raw or not isinstance(raw, str):
        return None
    raw = raw.strip()[:300]
    parts = [p.strip() for p in raw.split("->") if p.strip()]
    if not parts or len(parts) > 4:
        return None
    for p in parts:
        if not _CHAIN_SEG_RE.match(p):
            return None
    return " -> ".join(parts)


def cur_log_id() -> str:
    own = _ctx_log_id.get()
    parent = _ctx_parent.get()
    if parent:
        return f"{parent} -> {own}" if own else parent
    return own or _gen_log_id()


def child_log_id(child: str) -> str:
    if not child:
        return cur_log_id()
    return f"{cur_log_id()} -> {child}"


def _worker() -> None:
    while not _stopEvent.is_set() or _queue:
        if _queue:
            try:
                item = _queue.popleft()
                _log(*item)
            except Exception:
                pass
        else:
            _stopEvent.wait(0.1)

def stop() -> None:
    _stopEvent.set()
    if _threadI is not None:
        _threadI.join(timeout=3.0)


def _onwriter() -> None:
    global _threadI
    if _threadI is None or not _threadI.is_alive():
        _threadI = threading.Thread(target=_worker, daemon=True)
        _threadI.start()

def get_log_id(request) -> str:
    return getattr(request.state, "reqId", "") or ga()


def ga() -> str:
    _onwriter()
    log_id = _gen_log_id()
    return log_id

def gb(request: Any) -> str:
    _onwriter()
    raw = str(request)
    action_id = _gen_action_id(raw)
    return action_id


def a(content: str, level: str = "INFO", log_id: str = None) -> str:
    _onwriter()
    own = _ctx_log_id.get()
    if log_id is None or (own and log_id == own):
        log_id = cur_log_id()
    _queue.append((level, log_id, content))
    return log_id


def b(content: str, request: Any) -> str:
    _onwriter()
    raw = str(request)
    action_id = _gen_action_id(raw)
    _queue.append(("ACTION", action_id, content))
    return action_id


from functools import lru_cache as _lru


@_lru(maxsize=256)
def _in_trusted_proxies(peer: str, proxies: tuple) -> bool:
    import ipaddress
    try:
        p = ipaddress.ip_address(peer)
    except ValueError:
        return False
    for item in proxies:
        try:
            if p in ipaddress.ip_network(item, strict=False):
                return True
        except ValueError:
            continue
    return False


def _get_real_ip(request) -> str:
    import ipaddress

    def _valid(candidate):
        if not candidate:
            return None
        try:
            ipaddress.ip_address(candidate)
            return candidate
        except ValueError:
            return None

    peer = _valid(request.client.host) if request.client else None
    if peer:
        import config as _cfg
        if _in_trusted_proxies(peer, tuple(getattr(_cfg, "TRUSTED_PROXIES", ()) or ())):
            xff = request.headers.get("x-forwarded-for")
            if xff:
                last = _valid(xff.split(",")[-1].strip())
                if last:
                    return last
            real = _valid(request.headers.get("x-real-ip"))
            if real:
                return real
        return peer
    return "0.0.0.0"


def _clip(value, limit: int = 2048) -> str:
    try:
        s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        s = str(value)
    return s.replace(chr(10), " ").replace(chr(13), " ")[:limit]


def log_ext(service: str, method: str, url: str, status=None, req_body=None, resp_body=None, elapsed_ms=None, level: str = None, log_id: str = None) -> str:
    _onwriter()
    parts = [f"[EXT:netease] {method} {url}"]
    if status is not None:
        parts.append(f"status={status}")
    if elapsed_ms is not None:
        parts.append(f"elapsed={round(elapsed_ms, 1)}ms")
    if req_body is not None:
        parts.append(f"req={_clip(req_body, 1024)}")
    if resp_body is not None:
        parts.append(f"resp={_clip(resp_body, 2048)}")
    if level is None:
        level = "ERROR" if (isinstance(status, int) and status >= 500) else "INFO"
    return a(" ".join(parts), level, log_id)
