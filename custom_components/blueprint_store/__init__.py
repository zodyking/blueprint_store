import asyncio
import html
import os
import re
import inspect
import logging
from urllib.parse import urljoin

from aiohttp import web
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.components import frontend as ha_frontend

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

_LOGGER = logging.getLogger(__name__)

TAG_RE = re.compile(r"<[^>]+>")
WS_RE  = re.compile(r"\s+")

def _excerpt(cooked_html: str, max_len: int = 340) -> str:
    txt = TAG_RE.sub(" ", cooked_html or "")
    txt = WS_RE.sub(" ", txt).strip()
    return (txt[: max_len - 1] + "…") if len(txt) > max_len else txt

def _cfg(hass: HomeAssistant):
    store = hass.data.setdefault(DOMAIN, {})
    return store.setdefault("cfg", {
        "max_pages": DEFAULT_MAX_PAGES,
        "cache_seconds": DEFAULT_CACHE_SECONDS,
    })

async def _fetch_json(session, url):
    headers = {
        "Accept": "application/json",
        "User-Agent": "HomeAssistant-BlueprintStore/0.3 (+https://home-assistant.io)"
    }
    async with session.get(url, headers=headers) as resp:
        resp.raise_for_status()
        return await resp.json()

def _maybe_int(s: str | None):
    if not s:
        return None
    m = re.search(r"(\d[\d,._]*)", s)
    if not m:
        return None
    return int(m.group(1).replace(",", "").replace("_", ""))

def _guess_uses_from_cooked(cooked: str) -> int | None:
    # Try common patterns around the MyHA button (best-effort)
    # e.g. "... 1,234 users", "... 999 uses", or badge numbers in spans
    for pat in (
        r">\s*([\d,._]+)\s*users?\b", r">\s*([\d,._]+)\s*uses?\b",
        r'data-users="(\d+)"', r'class="[^"]*myha[^"]*".{0,200}?>([\d,._]+)<'
    ):
        m = re.search(pat, cooked or "", flags=re.IGNORECASE | re.DOTALL)
        if m:
            return _maybe_int(m.group(1))
    return None

async def _topic_detail(session, topic_id: int):
    """Return dict {import_url, excerpt, author, uses} or None."""
    data = await _fetch_json(session, f"{COMMUNITY_BASE}/t/{topic_id}.json")
    posts = data.get("post_stream", {}).get("posts", [])
    if not posts:
        return None
    cooked = posts[0].get("cooked", "") or ""
    # Find the import link
    m = re.search(r'href="([^"]+%s[^"]*)"' % re.escape(IMPORT_PATH_FRAGMENT), cooked)
    if not m:
        return None
    import_href = html.unescape(m.group(1))
    if import_href.startswith("/"):
        import_href = urljoin("https://my.home-assistant.io", import_href)

    author_obj = (data.get("details", {}) or {}).get("created_by", {}) or {}
    author = author_obj.get("username") or ""

    uses = _guess_uses_from_cooked(cooked)  # best-effort

    return {
        "import_url": import_href,
        "excerpt": _excerpt(cooked),
        "author": author,
        "uses": uses,
    }

async def _list_page(hass: HomeAssistant, page: int, q_title: str | None):
    """Fetch a category page; keep only topics with import buttons; optional TITLE-ONLY filter."""
    session = async_get_clientsession(hass)
    primary = f"{COMMUNITY_BASE}/c/blueprints-exchange/{CATEGORY_ID}.json?page={page}"
    fallback = f"{COMMUNITY_BASE}/c/{CATEGORY_ID}.json?page={page}"
    try:
        data = await _fetch_json(session, primary)
    except Exception:
        data = await _fetch_json(session, fallback)

    topics = (data.get("topic_list", {}) or data).get("topics", [])
    sem = asyncio.Semaphore(8)
    out = []

    async def process(t):
        async with sem:
            tid = t["id"]
            title = t.get("title") or t.get("fancy_title") or f"Topic {tid}"
            # TITLE-ONLY filter on the raw topic to avoid fetching details when not matching
            if q_title:
                if q_title.lower() not in title.lower():
                    return
            try:
                detail = await _topic_detail(session, tid)
            except Exception as e:
                _LOGGER.debug("topic %s detail failed: %s", tid, e)
                return
            if not detail:
                return
            out.append({
                "id": tid,
                "title": title,
                "author": detail["author"],
                "topic_url": f"{COMMUNITY_BASE}/t/{tid}",
                "import_url": detail["import_url"],
                "excerpt": detail["excerpt"],
                "uses": detail["uses"],
            })

    tasks = []
    for t in topics:
        if isinstance(t, dict) and "id" in t:
            tasks.append(asyncio.create_task(process(t)))
    if tasks:
        await asyncio.gather(*tasks)

    out.sort(key=lambda x: x["id"], reverse=True)
    return out

# -------- Views (public) --------
class BlueprintsPagedView(HomeAssistantView):
    """
    GET /api/blueprint_store/blueprints?page=0&q_title=...   (title-only search)
    Returns: {items:[...], page:N, has_more:bool}
    """
    url = f"{API_BASE}/blueprints"
    name = f"{DOMAIN}:blueprints"
    requires_auth = False
    cors_allowed = True
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
    async def get(self, request):
        try:
            page = max(0, int(request.query.get("page", "0")))
        except ValueError:
            page = 0
        q_title = request.query.get("q_title")  # Title-only!
        max_pages = int(_cfg(self.hass).get("max_pages", DEFAULT_MAX_PAGES))
        if page >= max_pages:
            return self.json({"items": [], "page": page, "has_more": False})
        try:
            items = await _list_page(self.hass, page, q_title)
            has_more = (page + 1) < max_pages and len(items) > 0
            return self.json({"items": items, "page": page, "has_more": has_more})
        except Exception as e:
            _LOGGER.exception("Blueprint Store: paged list failed")
            return self.json({"items": [], "page": page, "has_more": False, "error": f"{type(e).__name__}: {e}"})

class BlueprintStaticView(HomeAssistantView):
    """Serve /panel files (version-proof)."""
    url = f"{STATIC_BASE}/{{filename:.*}}"
    name = f"{DOMAIN}:static"
    requires_auth = False
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

async def _register(hass: HomeAssistant):
    store = hass.data.setdefault(DOMAIN, {})
    if store.get("registered"):
        return
    hass.http.register_view(BlueprintsPagedView(hass))

    panel_dir = os.path.join(os.path.dirname(__file__), "panel")
    hass.http.register_view(BlueprintStaticView(panel_dir))

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

async def async_setup(hass: HomeAssistant, _config) -> bool:
    await _register(hass)
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    cfg = _cfg(hass)
    cfg["max_pages"] = int(entry.options.get("max_pages", DEFAULT_MAX_PAGES))
    cfg["cache_seconds"] = int(entry.options.get("cache_seconds", DEFAULT_CACHE_SECONDS))
    await _register(hass)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.get(DOMAIN, {}).pop("registered", None)
    return True
