import asyncio
import html
import os
import re
from time import time
from urllib.parse import urljoin

from aiohttp import web
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    DOMAIN,
    CATEGORY_ID,
    DEFAULT_MAX_PAGES,
    DEFAULT_CACHE_SECONDS,
    COMMUNITY_BASE,
    IMPORT_PATH_FRAGMENT,
    API_BASE,
    STATIC_BASE,
    PANEL_URL,
    SIDEBAR_TITLE,
    SIDEBAR_ICON,
)

# -------- helpers -------------------------------------------------------------

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")

def _text_excerpt(cooked_html: str, max_len: int = 240) -> str:
    txt = TAG_RE.sub(" ", cooked_html or "")
    txt = WS_RE.sub(" ", txt).strip()
    return (txt[: max_len - 1] + "…") if len(txt) > max_len else txt

async def _fetch_json(session, url):
    async with session.get(url, headers={"Accept": "application/json"}) as resp:
        resp.raise_for_status()
        return await resp.json()

def _get_cfg(hass: HomeAssistant):
    store = hass.data.setdefault(DOMAIN, {})
    return store.setdefault("cfg", {
        "max_pages": DEFAULT_MAX_PAGES,
        "cache_seconds": DEFAULT_CACHE_SECONDS,
    })

# -------- crawl ---------------------------------------------------------------

async def _fetch_topic_import_link(session, topic_id: int):
    """Return (import_url, excerpt) if first post has a blueprint import button; else (None, None)."""
    data = await _fetch_json(session, f"{COMMUNITY_BASE}/t/{topic_id}.json")
    posts = data.get("post_stream", {}).get("posts", [])
    if not posts:
        return None, None

    cooked = posts[0].get("cooked", "") or ""
    m = re.search(r'href="([^"]+%s[^"]*)"' % re.escape(IMPORT_PATH_FRAGMENT), cooked)
    if not m:
