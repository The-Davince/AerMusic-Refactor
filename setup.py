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
    """CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expiresat)""",
]


def main() -> None:
    db.connect(cfg.DATABASE_PATH)
    for ddl in TABLES:
        db.run(ddl)
    db.close()
