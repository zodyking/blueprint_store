from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from aiohttp import web, ClientResponseError
import async_timeout

from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import HomeAssistantView

from .const import (
    DOMAIN,
    PANEL_URL_PATH,
    PANEL_TITLE,
    PANEL_ICON,
    STATIC_URL_PREFIX,
    API_BASE,
    DISCOURSE_BASE,
    DISCOURSE_BLUEPRINTS_CAT,
    CURATED_BUCKETS,
    BUCKET_KEYWORDS,
)

_LOGGER = logging.getLogger(__name__)

# ---------------- Utilities ----------------


def _slugify_bucket(title: str, tags: List[str]) -> str:
    src = " ".join([title.lower(), *[t.lower() for t in (tags or [])]])
    for bucket, keys in BUCKET_KEYWORDS.items():
        if any(k in src for k in keys):
            return bucket
    return "other"


async def _get_json(hass: HomeAssistant, url: str, tries: int = 3, timeout: float = 15.0) -> Any:
    session = async_get_clientsession(hass)
    delay = 0.6
    for attempt in range(tries):
        try:
            with async_timeout.timeout(timeout):
                async with session.get(url, headers={"Accept": "application/json"}) as resp:
                    if resp.status == 429 and attempt < tries - 1:
                        await asyncio.sleep(delay)
                        delay *= 2
                        continue
                    resp.raise_for_status()
                    return await resp.json()
        except (asyncio.TimeoutError, ClientResponseError) as exc:
            if attempt == tries - 1:
                raise
            await asyncio.sleep(delay)
            delay *= 2


def _topic_to_item(topic: Dict[str, Any], users_index: Dict[int, str]) -> Dict[str, Any]:
    tid = topic.get("id")
    slug = topic.get("slug") or ""
    title = topic.get("title") or f"Topic {tid}"
    author = ""
    posters = topic.get("posters") or []
    if posters:
        uid = posters[0].get("user_id")
        author = users_index.get(uid, "")
    tags = topic.get("tags") or []
    excerpt = (topic.get("excerpt") or "").strip()
    likes = int(topic.get("like_count") or 0)
    replies = int(topic.get("reply_count") or max((topic.get("posts_count") or 1) - 1, 0))
    bucket = _slugify_bucket(title, tags)

    return {
        "id": tid,
        "slug": slug,
        "title": title,
        "author": author,
        "tags": tags,
        "excerpt": excerpt,
        "likes": likes,
        "replies": replies,
        "bucket": bucket,
        "import_url": None,
        "topic_url": f"{DISCOURSE_BASE}/t/{slug}/{tid}" if slug else f"{DISCOURSE_BASE}/t/{tid}",
        "uses": None,
    }


async def _first_import_link_from_cooked(cooked_html: str) -> Optional[str]:
    if not cooked_html:
        return None
    m = re.search(
        r'https?://(?:my\.home-assistant\.io|www\.home-assistant\.io)/redirect/blueprint_import[^"\']+',
        cooked_html,
        flags=re.I,
    )
    return m.group(0) if m else None


# ---------------- HTTP Views ----------------


class BlueprintListView(HomeAssistantView):
    url = f"{API_BASE}/blueprints"
    name = "api:blueprint_store:blueprints"
    requires_auth = True

    async def get(self, request: web.Request) -> web.StreamResponse:
        hass: HomeAssistant = request.app["hass"]

        page = int(request.query.get("page", "0"))
        q_title = (request.query.get("q_title") or "").strip()
        sort = (request.query.get("sort") or "new").strip()
        bucket = (request.query.get("bucket") or "").strip().lower()

        items: List[Dict[str, Any]]] = []
        has_more = False

        try:
            if q_title:
                q = q_title.replace("/", " ")
                url = f"{DISCOURSE_BASE}/search.json?q=category%3A{DISCOURSE_BLUEPRINTS_CAT}%20in%3Atitle%20{q}"
                data = await _get_json(hass, url)
                topics = (data or {}).get("topics") or []
                users = (data or {}).get("users") or []
                users_idx = {u.get("id"): (u.get("username") or "") for u in users}
                for t in topics:
                    item = _topic_to_item(t, users_idx)
                    if bucket and item["bucket"] != bucket:
                        continue
                    items.append(item)
                has_more = False
            else:
                url = f"{DISCOURSE_BASE}/c/blueprints-exchange/{DISCOURSE_BLUEPRINTS_CAT}/l/latest.json?page={page}"
                data = await _get_json(hass, url)
                tlist = (data or {}).get("topic_list") or {}
                topics = tlist.get("topics") or []
                users = (data or {}).get("users") or []
                users_idx = {u.get("id"): (u.get("username") or "") for u in users}
                for t in topics:
                    item = _topic_to_item(t, users_idx)
                    if bucket and item["bucket"] != bucket:
                        continue
                    items.append(item)
                has_more = bool(tlist.get("more_topics_url"))
        except Exception as exc:  # noqa: BLE001
            _LOGGER.exception("Failed to fetch blueprint topics: %s", exc)
            return web.json_response(
                {"items": [], "has_more": False, "error": f"{exc.__class__.__name__}: {exc}"},
                status=500,
            )

        if sort == "title":
            items.sort(key=lambda x: (x.get("title") or "").lower())
        elif sort == "likes":
            items.sort(key=lambda x: int(x.get("likes") or 0), reverse=True)

        return web.json_response({"items": items, "has_more": has_more})


