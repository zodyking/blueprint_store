# custom_components/blueprint_store/__init__.py
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import timedelta, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from aiohttp import web
import aiohttp
import async_timeout

from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.aiohttp_client import async_get_clientsession

# -------------------------------------------------------------------
# Constants & logging
# -------------------------------------------------------------------
DOMAIN = "blueprint_store"
BASE = "https://community.home-assistant.io"
CATEGORY_ID = 53  # Blueprints Exchange
_LOGGER = logging.getLogger(__name__)

# -------------------------------------------------------------------
# Simple TTL cache
# -------------------------------------------------------------------
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


# -------------------------------------------------------------------
# HA entry points
# -------------------------------------------------------------------
async def async_setup(hass: HomeAssistant, config: dict):
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
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

    # Sidebar panel (iframe) — use frontend_url_path (NOT url_path)
    try:
        from homeassistant.components import frontend

        # Remove any pre-existing panel to avoid "Overwriting panel ..." ValueError
        try:
            frontend.async_remove_panel(hass, "blueprint_store")
        except Exception:  # noqa: BLE001 - defensive
            pass

        frontend.async_register_built_in_panel(
            hass,
            component_name="iframe",
            sidebar_title="Blueprint Store",
            sidebar_icon="mdi:blueprint",
            frontend_url_path="blueprint_store",
            config={"url": "/api/blueprint_store/panel"},
            require_admin=False,
        )
        _LOGGER.debug("Blueprint Store: sidebar panel registered")
    except Exception as e:  # noqa: BLE001
        _LOGGER.error("Blueprint Store: failed to register sidebar panel: %s", e)

    return True


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
async def _json(session: aiohttp.ClientSession, url: str, *, timeout=20) -> Any:
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
        "import_url": None,   # filled when post is expanded by /topic
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


# -------------------------------------------------------------------
# API views
# -------------------------------------------------------------------
async def api_blueprints(hass: HomeAssistant, request: web.Request):
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
            continue
        items.append(item)

    # Sorting
    if sort == "title":
        items.sort(key=lambda x: x.get("title", "").lower())
    elif sort == "likes":
        items.sort(key=lambda x: int(x.get("like_count") or 0), reverse=True)

    result = {
        "items": items,
        "has_more": bool((data.get("topic_list") or {}).get("more_topics_url")),
    }
    await cache.set(key, result, ttl=120)
    return web.json_response(result)


async def api_topic(hass: HomeAssistant, request: web.Request):
    session: aiohttp.ClientSession = hass.data[DOMAIN]["session"]
    cache: TTLCache = hass.data[DOMAIN]["cache"]

    tid = request.rel_url.query.get("id")
    if not tid:
        return web.json_response({"error": "missing id"}, status=400)

    key = f"topic:{tid}"
    cached = await cache.get(key)
    if cached:
        return web.json_response(cached)

    url = f"{BASE}/t/{tid}.json"
    data = await _json(session, url)

    posts = (data.get("post_stream") or {}).get("posts") or []
    cooked = posts[0].get("cooked") if posts else ""

    # import button URL inside cooked HTML
    m = re.search(
        r'(https?://my\.home-assistant\.io/redirect/blueprint_import[^"\'\s<>]+)',
        cooked or "",
        re.I,
    )
    import_url = m.group(1) if m else None

    # best-effort: parse "X users" that sometimes appears near the badge
    install_count = None
    if cooked and m:
        after = cooked.split(m.group(1), 1)[-1]
        m2 = re.search(r'>(\s*[\d\.,]+(?:\s*[kKmM])?)\s*</', after or "")
        if m2:
            txt = (m2.group(1) or "").strip().lower().replace(",", "")
            mul = 1
            if txt.endswith("k"):
                mul, txt = 1000, txt[:-1]
            if txt.endswith("m"):
                mul, txt = 1_000_000, txt[:-1]
            try:
                install_count = int(float(txt) * mul)
            except Exception:  # noqa: BLE001
                pass

    out = {"cooked": cooked, "import_url": import_url, "install_count": install_count}
    await cache.set(key, out, ttl=86400)
    return web.json_response(out)


async def api_filters(hass: HomeAssistant, request: web.Request):
    tags = [
        "lighting", "climate", "presence", "security", "media",
        "energy", "camera", "notifications", "tts", "switches",
        "covers", "zigbee", "zwave", "mqtt", "ai_assistants", "other"
    ]
    return web.json_response({"tags": tags})


async def api_go(hass: HomeAssistant, request: web.Request):
    tid = request.rel_url.query.get("tid")
    slug = request.rel_url.query.get("slug") or ""
    if not tid:
        return web.Response(status=400, text="Missing tid")
    url = f"{BASE}/t/{slug}/{tid}"
    raise web.HTTPFound(url)


async def serve_image(hass: HomeAssistant, request: web.Request):
    fname = request.match_info.get("fname") or ""
    base = Path(hass.config.path("custom_components/blueprint_store/images")).resolve()
    fpath = (base / fname).resolve()
    try:
        if not str(fpath).startswith(str(base)):
            raise FileNotFoundError()
        if not fpath.exists() or not fpath.is_file():
            raise FileNotFoundError()
        return web.FileResponse(path=fpath)
    except FileNotFoundError:
        return web.Response(status=404, text="Not found")


async def serve_panel(hass: HomeAssistant, request: web.Request):
    fpath = (Path(hass.config.path("custom_components/blueprint_store/panel")) / "index.html").resolve()
    if not fpath.exists():
        return web.Response(text="<h3>Blueprint Store panel is missing.</h3>", content_type="text/html")
    return web.FileResponse(path=fpath)
