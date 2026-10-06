import os
import sqlite3

import config as cfg
from utils import db

TABLES = [
    """CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pass TEXT NOT NULL,
        salt TEXT NOT NULL,
        createdat INTEGER NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS sessions(
        tokenkey TEXT PRIMARY KEY,
        userid INTEGER NOT NULL,
        expiresat INTEGER NOT NULL,
        createdat INTEGER NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS library(
        userid INTEGER NOT NULL,
        kind TEXT NOT NULL,
        data TEXT NOT NULL,
        updatedat INTEGER NOT NULL,
        PRIMARY KEY(userid, kind)
    )""",
    """CREATE TABLE IF NOT EXISTS recommend_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userid INTEGER NOT NULL,
        event TEXT NOT NULL,
        platform TEXT NOT NULL,
        songid TEXT NOT NULL,
        artistid TEXT NOT NULL DEFAULT '',
        artistname TEXT NOT NULL DEFAULT '',
        albumid TEXT NOT NULL DEFAULT '',
        albumname TEXT NOT NULL DEFAULT '',
        position REAL,
        duration REAL,
        createdat INTEGER NOT NULL
    )""",
    """CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expiresat)""",
    """CREATE INDEX IF NOT EXISTS idx_recommend_events_user_time ON recommend_events(userid, createdat DESC, id DESC)""",
    """CREATE INDEX IF NOT EXISTS idx_recommend_events_user_event ON recommend_events(userid, event, createdat DESC)""",
]


def main() -> None:
    db.connect(cfg.DATABASE_PATH)
    for ddl in TABLES:
        db.run(ddl)
    db.close()
