from __future__ import annotations
from typing import Any, Dict, List, Optional
from aiohttp import web
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.http import HomeAssistantView
from homeassistant.components import frontend
from homeassistant.helpers import aiohttp_client

from .const import (
    DOMAIN, PAGE_SIZE,
    STATIC_URL_PATH, STATIC_DIR_NAME, PANEL_URL_PATH, INDEX_RELATIVE,
    DISCOURSE_BASE,
)
from .db import (
    async_init_db, async_query_topics, async_distinct_tags,
    async_get_cooked, async_set_cooked,
)
from .coordinator import BlueprintStoreCoordinator
from . import discourse

PLATFORMS: list = []
DATA_DB_PATH = "db_path"
DATA_COORD = "coordinator"

# ---------------------- HTTP Views ----------------------
class BlueprintsAPI(HomeAssistantView):
    url = "/api/blueprint_store/blueprints"
    name = "api:blueprint_store:blueprints"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        db_path: str = hass.data[DOMAIN][DATA_DB_PATH]
        q = request.query.get("q") or request.query.get("q_title") or ""
        bucket = request.query.get("bucket") or request.query.get("tag") or ""
        sort = request.query.get("sort") or "likes"
        try:
            page = int(request.query.get("page", "0"))
        except ValueError:
            page = 0
        limit = PAGE_SIZE
        offset = page * limit

        items, has_more = await async_query_topics(
            hass, db_path, q=q, tag=bucket, sort=sort, limit=limit, offset=offset
        )

        return self.json({"items": items, "has_more": has_more})

class FiltersAPI(HomeAssistantView):
    url = "/api/blueprint_store/filters"
    name = "api:blueprint_store:filters"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        db_path: str = hass.data[DOMAIN][DATA_DB_PATH]
        tags = await async_distinct_tags(hass, db_path)
        return self.json({"tags": tags})

class TopicAPI(HomeAssistantView):
    url = "/api/blueprint_store/topic"
    name = "api:blueprint_store:topic"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        db_path: str = hass.data[DOMAIN][DATA_DB_PATH]
        tid = int(request.query.get("id", "0"))
        if not tid:
            return web.json_response({"error": "missing id"}, status=400)

        cooked = await async_get_cooked(hass, db_path, tid)
        if cooked:
            return self.json({"cooked": cooked})

        # Fallback: fetch live, persist minimal, return
        try:
            detail = await discourse.fetch_topic_detail(hass, tid)
            await async_set_cooked(hass, db_path, tid, detail["cooked_html"], detail["desc_text"])
            return self.json({"cooked": detail["cooked_html"]})
        except Exception as e:  # noqa
            return web.json_response({"error": str(e)}, status=502)

class GoAPI(HomeAssistantView):
    url = "/api/blueprint_store/go"
    name = "api:blueprint_store:go"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        tid = request.query.get("tid")
        slug = request.query.get("slug") or ""
        if not tid:
            return web.Response(status=400, text="missing tid")
        if slug:
            url = f"{DISCOURSE_BASE}/t/{slug}/{tid}"
        else:
            url = f"{DISCOURSE_BASE}/t/{tid}"
        raise web.HTTPFound(url)

# ---------------------- Setup ----------------------
async def _register_static(hass: HomeAssistant) -> None:
    """Serve /blueprint_store_static from our local www folder, and register a panel pointing to index.html."""
    comp = hass.http

    # Static file mount
    static_dir = hass.config.path(f"custom_components/{DOMAIN}/{STATIC_DIR_NAME}")
    if hasattr(comp, "register_static_paths"):
        comp.register_static_paths([web.StaticResource(STATIC_URL_PATH, static_dir)])
    elif hasattr(comp, "register_static_path"):
        comp.register_static_path(STATIC_URL_PATH, static_dir, cache_duration=86400)

    # Panel (frontend) – keep simple, point to our index
    panel_url = PANEL_URL_PATH
    # If a stale panel exists, remove it
    try:
        frontend.async_remove_panel(hass, panel_url)
    except Exception:
        pass

    # Register a web-app panel that loads our index
    frontend.async_register_panel(
        hass,
        frontend.Panel(
            component_name="iframe",  # use iframe panel to load our static index
            frontend_url_path=panel_url,
            sidebar_title="Blueprint Store",
            sidebar_icon="mdi:shopping",
            config={"url": f"{STATIC_URL_PATH}/{INDEX_RELATIVE}"},
            require_admin=False,
        ),
        update=True,
    )

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    db_path = hass.config.path(f"{DOMAIN}/blueprints.sqlite3")
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][DATA_DB_PATH] = db_path

    await async_init_db(hass, db_path)

    # Register HTTP routes
    hass.http.register_view(BlueprintsAPI)
    hass.http.register_view(FiltersAPI)
    hass.http.register_view(TopicAPI)
    hass.http.register_view(GoAPI)

    # Static + panel
    await _register_static(hass)

    # Coordinator
    coord = BlueprintStoreCoordinator(hass, db_path)
    hass.data[DOMAIN][DATA_COORD] = coord
    await coord.async_config_entry_first_refresh()

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    try:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    except Exception:
        pass
    return True
