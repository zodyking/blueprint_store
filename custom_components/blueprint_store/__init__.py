from __future__ import annotations

import asyncio
import html
import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

from aiohttp import web, ClientError
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    DOMAIN,
    PANEL_URL_PATH,
    PANEL_ENDPOINT,
    API_BASE,
    DISCOURSE_BASE,
    DISCOURSE_CATEGORY_ID,
    CURATED_BUCKETS,
)

_LOGGER = logging.getLogger(__name__)

# ---------- helpers ----------

def _panel_dir() -> Path:
    return Path(__file__).parent / "panel"

def _read_text(fp: Path) -> str:
    return fp.read_text(encoding="utf-8")

def _int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return default

def _slugify(s: str) -> str:
    return (
        s.lower()
        .strip()
        .replace(" ", "-")
        .replace("/", "-")
        .replace("_", "-")
    )

# Simple in-memory cache with TTL
class TTLCache:
    def __init__(self, seconds: int = 60):
        self._ttl = seconds
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str):
        import time
        now = time.monotonic()
        v = self._data.get(key)
        if not v:
            return None
        ts, data = v
        if now - ts > self._ttl:
            self._data.pop(key, None)
            return None
        return data

    def set(self, key: str, value: Any):
        import time
        self._data[key] = (time.monotonic(), value)

CACHE = TTLCache(60)  # 60s cache for list/filters; topic cooked cached longer below

# ---------- HTTP views (panel files) ----------

class BlueprintStorePanelView(HomeAssistantView):
    url = PANEL_ENDPOINT
    name = f"{DOMAIN}:panel"
    requires_auth = True

    async def get(self, request):
        index_html = _read_text(_panel_dir() / "index.html")
        # ensure script src absolute to our panel path
        # (index already points to /blueprint_store/app.js but make sure)
        return web.Response(text=index_html, content_type="text/html")


class BlueprintStorePanelAsset(HomeAssistantView):
    url = f"{PANEL_ENDPOINT}/app.js"
    name = f"{DOMAIN}:panel_js"
    requires_auth = True

    async def get(self, request):
        app_js = _read_text(_panel_dir() / "app.js")
        return web.Response(text=app_js, content_type="application/javascript")


# ---------- Data fetchers ----------

async def _fetch_json(hass: HomeAssistant, url: str) -> dict:
    session = async_get_clientsession(hass)
    tries = 3
    delay = 0.6
    for i in range(tries):
        try:
            async with session.get(url, timeout=20) as resp:
                resp.raise_for_status()
                return await resp.json()
        except Exception as e:
            if i == tries - 1:
                raise
            await asyncio.sleep(delay)
            delay *= 2

def _topic_to_item(topic: dict) -> dict:
    # topic keys from Discourse list JSON
    tid = topic.get("id")
    slug = topic.get("slug") or _slugify(topic.get("title") or "")
    title = topic.get("title") or ""
    author = ""  # filled from detailed call only; keep blank for list
    tags = topic.get("tags") or []
    like_count = _int(topic.get("like_count"), 0)
    posts_count = _int(topic.get("posts_count"), 0)  # includes the OP
    excerpt = topic.get("excerpt") or ""
    # Build UI payload
    return {
        "id": tid,
        "slug": slug,
        "title": title,
        "author": author,
        "tags": tags,
        "bucket": (tags[0] if tags else "other"),
        "likes": like_count,
        "comments": max(0, posts_count - 1),
        "excerpt": excerpt,
        # UI will show a pill at bottom-right; we’ll generate import_url from topic cooked
        "import_url": "",
        "uses": None,
    }

async def _list_page(
    hass: HomeAssistant,
    page: int,
    q_title: str | None,
    bucket: str | None,
    sort: str | None,
) -> dict:
    """Return one page of topics from Blueprints Exchange."""
    # Discourse supports /c/<slug>/<id>.json?page=n
    # We use “latest” ordering and sort client-side for likes when requested.
    list_url = f"{DISCOURSE_BASE}/c/blueprints-exchange/{DISCOURSE_CATEGORY_ID}.json?page={page}"
    data = await _fetch_json(hass, list_url)
    topics = data.get("topic_list", {}).get("topics", [])

    items = []
    for t in topics:
        # Only include in category and visible topics
        if t.get("category_id") != DISCOURSE_CATEGORY_ID:
            continue
        item = _topic_to_item(t)
        title = (item["title"] or "").lower()
        if q_title and q_title.lower() not in title:
            continue
        if bucket:
            # allow curated bucket or raw tag match
            if bucket in CURATED_BUCKETS:
                # crude mapping: match the name or first tag overlap
                ok = (item["bucket"] == bucket) or (bucket in item["tags"])
                if not ok:
                    continue
            else:
                if bucket not in item["tags"]:
                    continue
        items.append(item)

    # sorting
    if sort == "likes":
        items.sort(key=lambda x: _int(x.get("likes"), 0), reverse=True)
    elif sort == "title":
        items.sort(key=lambda x: (x.get("title") or "").lower())

    # Discourse “has_more” is implicit; assume more if we got many items
    return {
        "items": items,
        "has_more": len(items) >= 25  # heuristic
    }

async def _collect_tags(hass: HomeAssistant) -> list[str]:
    """Fetch a few pages and aggregate tags for dropdown."""
    cached = CACHE.get("tags")
    if cached:
        return cached

    tags: set[str] = set()
    for p in range(0, 3):
        try:
            data = await _fetch_json(
                hass,
                f"{DISCOURSE_BASE}/c/blueprints-exchange/{DISCOURSE_CATEGORY_ID}.json?page={p}",
            )
            for t in data.get("topic_list", {}).get("topics", []):
                for tg in (t.get("tags") or []):
                    tags.add(tg)
        except ClientError:
            break

    ordered = sorted(tags)
    CACHE.set("tags", ordered)
    return ordered

