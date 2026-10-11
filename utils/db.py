import os
import sqlite3
import threading

from .log import a

_path: str = None
_local = threading.local()
_conns: set = set()
_conns_lock = threading.Lock()


def _make_conn(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.commit()
    with _conns_lock:
        _conns.add(conn)
    return conn


def _conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _make_conn(_path)
        _local.conn = conn
    return conn


def connect(path: str) -> None:
    global _path
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    _path = path
    _local.conn = None


def close() -> None:
    with _conns_lock:
        for conn in list(_conns):
            try:
                conn.close()
            except Exception:
                pass
            _conns.discard(conn)
        _path = None
    _local.conn = None


def query(sql: str, args: tuple = ()) -> list:
    cur = _conn().execute(sql, args)
    rows = cur.fetchall()
    cur.close()
    return [dict(r) for r in rows]


def get(sql: str, args: tuple = ()):
    rows = query(sql, args)
    return rows[0] if rows else None


def run(sql: str, args: tuple = ()) -> int:
    conn = _conn()
    try:
        cur = conn.execute(sql, args)
        conn.commit()
        return cur.lastrowid
    except Exception:
        conn.rollback()
        raise


def run_many(sql: str, seq: list) -> None:
    conn = _conn()
    conn.executemany(sql, seq)
    conn.commit()