class FiltersView(HomeAssistantView):
    url = f"{API_BASE}/filters"
    name = "api:blueprint_store:filters"
    requires_auth = True

    async def get(self, request: web.Request) -> web.StreamResponse:
        return web.json_response({"tags": CURATED_BUCKETS})


class TopicView(HomeAssistantView):
    url = f"{API_BASE}/topic"
    name = "api:blueprint_store:topic"
    requires_auth = True

    async def get(self, request: web.Request) -> web.StreamResponse:
        hass: HomeAssistant = request.app["hass"]
        tid = (request.query.get("id") or "").strip()
        if not tid.isdigit():
            return web.json_response({"error": "missing id"}, status=400)
        try:
            data = await _get_json(hass, f"{DISCOURSE_BASE}/t/{tid}.json")
            posts = (data or {}).get("post_stream", {}).get("posts") or []
            cooked = posts[0].get("cooked") if posts else ""
            import_url = await _first_import_link_from_cooked(cooked or "")
            return web.json_response({"cooked": cooked or "", "import_url": import_url})
        except Exception as exc:  # noqa: BLE001
            _LOGGER.exception("Failed to fetch topic %s: %s", tid, exc)
            return web.json_response({"error": str(exc)}, status=500)


class RedirectView(HomeAssistantView):
    url = f"{API_BASE}/go"
    name = "api:blueprint_store:go"
    requires_auth = True

    async def get(self, request: web.Request) -> web.StreamResponse:
        tid = (request.query.get("tid") or "").strip()
        slug = (request.query.get("slug") or "").strip()
        if not tid.isdigit():
            return web.Response(status=400, text="Bad tid")
        target = f"{DISCOURSE_BASE}/t/{slug}/{tid}" if slug else f"{DISCOURSE_BASE}/t/{tid}"
        raise web.HTTPFound(target)


class PanelHtmlView(HomeAssistantView):
    url = f"{API_BASE}/ui"
    name = "api:blueprint_store:ui"
    requires_auth = True

    def __init__(self, panel_dir: Path) -> None:
        self._panel_dir = panel_dir

    async def get(self, request: web.Request) -> web.StreamResponse:
        index = self._panel_dir / "index.html"
        if not index.exists():
            return web.Response(status=500, text="Panel index.html missing")
        return web.Response(text=index.read_text("utf-8"), content_type="text/html")


# ---------------- Setup / Teardown ----------------


def _mount_static(app, prefix: str, folder: Path) -> None:
    """Mount a static folder under prefix (ignore if already mounted)."""
    try:
        app.router.add_static(prefix, str(folder), show_index=False)
    except Exception:
        # already added or invalid path — ignore
        pass


async def _register_panel_and_static(hass: HomeAssistant) -> None:
    """Mount static assets and register the sidebar panel."""
    base = Path(__file__).parent
    panel_dir = base / "panel"
    images_dir = base / "images"

    app = hass.http.app
    _mount_static(app, STATIC_URL_PREFIX, panel_dir)
    _mount_static(app, f"{STATIC_URL_PREFIX}/images", images_dir)

    # Serve our SPA shell (panel/index.html) via /api/blueprint_store/ui
    hass.http.register_view(PanelHtmlView(panel_dir))

    try:
        # NOTE: this HA build expects frontend_url_path (not url_path)
        async_register_built_in_panel(
            hass,
            component_name="iframe",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            frontend_url_path=PANEL_URL_PATH,
            config={"url": f"{API_BASE}/ui"},
            require_admin=False,
            update=True,
        )
    except Exception as exc:  # noqa: BLE001
        _LOGGER.exception("Failed to register sidebar panel: %s", exc)
        try:
            # In this version async_remove_panel is NOT a coroutine
            async_remove_panel(hass, PANEL_URL_PATH)
            async_register_built_in_panel(
                hass,
                component_name="iframe",
                sidebar_title=PANEL_TITLE,
                sidebar_icon=PANEL_ICON,
                frontend_url_path=PANEL_URL_PATH,
                config={"url": f"{API_BASE}/ui"},
                require_admin=False,
                update=True,
            )
        except Exception:
            _LOGGER.exception("Panel registration retry failed")


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    try:
        await _register_panel_and_static(hass)
    except Exception:
        _LOGGER.exception("Panel/static registration failed; continuing so API still works")

    # REST views for the front-end
    hass.http.register_view(BlueprintListView())
    hass.http.register_view(FiltersView())
    hass.http.register_view(TopicView())
    hass.http.register_view(RedirectView())

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    try:
        async_remove_panel(hass, PANEL_URL_PATH)  # not awaited in this HA version
    except Exception:
        pass
    return True