async def _topic_cooked(hass: HomeAssistant, tid: int) -> dict:
    """Return cooked HTML for OP; also scan for import button & uses when possible."""
    cache_key = f"topic:{tid}"
    cached = CACHE.get(cache_key)
    if cached:
        return cached

    url = f"{DISCOURSE_BASE}/t/{tid}.json"
    data = await _fetch_json(hass, url)
    posts = data.get("post_stream", {}).get("posts", [])
    cooked = posts[0].get("cooked", "") if posts else ""
    slug = data.get("slug") or ""
    like_count = _int(data.get("like_count"), 0)

    # Try to find an “Import Blueprint” link
    import_url = ""
    uses = None
    try:
        from bs4 import BeautifulSoup  # optional at runtime; if not, we just skip
        soup = BeautifulSoup(cooked, "html.parser")
        a = soup.select_one('a[href*="my.home-assistant.io/redirect/blueprint_import"]')
        if a:
            import_url = a.get("href") or ""
        # Read a number badge right next to it if present (site-specific)
        badge = a.find_next("span") if a else None
        if badge and badge.get_text(strip=True).lower().endswith("k"):
            text = badge.get_text(strip=True).lower().replace("k", "")
            uses = int(float(text) * 1000)
    except Exception:
        pass

    payload = {
        "cooked": cooked,
        "slug": slug,
        "likes": like_count,
        "import_url": import_url,
        "uses": uses,
    }
    CACHE.set(cache_key, payload)
    return payload

# ---------- API Views ----------

class BPFiltersView(HomeAssistantView):
    url = f"{API_BASE}/filters"
    name = f"{DOMAIN}:filters"
    requires_auth = True

    async def get(self, request):
        hass: HomeAssistant = request.app["hass"]
        try:
            tags = await _collect_tags(hass)
            return self.json({"tags": tags, "buckets": CURATED_BUCKETS})
        except Exception as e:
            _LOGGER.exception("filters failed: %s", e)
            return self.json({"tags": [], "buckets": CURATED_BUCKETS})


class BPListView(HomeAssistantView):
    url = f"{API_BASE}/blueprints"
    name = f"{DOMAIN}:blueprints"
    requires_auth = True

    async def get(self, request):
        hass: HomeAssistant = request.app["hass"]
        q = request.query
        page = _int(q.get("page", "0"), 0)
        q_title = q.get("q_title") or None
        bucket = q.get("bucket") or None
        sort = q.get("sort") or "new"

        cache_key = f"list:{page}:{q_title}:{bucket}:{sort}"
        cached = CACHE.get(cache_key)
        if cached:
            return self.json(cached)

        try:
            data = await _list_page(hass, page, q_title, bucket, sort)
            CACHE.set(cache_key, data)
            return self.json(data)
        except Exception as e:
            _LOGGER.exception("list failed: %s", e)
            return self.json({"items": [], "has_more": False, "error": str(e)})


class BPTopicView(HomeAssistantView):
    url = f"{API_BASE}/topic"
    name = f"{DOMAIN}:topic"
    requires_auth = True

    async def get(self, request):
        hass: HomeAssistant = request.app["hass"]
        tid = _int(request.query.get("id"), 0)
        if not tid:
            return self.json({"error": "missing id"}, status_code=400)
        try:
            data = await _topic_cooked(hass, tid)
            return self.json(data)
        except Exception as e:
            _LOGGER.exception("topic failed: %s", e)
            return self.json({"cooked": "<em>Failed to load.</em>" })


class BPGoView(HomeAssistantView):
    url = f"{API_BASE}/go"
    name = f"{DOMAIN}:go"
    requires_auth = True

    async def get(self, request):
        q = request.query
        tid = _int(q.get("tid"), 0)
        slug = q.get("slug") or ""
        if not tid:
            return web.HTTPBadRequest(text="missing tid")
        # Safe absolute URL builder
        href = f"{DISCOURSE_BASE}/t/{slug}/{tid}" if slug else f"{DISCOURSE_BASE}/t/{tid}"
        raise web.HTTPFound(href)

# ---------- setup ----------

async def async_setup(hass: HomeAssistant, config) -> bool:
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    # Register panel views
    hass.http.register_view(BlueprintStorePanelView)
    hass.http.register_view(BlueprintStorePanelAsset)

    # Register API views
    hass.http.register_view(BPFiltersView)
    hass.http.register_view(BPListView)
    hass.http.register_view(BPTopicView)
    hass.http.register_view(BPGoView)

    # Register sidebar panel using panel_custom in an iframe
    # IMPORTANT: no awaits; argument names must match current HA
    try:
        hass.components.frontend.async_register_built_in_panel(
            hass,
            component_name="panel_custom",
            sidebar_title="Blueprint Store",
            sidebar_icon="mdi:storefront",
            frontend_url_path=PANEL_URL_PATH,
            require_admin=False,
            config={
                "module_url": PANEL_ENDPOINT,  # our HTML view, embedded in iframe
                "embed_iframe": True,
                "trust_external": False,
            },
            update=True,
        )
    except Exception as e:
        _LOGGER.error("Failed to register panel: %s", e)

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    # Remove panel (ignore errors on older cores)
    try:
        hass.components.frontend.async_remove_panel(PANEL_URL_PATH)
    except Exception:
        pass
    return True
