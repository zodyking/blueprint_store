# custom_components/blueprint_store/__init__.py
from __future__ import annotations
from typing import Any, Tuple, List

from aiohttp import web
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.http import HomeAssistantView
from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components import frontend

from .const import (
    DOMAIN,
    PAGE_SIZE,
    STATIC_URL_PATH,
    STATIC_DIR_NAME,
    PANEL_URL_PATH,
    INDEX_RELATIVE,
    DISCOURSE_BASE,
)
from .db import (
    async_init_db,
    async_query_topics,
    async_distinct_tags,
    async_get_cooked,
    async_set_cooked,
)
from .coordinator import BlueprintStoreCoordinator

PLATFORMS: list = []
DATA_DB_PATH = "db_path"
DATA_COORD = "coordinator"


# ========================= HTTP API VIEWS =========================
class BlueprintsAPI(HomeAssistantView):
    url = "/api/blueprint_store/blueprints"
    name = "api:blueprint_store:blueprints"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        db_path: str = hass.data[DOMAIN][DATA_DB_PATH]

        q = request.query.get("q") or request.query.get("q_title") or ""
        bucket = request.query.get("bucket") or request.query.get("tag") or ""
        sort = (request.query.get("sort") or "likes").lower()

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
        from . import discourse  # local import to keep module import light

        hass: HomeAssistant = request.app["hass"]
        db_path: str = hass.data[DOMAIN][DATA_DB_PATH]
        try:
            tid = int(request.query.get("id", "0"))
        except ValueError:
            return web.json_response({"error": "invalid id"}, status=400)
        if not tid:
            return web.json_response({"error": "missing id"}, status=400)

        cooked = await async_get_cooked(hass, db_path, tid)
        if cooked:
            return self.json({"cooked": cooked})

        # Fallback: live fetch, then persist
        try:
            detail = await discourse.fetch_topic_detail(hass, tid)
            await async_set_cooked(
                hass, db_path, tid, detail.get("cooked_html") or "", detail.get("desc_text") or ""
            )
            return self.json({"cooked": detail.get("cooked_html") or ""})
        except Exception as e:  # noqa: BLE001
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


# ========================= PANEL & STATIC =========================
async def _register_static_and_panel(hass: HomeAssistant) -> None:
    """Serve /blueprint_store_static and add a sidebar panel via built-in iframe panel."""
    # Static
    static_dir = hass.config.path(f"custom_components/{DOMAIN}/{STATIC_DIR_NAME}")
    http = hass.http

    # Newer HA: register_static_paths(list[web.StaticResource])
    if hasattr(http, "register_static_paths"):
        http.register_static_paths([web.StaticResource(STATIC_URL_PATH, static_dir)])
    # Older HA: register_static_path(path, directory, cache_duration=...)
    elif hasattr(http, "register_static_path"):
        http.register_static_path(STATIC_URL_PATH, static_dir, cache_duration=86400)

    # Remove any stale panel (callable is sync despite its name)
    try:
        async_remove_panel(hass, PANEL_URL_PATH)
    except Exception:
        pass

    # Register a built-in iframe panel (function is sync; DO NOT await)
    async_register_built_in_panel(
        hass,
        component_name="iframe",
        sidebar_title="Blueprint Store",
        sidebar_icon="mdi:storefront-outline",
        frontend_url_path=PANEL_URL_PATH,
        config={"url": f"{STATIC_URL_PATH}/{INDEX_RELATIVE}"},
        require_admin=False,
        update=True,
    )


# ========================= SETUP / UNLOAD =========================
async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    db_path = hass.config.path(f"{DOMAIN}/blueprints.sqlite3")
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][DATA_DB_PATH] = db_path

    await async_init_db(hass, db_path)

    # HTTP routes
    hass.http.register_view(BlueprintsAPI)
    hass.http.register_view(FiltersAPI)
    hass.http.register_view(TopicAPI)
    hass.http.register_view(GoAPI)

    # Static + panel
    await _register_static_and_panel(hass)

    # Background coordinator
    coord = BlueprintStoreCoordinator(hass, db_path)
    hass.data[DOMAIN][DATA_COORD] = coord
    await coord.async_config_entry_first_refresh()

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    try:
        async_remove_panel(hass, PANEL_URL_PATH)  # sync callable
    except Exception:
        pass
    return True
