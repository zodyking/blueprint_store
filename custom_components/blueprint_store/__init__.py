import asyncio
import html
import os
import re
import inspect
from time import time
from urllib.parse import urljoin

from aiohttp import web
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.components import frontend as ha_frontend  # version-proof import

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

# ---------- tiny helpers ----------
TAG_RE = re.compile(r"<[^>]+>")
WS_RE  = re.compile(r"\s+")

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

# ---------- crawler ----------
async def _fetch_topic_import_link(session, topic_id: int):
    """Return (import_url, excerpt) if first post has a blueprint import button; else (None, None)."""
    data = await _fetch_json(session, f"{COMMUNITY_BASE}/t/{topic_id}.json")
    posts = data.get("post_stream", {}).get("posts", [])
    if not posts:
        return None, None

    cooked = posts[0].get("cooked", "") or ""
    m = re.search(r'href="([^"]+%s[^"]*)"' % re.escape(IMPORT_PATH_FRAGMENT), cooked)
    if not m:
        return None, None

    import_href = html.unescape(m.group(1))
    if import_href.startswith("/"):
        import_href = urljoin("https://my.home-assistant.io", import_href)
    return import_href, _text_excerpt(cooked)

async def _crawl_blueprints(hass: HomeAssistant):
    session = async_get_clientsession(hass)
    found = []
    cfg = _get_cfg(hass)
    max_pages = int(cfg.get("max_pages", DEFAULT_MAX_PAGES))
    sem = asyncio.Semaphore(8)

    async def process_topic(t):
        async with sem:
            tid = t["id"]
            title = t.get("title") or t.get("fancy_title") or f"Topic {tid}"
            topic_web_url = f"{COMMUNITY_BASE}/t/{tid}"
            import_url, excerpt = await _fetch_topic_import_link(session, tid)
            if import_url:
                found.append({
                    "id": tid,
                    "title": title,
                    "topic_url": topic_web_url,
                    "import_url": import_url,
                    "excerpt": excerpt or "",
                })

    tasks = []
    for page in range(max_pages):
        data = await _fetch_json(session, f"{COMMUNITY_BASE}/c/blueprints-exchange/{CATEGORY_ID}.json?page={page}")
        topics = (data.get("topic_list", {}) or data).get("topics", [])
        for t in topics:
            if isinstance(t, dict) and "id" in t:
                tasks.append(asyncio.create_task(process_topic(t)))
    if tasks:
        await asyncio.gather(*tasks)

    found.sort(key=lambda x: x["id"], reverse=True)
    return found

async def _refresh(hass: HomeAssistant, force: bool = False):
    now = time()
    store = hass.data.setdefault(DOMAIN, {})
    cfg = _get_cfg(hass)
    cache_seconds = int(cfg.get("cache_seconds", DEFAULT_CACHE_SECONDS))

    if not force and (now - store.get("last_update", 0)) < cache_seconds and store.get("items"):
        return
    store["items"] = await _crawl_blueprints(hass)
    store["last_update"] = now

# ---------- HTTP views (now public: requires_auth = False) ----------
class BlueprintListView(HomeAssistantView):
    url = f"{API_BASE}/blueprints"
    name = f"{DOMAIN}:blueprints"
    requires_auth = False  # public
    cors_allowed = True
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
    async def get(self, request):
        await _refresh(self.hass, force=False)
        items = self.hass.data.get(DOMAIN, {}).get("items", [])
        q = (request.query.get("q", "") or "").strip().lower()
        if q:
            items = [i for i in items if q in i["title"].lower() or q in (i["excerpt"] or "").lower()]
        return self.json(items)

class BlueprintTopicView(HomeAssistantView):
    url = f"{API_BASE}/topic/{{topic_id}}"
    name = f"{DOMAIN}:topic"
    requires_auth = False  # public
    cors_allowed = True
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
    async def get(self, request, topic_id):
        await _refresh(self.hass, force=False)
        for i in self.hass.data.get(DOMAIN, {}).get("items", []):
            if str(i["id"]) == str(topic_id):
                return self.json(i)
        return self.json_message("Not found", status_code=404)

class BlueprintRefreshView(HomeAssistantView):
    # switched to GET to avoid CSRF
    url = f"{API_BASE}/refresh"
    name = f"{DOMAIN}:refresh"
    requires_auth = False  # public
    cors_allowed = True
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
    async def get(self, request):
        await _refresh(self.hass, force=True)
        return self.json({"ok": True})

class BlueprintStaticView(HomeAssistantView):
    """Serve /panel files without static-path API (version-proof)."""
    url = f"{STATIC_BASE}/{{filename:.*}}"
    name = f"{DOMAIN}:static"
    requires_auth = False  # public to prevent 401 in iframe
    cors_allowed = True
    def __init__(self, panel_dir: str) -> None:
        self._panel_dir = panel_dir
    async def get(self, request, filename: str):
        fn = filename or "index.html"
        base = os.path.abspath(self._panel_dir)
        path = os.path.abspath(os.path.join(base, fn))
        if not path.startswith(base) or not os.path.isfile(path):
            return self.json_message("Not found", status_code=404)
        return web.FileResponse(path)

# ---------- panel registration ----------
async def _register_panel_and_routes(hass: HomeAssistant):
    store = hass.data.setdefault(DOMAIN, {})
    if store.get("registered"):
        return

    # API views
    hass.http.register_view(BlueprintListView(hass))
    hass.http.register_view(BlueprintTopicView(hass))
    hass.http.register_view(BlueprintRefreshView(hass))

    # Static files served via our own view
    panel_dir = os.path.join(os.path.dirname(__file__), "panel")
    hass.http.register_view(BlueprintStaticView(panel_dir))

    # Sidebar panel (handle sync/async across HA versions)
    reg = getattr(ha_frontend, "async_register_built_in_panel", None)
    if reg:
        result = reg(
            hass,
            component_name="iframe",
            sidebar_title=SIDEBAR_TITLE,
            sidebar_icon=SIDEBAR_ICON,
            frontend_url_path=DOMAIN,
            config={"url": PANEL_URL},
            require_admin=False,
        )
        if inspect.isawaitable(result):
            await result

    store["registered"] = True

# ---------- HA entry points ----------
async def async_setup(hass: HomeAssistant, _config) -> bool:
    hass.data.setdefault(DOMAIN, {"items": [], "last_update": 0})
    await _register_panel_and_routes(hass)
    hass.async_create_task(_refresh(hass, force=True))
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    cfg = _get_cfg(hass)
    cfg["max_pages"] = int(entry.options.get("max_pages", DEFAULT_MAX_PAGES))
    cfg["cache_seconds"] = int(entry.options.get("cache_seconds", DEFAULT_CACHE_SECONDS))
    await _register_panel_and_routes(hass)
    hass.async_create_task(_refresh(hass, force=True))
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    # Remove panel if available (supports both sync/async)
    rem = getattr(ha_frontend, "async_remove_panel", None)
    if rem:
        result = rem(hass, DOMAIN)
        if inspect.isawaitable(result):
            await result
    hass.data.get(DOMAIN, {}).pop("registered", None)
    return True
