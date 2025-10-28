from __future__ import annotations
import asyncio, re, html
from typing import Any, Dict, Iterable, List, Optional, Tuple
from aiohttp import ClientResponseError
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from .const import DISCOURSE_BASE, CATEGORY_ID

_topic_re = re.compile(r'https://my\.home-assistant\.io/redirect/blueprint_import[^"\s<)]+', re.I)
_tag_strip_re = re.compile(r"<[^>]+>")  # quick sanitizer

def _sanitize_text(s: str) -> str:
    if not s:
        return ""
    s = _tag_strip_re.sub(" ", s)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

async def _get_json(hass: HomeAssistant, url: str) -> Dict[str, Any]:
    sess = async_get_clientsession(hass)
    tries, backoff = 0, 0.75
    while True:
        try:
            async with sess.get(url, headers={"User-Agent": "HA-Blueprint-Store"}) as r:
                r.raise_for_status()
                return await r.json()
        except ClientResponseError as e:
            if e.status == 429 and tries < 4:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 1.8, 6.0)
                tries += 1
                continue
            raise

async def fetch_category_page(hass: HomeAssistant, page: int) -> List[Dict[str, Any]]:
    url = f"{DISCOURSE_BASE}/c/blueprints-exchange/{CATEGORY_ID}.json?page={page}"
    data = await _get_json(hass, url)
    topics = (data.get("topic_list") or {}).get("topics") or []
    # Normalize minimal fields; we will enrich with topic.json when needed
    out: List[Dict[str, Any]] = []
    for t in topics:
        out.append({
            "id": t.get("id"),
            "slug": t.get("slug") or "",
            "title": t.get("title") or "",
            "created_at": t.get("created_at") or t.get("created_at_age"),
            "updated_at": t.get("last_posted_at") or t.get("bumped_at"),
            "likes": t.get("like_count") or 0,
            "replies": t.get("posts_count", 1) - 1 if t.get("posts_count") else t.get("reply_count", 0),
            "views": t.get("views") or 0,
            "tags": t.get("tags") or [],
            "author": (t.get("posters") or [{}])[0].get("user_id")  # placeholder; will fix with topic.json
        })
    return out

async def fetch_topic_detail(hass: HomeAssistant, topic_id: int) -> Dict[str, Any]:
    url = f"{DISCOURSE_BASE}/t/{topic_id}.json"
    data = await _get_json(hass, url)

    title = data.get("title") or ""
    slug  = data.get("slug") or ""
    views = data.get("views") or 0
    like_count = data.get("like_count") or 0
    posts = data.get("post_stream", {}).get("posts") or []
    first = posts[0] if posts else {}
    cooked = first.get("cooked") or ""
    raw = first.get("raw") or ""
    author = first.get("username") or data.get("details", {}).get("created_by", {}).get("username", "")

    # import links
    import_links = _topic_re.findall(cooked) if cooked else []
    import_url = import_links[0] if import_links else None
    import_count = len(import_links)

    # description text
    desc_text = _sanitize_text(cooked or raw)

    tags = data.get("tags") or []

    created_at = data.get("created_at") or ""
    updated_at = data.get("last_posted_at") or data.get("bumped_at") or created_at

    return {
        "id": topic_id,
        "slug": slug,
        "title": title,
        "author": author or "",
        "likes": like_count,
        "replies": max((data.get("posts_count", 1) - 1), 0),
        "views": views,
        "import_url": import_url,
        "import_count": import_count,
        "created_at": created_at,
        "updated_at": updated_at,
        "desc_text": desc_text,
        "cooked_html": cooked or "",
        "tags": tags,
    }
