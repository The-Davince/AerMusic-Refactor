import os
import sqlite3
import threading
from .log import a

_lock = threading.Lock()
_conn: sqlite3.Connection = None


def connect(path: str) -> None:
    global _conn
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    _conn = sqlite3.connect(path, check_same_thread=False)
    _conn.row_factory = sqlite3.Row
    _conn.execute("PRAGMA journal_mode=WAL")
    _conn.execute("PRAGMA foreign_keys=ON")
    _conn.commit()


def close() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


def query(sql: str, args: tuple = ()) -> list:
    with _lock:
        cur = _conn.execute(sql, args)
        rows = cur.fetchall()
        cur.close()
        return [dict(r) for r in rows]


def get(sql: str, args: tuple = ()):
    rows = query(sql, args)
    return rows[0] if rows else None


def run(sql: str, args: tuple = ()) -> int:
    with _lock:
        try:
            cur = _conn.execute(sql, args)
            _conn.commit()
            return cur.lastrowid
        except Exception:
            _conn.rollback()
            raise


def run_many(sql: str, seq: list) -> None:
    with _lock:
        _conn.executemany(sql, seq)
        _conn.commit()
