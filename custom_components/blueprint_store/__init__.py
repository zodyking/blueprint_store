# custom_components/blueprint_store/__init__.py
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp
import async_timeout
from aiohttp import web

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

DOMAIN = "blueprint_store"
BASE = "https://community.home-assistant.io"
CATEGORY_ID = 53  # Blueprints Exchange
_LOGGER = logging.getLogger(__name__)


# ---------------- TTL cache ----------------
@dataclass
class CacheItem:
    value: Any
    expires: datetime


class TTLCache:
    def __init__(self, ttl: int = 3600) -> None:
        self._data: Dict[str, CacheItem] = {}
        self._ttl = ttl
        self._lock = asyncio.Lock()

    async def get(self, key: str):
        async with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            if item.expires < datetime.utcnow():
                self._data.pop(key, None)
                return None
            return item.value

    async def set(self, key: str, value: Any, ttl: Optional[int] = None):
        async with self._lock:
            self._data[key] = CacheItem(
                value=value,
                expires=datetime.utcnow() + timedelta(seconds=ttl or self._ttl),
            )


# ---------------- HA entry points ----------------
async def async_setup(hass: HomeAssistant, _: dict) -> bool:
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    session = async_get_clientsession(hass)
    cache = TTLCache(ttl=3600)

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["session"] = session
    hass.data[DOMAIN]["cache"] = cache

    # API routes
    app = hass.http.app
    app.router.add_get("/api/blueprint_store/blueprints", lambda req: api_blueprints(hass, req))
    app.router.add_get("/api/blueprint_store/topic", lambda req: api_topic(hass, req))
    app.router.add_get("/api/blueprint_store/filters", lambda req: api_filters(hass, req))
    app.router.add_get("/api/blueprint_store/go", lambda req: api_go(hass, req))
    app.router.add_get("/blueprint_store_static/images/{fname:.*}", lambda req: serve_image(hass, req))
    app.router.add_get("/api/blueprint_store/panel", lambda req: serve_panel(hass, req))

    # Sidebar panel (iframe) – update if exists, otherwise create (no remove call).
    try:
        from homeassistant.components import frontend

        frontend.async_register_built_in_panel(
            hass,
            component_name="iframe",
            sidebar_title="Blueprint Store",
            sidebar_icon="mdi:storefront",  # store-like icon built into HA
            frontend_url_path="blueprint_store",
            config={"url": "/api/blueprint_store/panel"},
            require_admin=False,
            update=True,
        )
        _LOGGER.debug("Blueprint Store: sidebar panel registered/updated")
    except Exception as e:  # noqa: BLE001
        _LOGGER.error("Blueprint Store: failed to register sidebar panel: %s", e)

    return True


# ---------------- helpers ----------------
async def _json(session: aiohttp.ClientSession, url: str, *, timeout=25) -> Any:
    async with async_timeout.timeout(timeout):
        async with session.get(url, headers={"User-Agent": "BlueprintStore/0.4"}) as resp:
            resp.raise_for_status()
            return await resp.json()


def _topic_to_item(t: Dict[str, Any]) -> Dict[str, Any]:
    slug = t.get("slug") or ""
    return {
        "id": t.get("id"),
        "slug": slug,
        "title": t.get("title") or "",
        "author": (t.get("last_poster_username") or t.get("poster") or ""),
        "excerpt": t.get("excerpt") or "",
        "tags": t.get("tags") or [],
        "like_count": t.get("like_count") or 0,
        "posts_count": t.get("posts_count") or t.get("last_post_number") or 1,
        "import_url": None,   # filled when /topic is called
        "bucket": None,
        "uses": None,
        "install_count": None,
    }


def _bucket_for_tags(tags: List[str]) -> Optional[str]:
    CURATED = [
        "lighting", "climate", "presence", "security", "media",
        "energy", "camera", "notifications", "tts", "switches",
        "covers", "zigbee", "zwave", "mqtt", "ai_assistants", "other"
    ]
    tagset = set((tags or []))
    for k in CURATED:
        if k in tagset:
            return k
    return "other" if tags else None


# ---------------- API views ----------------
async def api_blueprints(hass: HomeAssistant, request: web.Request):
    """
    Original working category endpoint; optional filters applied locally.
    """
    session: aiohttp.ClientSession = hass.data[DOMAIN]["session"]
    cache: TTLCache = hass.data[DOMAIN]["cache"]

    page = int(request.rel_url.query.get("page", "0"))
    q_title = (request.rel_url.query.get("q_title") or "").strip().lower()
    bucket = (request.rel_url.query.get("bucket") or "").strip().lower()
    sort = (request.rel_url.query.get("sort") or "new").lower()

    key = f"list:{page}:{q_title}:{bucket}:{sort}"
    cached = await cache.get(key)
    if cached:
        return web.json_response(cached)

    # Original, known-good endpoint
    url = f"{BASE}/c/blueprints-exchange/{CATEGORY_ID}.json?page={page}&no_subcategories=true"
    data = await _json(session, url)
    topics = (data.get("topic_list") or {}).get("topics") or []

    items: List[Dict[str, Any]] = []
    for t in topics:
        item = _topic_to_item(t)
        item["bucket"] = _bucket_for_tags(item["tags"])
        if q_title and q_title not in (item["title"] or "").lower():
            continue
        if bucket and (item["bucket"] or "") != bucket:
