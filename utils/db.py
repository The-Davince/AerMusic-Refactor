import os
import re
import sqlite3
import threading

import config as cfg
from .log import a

try:
    import psycopg2
    import psycopg2.extras
    import psycopg2.pool
    from psycopg2 import sql as pgsql
except ImportError:
    psycopg2 = None

_path: str = None
_local = threading.local()
_conns: set = set()
_conns_lock = threading.Lock()

_backend = "sqlite"
_pg_pool = None
_pg_slots = None
_pg_id_cols = {}
_insert_re = re.compile(r"^\s*INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE)
_dbname_re = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


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


def _backend_mode() -> str:
    if cfg.DB_BACKEND in ("sqlite", "pg"):
        return cfg.DB_BACKEND
    if cfg.DB_BACKEND != "auto":
        a(f"DB_BACKEND invalid: {cfg.DB_BACKEND}, use auto", "WARN")
    return "auto"


def storage_backend() -> str:
    return _backend


def _readable_error(error) -> str:
    if isinstance(error, UnicodeDecodeError) and isinstance(error.object, bytes):
        try:
            return " ".join(error.object.decode("gbk", "replace").split())
        except Exception:
            pass
    return " ".join(f"{type(error).__name__}: {error}".split())


def _parse_pg_address(address: str):
    if address.startswith("["):
        host, _, rest = address[1:].partition("]")
        port = int(rest.lstrip(":") or 5432)
    else:
        host, _, port_str = address.rpartition(":")
        if host and ":" not in host and port_str.isdigit():
            port = int(port_str)
        else:
            host, port = address, 5432
    if not host:
        raise ValueError("PGSQL_URL host is empty")
    if not 0 < port <= 65535:
        raise ValueError(f"PGSQL_URL port out of range: {port}")
    return host, port


def _pg_params(dbname: str) -> dict:
    host, port = _parse_pg_address(cfg.PGSQL_URL)
    return {
        "host": host,
        "port": port,
        "user": cfg.PGSQL_USERNAME or None,
        "password": cfg.PGSQL_PASSWORD or None,
        "dbname": dbname,
        "client_encoding": "UTF8",
        "connect_timeout": cfg.PGSQL_CONNECT_TIMEOUT,
    }


def _pg_ensure_database() -> None:
    name = cfg.PGSQL_DATABASE
    if not _dbname_re.match(name):
        raise ValueError(f"PGSQL_DATABASE invalid: {name}")
    conn = psycopg2.connect(**_pg_params("postgres"))
    try:
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
        if cur.fetchone() is None:
            cur.execute(pgsql.SQL("CREATE DATABASE {} ENCODING 'UTF8'").format(pgsql.Identifier(name)))
            a(f"postgres database created: {name}")
        cur.close()
    finally:
        conn.close()


def _pg_start() -> None:
    global _backend, _pg_pool, _pg_slots
    if psycopg2 is None:
        raise ValueError("psycopg2 is not installed")
    _pg_ensure_database()
    _pg_pool = psycopg2.pool.ThreadedConnectionPool(
        cfg.PGSQL_POOL_MIN, cfg.PGSQL_POOL_MAX, **_pg_params(cfg.PGSQL_DATABASE))
    _pg_slots = threading.BoundedSemaphore(cfg.PGSQL_POOL_MAX)
    _backend = "pg"


def _pg_get():
    _pg_slots.acquire()
    try:
        return _pg_pool.getconn()
    except Exception:
        _pg_slots.release()
        raise


def _pg_put(conn) -> None:
    try:
        _pg_pool.putconn(conn)
    finally:
        _pg_slots.release()


def _pg_sql(sql: str) -> str:
    return sql.replace("?", "%s")


def _pg_has_id(conn, table: str) -> bool:
    name = table.lower()
    if name in _pg_id_cols:
        return _pg_id_cols[name]
    cur = conn.cursor()
    cur.execute(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = %s AND column_name = 'id'",
        (name,),
    )
    found = cur.fetchone() is not None
    cur.close()
    _pg_id_cols[name] = found
    return found


def _pg_query(sql: str, args: tuple) -> list:
    conn = _pg_get()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(_pg_sql(sql), args)
        rows = cur.fetchall()
        cur.close()
        return [dict(row) for row in rows]
    finally:
        _pg_put(conn)


def _pg_run(sql: str, args: tuple) -> int:
    conn = _pg_get()
    try:
        cur = conn.cursor()
        stmt = _pg_sql(sql)
        match = _insert_re.match(stmt)
        want_id = bool(match) and _pg_has_id(conn, match.group(1))
        if want_id:
            stmt = stmt.rstrip().rstrip(";") + " RETURNING id"
        cur.execute(stmt, args)
        row = cur.fetchone() if want_id else None
        conn.commit()
        cur.close()
        return (row[0] if row else 0) or 0
    finally:
        _pg_put(conn)


def _pg_run_many(sql: str, seq: list) -> None:
    conn = _pg_get()
    try:
        cur = conn.cursor()
        cur.executemany(_pg_sql(sql), seq)
        conn.commit()
        cur.close()
    finally:
        _pg_put(conn)


def _pg_run_rowcount(sql: str, args: tuple) -> int:
    conn = _pg_get()
    try:
        cur = conn.cursor()
        cur.execute(_pg_sql(sql), args)
        n = cur.rowcount
        conn.commit()
        cur.close()
        return n
    finally:
        _pg_put(conn)


def connect(path: str) -> None:
    global _path, _backend
    mode = _backend_mode()
    if mode == "pg":
        try:
            _pg_start()
        except Exception as error:
            raise RuntimeError(f"postgres connect failed: {_readable_error(error)}") from error
        a(f"storage backend: pg {cfg.PGSQL_DATABASE}")
        return
    if mode == "auto" and cfg.PGSQL_DATABASE:
        try:
            _pg_start()
            a(f"storage backend: pg {cfg.PGSQL_DATABASE}")
            return
        except Exception as error:
            a(f"postgres unavailable, fallback to sqlite: {_readable_error(error)}", "WARN")
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    _path = path
    _backend = "sqlite"
    _local.conn = None
    a(f"storage backend: sqlite {path}")


def close() -> None:
    if _pg_pool is not None:
        _pg_pool.closeall()
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
    if _backend == "pg":
        return _pg_query(sql, args)
    cur = _conn().execute(sql, args)
    rows = cur.fetchall()
    cur.close()
    return [dict(r) for r in rows]


def get(sql: str, args: tuple = ()):
    rows = query(sql, args)
    return rows[0] if rows else None


def run(sql: str, args: tuple = ()) -> int:
    if _backend == "pg":
        return _pg_run(sql, args)
    conn = _conn()
    try:
        cur = conn.execute(sql, args)
        conn.commit()
        return cur.lastrowid
    except Exception:
        conn.rollback()
        raise


def run_rowcount(sql: str, args: tuple = ()) -> int:
    """执行 UPDATE/DELETE/INSERT 并返回影响行数, 用于原子单次消费(如 OIDC code/refresh token)"""
    if _backend == "pg":
        return _pg_run_rowcount(sql, args)
    conn = _conn()
    try:
        cur = conn.execute(sql, args)
        n = cur.rowcount
        conn.commit()
        cur.close()
        return n
    except Exception:
        conn.rollback()
        raise


def run_many(sql: str, seq: list) -> None:
    if _backend == "pg":
        return _pg_run_many(sql, seq)
    conn = _conn()
    conn.executemany(sql, seq)
    conn.commit()
