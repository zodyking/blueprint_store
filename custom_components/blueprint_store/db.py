# -*- coding: utf-8 -*-
from __future__ import annotations

import re
import sqlite3
import time
from pathlib import Path
from typing import Iterable, List, Dict, Any, Optional, Tuple

try:
    from .const import REFRESH_INTERVAL_SECS  # type: ignore
except Exception:
    REFRESH_INTERVAL_SECS = 30 * 60  # 30 minutes

DB_PRAGMA = [
    ("journal_mode", "WAL"),
    ("synchronous", "NORMAL"),
    ("foreign_keys", "ON"),
    ("temp_store", "MEMORY"),
    ("mmap_size", str(64 * 1024 * 1024)),
]

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS posts (
    id              INTEGER PRIMARY KEY,
    title           TEXT NOT NULL,
    title_norm      TEXT NOT NULL,
    author          TEXT NOT NULL,
    likes           INTEGER NOT NULL DEFAULT 0,
    views           INTEGER NOT NULL DEFAULT 0,
    replies         INTEGER NOT NULL DEFAULT 0,
    tags            TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    import_url      TEXT NOT NULL DEFAULT '',
    permalink       TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    has_multi_import INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_posts_updated ON posts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_likes   ON posts(likes DESC);
CREATE INDEX IF NOT EXISTS idx_posts_title   ON posts(title_norm);
CREATE INDEX IF NOT EXISTS idx_posts_tags    ON posts(tags);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

def open_db(db_path: str) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    for k, v in DB_PRAGMA:
        cur.execute(f"PRAGMA {k}={v}")
    conn.commit()
    return conn

def ensure_db(db_path: str) -> None:
    conn = open_db(db_path)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
    finally:
        conn.close()

# Back-compat alias
init_db = ensure_db

def _norm_text(s: str) -> str:
    s = (s or "").strip().replace("\u00A0", " ")
    s = re.sub(r"^\W+", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.lower()

def upsert_posts(conn: sqlite3.Connection, posts: Iterable[Dict[str, Any]]) -> int:
    cur = conn.cursor()
    rows = 0
    for p in posts:
        tags_val = p.get("tags", [])
        if isinstance(tags_val, (list, tuple)):
            tags_str = ",".join(sorted({str(t).strip().lower() for t in tags_val if str(t).strip()}))
        else:
            tags_str = str(tags_val or "").strip().lower()

        cur.execute(
            """
            INSERT INTO posts (id,title,title_norm,author,likes,views,replies,tags,category,
                               created_at,updated_at,import_url,permalink,description,has_multi_import)
            VALUES (:id,:title,:title_norm,:author,:likes,:views,:replies,:tags,:category,
                    :created_at,:updated_at,:import_url,:permalink,:description,:has_multi_import)
            ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                title_norm=excluded.title_norm,
                author=excluded.author,
                likes=excluded.likes,
                views=excluded.views,
                replies=excluded.replies,
                tags=excluded.tags,
                category=excluded.category,
                created_at=excluded.created_at,
                updated_at=excluded.updated_at,
                import_url=excluded.import_url,
                permalink=excluded.permalink,
                description=excluded.description,
                has_multi_import=excluded.has_multi_import
            """,
            {
                "id": int(p["id"]),
                "title": str(p.get("title", "")),
                "title_norm": _norm_text(p.get("title", "")),
                "author": str(p.get("author", "")),
                "likes": int(p.get("likes", 0)),
                "views": int(p.get("views", 0)),
                "replies": int(p.get("replies", 0)),
                "tags": tags_str,
                "category": str(p.get("category", "")),
                "created_at": int(p.get("created_at", p.get("created", time.time()))),
                "updated_at": int(p.get("updated_at", p.get("updated", time.time()))),
                "import_url": str(p.get("import_url", "")),
                "permalink": str(p.get("permalink", "")),
                "description": str(p.get("description", "")),
                "has_multi_import": 1 if p.get("has_multi_import") else 0,
            },
        )
        rows += 1
    conn.commit()
    return rows

async def async_upsert_posts(hass, db_path: str, posts: Iterable[Dict[str, Any]]) -> int:
    def _inner() -> int:
        conn = open_db(db_path)
        try:
            ensure_db(db_path)
            return upsert_posts(conn, posts)
        finally:
            conn.close()
    return await hass.async_add_executor_job(_inner)

def _where_for_query(q: Optional[str], tags: Optional[Iterable[str]]) -> Tuple[str, list]:
    clauses = []
    params: List[Any] = []
    if q:
        terms = [t for t in re.split(r"[^\w]+", q.lower()) if t]
        if terms:
            sub = []
            for t in terms:
                like = f"%{t}%"
                sub.append("(title_norm LIKE ? OR description LIKE ?)")
                params.extend([like, like])
            clauses.append("(" + " AND ".join(sub) + ")")
    if tags:
        tagset = {str(t).strip().lower() for t in tags if str(t).strip()}
        for t in tagset:
            clauses.append("(',' || tags || ',') LIKE ?")
            params.append(f"%,{t},%")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params

def query_posts(
    conn: sqlite3.Connection,
    *,
    q: Optional[str] = None,
    tags: Optional[Iterable[str]] = None,
    sort: str = "likes",
    limit: int = 30,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    where, params = _where_for_query(q, tags)
    if sort == "newest":
        order = "updated_at DESC"
    elif sort in ("title", "a_z", "az"):
        order = "title_norm ASC"
    else:
        order = "likes DESC, views DESC"
    sql = f"""
        SELECT id,title,author,likes,views,replies,tags,category,created_at,updated_at,
               import_url,permalink,description,has_multi_import
        FROM posts
        {where}
        ORDER BY {order}
        LIMIT ? OFFSET ?
    """
    params.extend([int(limit), int(offset)])
    cur = conn.cursor()
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]

async def async_query_posts(hass, db_path: str, **kwargs) -> List[Dict[str, Any]]:
    def _inner() -> List[Dict[str, Any]]:
        conn = open_db(db_path)
        try:
            return query_posts(conn, **kwargs)
        finally:
            conn.close()
    return await hass.async_add_executor_job(_inner)

def get_spotlight(conn: sqlite3.Connection) -> Dict[str, Any]:
    cur = conn.cursor()
    cur.execute("SELECT title, author, likes FROM posts ORDER BY likes DESC, views DESC LIMIT 1")
    pop = dict(cur.fetchone() or {"title": "", "author": "", "likes": 0})
    cur.execute("SELECT author, COUNT(*) as cnt FROM posts GROUP BY author ORDER BY cnt DESC LIMIT 1")
    mu = cur.fetchone()
    most_uploaded = {"author": "", "count": 0}
    if mu:
        most_uploaded = {"author": mu["author"], "count": mu["cnt"]}
    cur.execute("SELECT title, author, updated_at FROM posts ORDER BY updated_at DESC LIMIT 1")
    rec = dict(cur.fetchone() or {"title": "", "author": "", "updated_at": 0})
    return {"most_popular": pop, "most_uploaded": most_uploaded, "most_recent": rec}

async def async_get_spotlight(hass, db_path: str) -> Dict[str, Any]:
    def _inner() -> Dict[str, Any]:
        conn = open_db(db_path)
        try:
            return get_spotlight(conn)
        finally:
            conn.close()
    return await hass.async_add_executor_job(_inner)

# --- refresh gate ---

def _meta_get(conn: sqlite3.Connection, key: str) -> Optional[str]:
    cur = conn.cursor()
    cur.execute("SELECT value FROM meta WHERE key = ?", (key,))
    row = cur.fetchone()
    return None if row is None else row[0]

def _meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()

async def async_refresh_if_due(hass, db_path: str, *, force: bool = False) -> bool:
    def _inner() -> bool:
        ensure_db(db_path)
        conn = open_db(db_path)
        try:
            now = int(time.time())
            last = _meta_get(conn, "last_refresh_ts")
            if force or last is None or (now - int(last)) >= int(REFRESH_INTERVAL_SECS):
                _meta_set(conn, "last_refresh_ts", str(now))
                return True
            return False
        finally:
            conn.close()
    return await hass.async_add_executor_job(_inner)

__all__ = [
    "open_db",
    "ensure_db",
    "init_db",
    "upsert_posts",
    "async_upsert_posts",
    "query_posts",
    "async_query_posts",
    "get_spotlight",
    "async_get_spotlight",
    "async_refresh_if_due",
]
