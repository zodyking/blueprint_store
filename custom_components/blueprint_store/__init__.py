from __future__ import annotations

import os
from aiohttp import web
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.http import HomeAssistantView
from homeassistant.components.frontend import async_register_built_in_panel, async_remove_panel

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

PLATFORMS: list[str] = []
DATA_DB_PATH = "db_path"
DATA_COORD = "coordinator"


# ------------------------------ API: list/query ------------------------------
class BlueprintsAPI(HomeAssistantView):
    url = "/api/blueprint_store/blueprints"
    name = "api:blueprint_store:blueprints"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        db_path: str = hass.data[DOMAIN][DATA_DB_PATH]

        q = (request.query.get("q") or request.query.get("q_title") or "").strip()
        bucket = (request.query.get("bucket") or request.query.get("tag") or "").strip()
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
        from . import discourse  # lazy import

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

        detail = await discourse.fetch_topic_detail(hass, tid)
        await async_set_cooked(
            hass, db_path, tid, detail.get("cooked_html") or "", detail.get("desc_text") or ""
        )
        return self.json({"cooked": detail.get("cooked_html") or ""})


class GoAPI(HomeAssistantView):
    url = "/api/blueprint_store/go"
    name = "api:blueprint_store:go"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        tid = request.query.get("tid")
        slug = request.query.get("slug") or ""
        if not tid:
            return web.Response(status=400, text="missing tid")
        url = f"{DISCOURSE_BASE}/t/{slug}/{tid}" if slug else f"{DISCOURSE_BASE}/t/{tid}"
        raise web.HTTPFound(url)


# ------------------------------ Panel HTML (no 404) ------------------------------
class PanelView(HomeAssistantView):
    """Serve the UI HTML; stream your real panel file if it exists, else a tiny fallback."""

    url = "/api/blueprint_store/panel"
    name = "api:blueprint_store:panel"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        static_dir = hass.config.path(f"custom_components/{DOMAIN}/{STATIC_DIR_NAME}")
        index_path = os.path.join(static_dir, INDEX_RELATIVE)

        if os.path.exists(index_path):
            try:
                with open(index_path, "r", encoding="utf-8") as fh:
                    html = fh.read()
                return web.Response(text=html, content_type="text/html")
            except Exception:  # noqa: BLE001
                pass

        # Fallback – avoids the 404 "Not Found" screen.
        html = """<!doctype html><html><head><meta charset="utf-8">
<title>Blueprint Store</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#0b1e3a;color:#eef;font:14px/1.45 system-ui,Segoe UI,Roboto}
.wrap{max-width:1060px;margin:40px auto;padding:24px;border-radius:14px;background:#0f2548}
a{color:#7ec8ff}</style></head>
<body><div class="wrap">
<h2>Blueprint Store</h2>
<p>The panel file <code>{static}</code> was not found. If you already ship a UI, create it at that path.
Otherwise the API is live at <code>/api/blueprint_store/…</code>.</p>
</div></body></html>""".format(static=f"custom_components/{DOMAIN}/{STATIC_DIR_NAME}/{INDEX_RELATIVE}")
        return web.Response(text=html, content_type="text/html")


# ------------------------------ Static + Panel ------------------------------
async def _register_static_and_panel(hass: HomeAssistant) -> None:
    static_dir = hass.config.path(f"custom_components/{DOMAIN}/{STATIC_DIR_NAME}")
    # Serve static bundle (if present)
    if hasattr(hass.http, "register_static_paths"):
        hass.http.register_static_paths([web.StaticResource(STATIC_URL_PATH, static_dir)])
    else:
        hass.http.register_static_path(STATIC_URL_PATH, static_dir, cache_duration=86400)

    # Always register the panel (iframe to our PanelView URL)
    try:
        async_remove_panel(hass, PANEL_URL_PATH)  # safe if missing
    except Exception:
        pass

    async_register_built_in_panel(
        hass,
        component_name="iframe",
        sidebar_title="Blueprint Store",
        sidebar_icon="mdi:storefront-outline",
        frontend_url_path=PANEL_URL_PATH,
        config={"url": "/api/blueprint_store/panel"},
        require_admin=False,
        update=True,
    )


# ------------------------------ Setup / Unload ------------------------------
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
    hass.http.register_view(PanelView)

    # Static + panel
    await _register_static_and_panel(hass)

    # Background coordinator
    coord = BlueprintStoreCoordinator(hass, db_path)
    hass.data[DOMAIN][DATA_COORD] = coord
    await coord.async_config_entry_first_refresh()

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    try:
        async_remove_panel(hass, PANEL_URL_PATH)
    except Exception:
        pass
    return True
