from __future__ import annotations
import os, sqlite3, json
from typing import Any, Iterable, List, Mapping, Optional, Tuple
from homeassistant.core import HomeAssistant

# WAL + pragmatic defaults
INIT_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;

CREATE TABLE IF NOT EXISTS topics (
  id            INTEGER PRIMARY KEY,
  slug          TEXT,
  title         TEXT,
  author        TEXT,
  likes         INTEGER DEFAULT 0,
  replies       INTEGER DEFAULT 0,
  views         INTEGER DEFAULT 0,
  import_url    TEXT,
  import_count  INTEGER DEFAULT 0,
  created_at    TEXT,
  updated_at    TEXT,
  desc_text     TEXT,
  cooked_html   TEXT
);

CREATE TABLE IF NOT EXISTS topic_tags (
  topic_id INTEGER,
  tag      TEXT,
  PRIMARY KEY (topic_id, tag)
);

CREATE INDEX IF NOT EXISTS ix_topics_updated ON topics(updated_at);
CREATE INDEX IF NOT EXISTS ix_topics_likes   ON topics(likes);
CREATE INDEX IF NOT EXISTS ix_topics_title   ON topics(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS ix_tag_tag        ON topic_tags(tag COLLATE NOCASE);
"""

def _connect(db_path: str) -> sqlite3.Connection:
    con = sqlite3.connect(db_path, timeout=30, isolation_level=None)  # autocommit
    con.row_factory = sqlite3.Row
    return con

async def async_init_db(hass: HomeAssistant, db_path: str) -> None:
    def _init():
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        with _connect(db_path) as con:
            for stmt in [s.strip() for s in INIT_SQL.split(";") if s.strip()]:
                con.execute(stmt)
    await hass.async_add_executor_job(_init)

async def async_upsert_many(hass: HomeAssistant, db_path: str, rows: Iterable[Mapping[str, Any]]) -> None:
    rows = list(rows)
    if not rows:
        return
    def _upsert():
        with _connect(db_path) as con:
            # topics
            con.executemany(
                """INSERT INTO topics (id, slug, title, author, likes, replies, views, import_url,
                                        import_count, created_at, updated_at, desc_text, cooked_html)
                   VALUES (:id, :slug, :title, :author, :likes, :replies, :views, :import_url,
                           :import_count, :created_at, :updated_at, :desc_text, :cooked_html)
                   ON CONFLICT(id) DO UPDATE SET
                     slug=excluded.slug, title=excluded.title, author=excluded.author,
                     likes=excluded.likes, replies=excluded.replies, views=excluded.views,
                     import_url=excluded.import_url, import_count=excluded.import_count,
                     created_at=excluded.created_at, updated_at=excluded.updated_at,
                     desc_text=excluded.desc_text, cooked_html=excluded.cooked_html
                """,
                rows,
            )
            # tags
            for r in rows:
                tags = r.get("tags") or []
                con.execute("DELETE FROM topic_tags WHERE topic_id=?", (r["id"],))
                con.executemany(
                    "INSERT OR IGNORE INTO topic_tags (topic_id, tag) VALUES (?,?)",
                    [(r["id"], t) for t in tags],
                )
    await hass.async_add_executor_job(_upsert)

async def async_query_topics(
    hass: HomeAssistant,
    db_path: str,
    *,
    q: str = "",
    tag: str = "",
    sort: str = "likes",
    limit: int = 30,
    offset: int = 0
) -> Tuple[List[dict], bool]:
    """Return (items, has_more)."""
    def _q():
        sql = [
            "SELECT t.*,",
            "COALESCE(GROUP_CONCAT(tt.tag, '|||'), '') AS tags_concat ",
            "FROM topics t ",
            "LEFT JOIN topic_tags tt ON tt.topic_id = t.id "
        ]
        where, args = [], []
        if q:
            like = f"%{q}%"
            where.append("(t.title LIKE ? OR t.desc_text LIKE ?)")
            args += [like, like]
        if tag:
            where.append(
                "EXISTS (SELECT 1 FROM topic_tags x WHERE x.topic_id = t.id AND x.tag LIKE ?)"
            )
            args.append(tag)
        if where:
            sql.append("WHERE " + " AND ".join(where) + " ")
        sql.append("GROUP BY t.id ")
        if sort == "new":
            sql.append("ORDER BY datetime(t.updated_at) DESC ")
        elif sort == "title":
            sql.append("ORDER BY t.title COLLATE NOCASE ASC ")
        else:
            sql.append("ORDER BY t.likes DESC ")
        sql.append("LIMIT ? OFFSET ?")
        args += [limit + 1, offset]  # ask one extra to compute has_more

        with _connect(db_path) as con:
            cur = con.execute("".join(sql), args)
            rows = [dict(r) for r in cur.fetchall()]

        has_more = len(rows) > limit
        if has_more:
            rows = rows[:limit]

        for r in rows:
            tc = r.pop("tags_concat", "") or ""
            r["tags"] = [t for t in tc.split("|||") if t]
            # make a short excerpt for UI
            desc = (r.get("desc_text") or "").strip()
            if len(desc) > 280:
                desc = desc[:277].rsplit(" ", 1)[0] + "…"
            r["excerpt"] = desc
        return rows, has_more

    return await hass.async_add_executor_job(_q)

async def async_distinct_tags(hass: HomeAssistant, db_path: str) -> List[str]:
    def _tags():
        with _connect(db_path) as con:
            cur = con.execute("SELECT DISTINCT tag FROM topic_tags ORDER BY tag COLLATE NOCASE ASC")
            return [r[0] for r in cur.fetchall()]
    return await hass.async_add_executor_job(_tags)

async def async_get_cooked(hass: HomeAssistant, db_path: str, topic_id: int) -> Optional[str]:
    def _g():
        with _connect(db_path) as con:
            cur = con.execute("SELECT cooked_html FROM topics WHERE id=?", (topic_id,))
            row = cur.fetchone()
            return row["cooked_html"] if row else None
    return await hass.async_add_executor_job(_g)

async def async_set_cooked(
    hass: HomeAssistant, db_path: str, topic_id: int, cooked_html: str, desc_text: str
) -> None:
    def _s():
        with _connect(db_path) as con:
            con.execute(
                "UPDATE topics SET cooked_html=?, desc_text=? WHERE id=?",
                (cooked_html, desc_text, topic_id),
            )
    await hass.async_add_executor_job(_s)
