import asyncio
import html
import json
import os
import re
from datetime import timedelta
from time import time
from urllib.parse import urljoin

from homeassistant.core import HomeAssistant
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    DOMAIN,
    CATEGORY_ID,
    MAX_PAGES,
    CACHE_SECONDS,
    COMMUNITY_BASE,
    IMPORT_PATH_FRAGMENT,
    API_BASE,
    STATIC_BASE,
    PANEL_URL,
    SIDEBAR_TITLE,
    SIDEBAR_ICON,
)

# Very small HTML->text cleaner for excerpts
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

async def _fetch_topic_import_link(session, topic_id: int):
    """Return (import_url, description_text) if the first post has a blueprint import button; else (None, None)."""
    topic_url = f"{COMMUNITY_BASE}/t/{topic_id}.json"
    data = await _fetch_json(session, topic_url)
    posts = data.get("post_stream", {}).get("posts", [])
    if not posts:
        return None, None

    cooked = posts[0].get("cooked", "") or ""
    # Find the first anchor with the /redirect/blueprint_import path
    # Keep the **full** href so we use the official redirect safely.
    m = re.search(r'href="([^"]+%s[^"]*)"' % re.escape(IMPORT_PATH_FRAGMENT), cooked)
    if not m:
        return None, None

    import_href = html.unescape(m.group(1))
    # If the post used a relative MY link, fix it to absolute
    if import_href.startswith("/"):
        import_href = urljoin("https://my.home-assistant.io", import_href)

    return import_href, _text_excerpt(cooked)

async def _crawl_blueprints(hass: HomeAssistant):
    """Get a list of blueprint posts (title, topic_id, url, import_url, excerpt)."""
    session = async_get_clientsession(hass)
    found = []

    sem = asyncio.Semaphore(8)  # be gentle to the forum

    async def process_topic(t):
        async with sem:
            topic_id = t["id"]
            title = t.get("title") or t.get("fancy_title") or f"Topic {topic_id}"
            topic_web_url = f"{COMMUNITY_BASE}/t/{topic_id}"
            import_url, excerpt = await _fetch_topic_import_link(session, topic_id)
            if import_url:
                found.append({
                    "id": topic_id,
                    "title": title,
                    "topic_url": topic_web_url,
                    "import_url": import_url,
                    "excerpt": excerpt or "",
                })

    # Collect topic IDs from N pages, newest first
    tasks = []
    for page in range(MAX_PAGES):
        page_url = f"{COMMUNITY_BASE}/c/blueprints-exchange/{CATEGORY_ID}.json?page={page}"
        data = await _fetch_json(session, page_url)
        topic_list = data.get("topic_list", {}) or data
        topics = topic_list.get("topics", [])
        for t in topics:
            # Skip banners / moved topics etc.
            if not isinstance(t, dict) or "id" not in t:
                continue
            tasks.append(asyncio.create_task(process_topic(t)))

    if tasks:
        await asyncio.gather(*tasks)

    # Sort newest first by topic id (correlates with recency)
    found.sort(key=lambda x: x["id"], reverse=True)
    return found

async def _refresh(hass: HomeAssistant, force: bool = False):
    now = time()
    store = hass.data.setdefault(DOMAIN, {})
    last = store.get("last_update", 0)
    if not force and (now - last) < CACHE_SECONDS and store.get("items"):
        return  # still fresh

    items = await _crawl_blueprints(hass)
    store["items"] = items
    store["last_update"] = now

class BlueprintListView(HomeAssistantView):
    url = f"{API_BASE}/blueprints"
    name = f"{DOMAIN}:blueprints"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request):
        # ensure cache
        await _refresh(self.hass, force=False)
        items = self.hass.data.get(DOMAIN, {}).get("items", [])
        q = request.query.get("q", "").strip().lower()
        if q:
            items = [i for i in items if q in i["title"].lower() or q in (i["excerpt"] or "").lower()]
        return self.json(items)

class BlueprintTopicView(HomeAssistantView):
    url = f"{API_BASE}/topic/{{topic_id}}"
    name = f"{DOMAIN}:topic"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request, topic_id):
        # details are already in the list; look up by id
        await _refresh(self.hass, force=False)
        items = self.hass.data.get(DOMAIN, {}).get("items", [])
        for i in items:
            if str(i["id"]) == str(topic_id):
                return self.json(i)
        return self.json_message("Not found", status_code=404)

class BlueprintRefreshView(HomeAssistantView):
    url = f"{API_BASE}/refresh"
    name = f"{DOMAIN}:refresh"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def post(self, request):
        await _refresh(self.hass, force=True)
        return self.json({"ok": True})

async def async_setup(hass: HomeAssistant, _config) -> bool:
    # Data store
    hass.data.setdefault(DOMAIN, {"items": [], "last_update": 0})

    # HTTP API + static panel
    hass.http.register_view(BlueprintListView(hass))
    hass.http.register_view(BlueprintTopicView(hass))
    hass.http.register_view(BlueprintRefreshView(hass))

    panel_dir = os.path.join(os.path.dirname(__file__), "panel")
    hass.http.register_static_path(STATIC_BASE, panel_dir, cache_duration=86400)

    # Sidebar app (served via iframe)
    await hass.components.frontend.async_register_built_in_panel(
        component_name="iframe",
        sidebar_title=SIDEBAR_TITLE,
        sidebar_icon=SIDEBAR_ICON,
        frontend_url_path=DOMAIN,
        config={"url": PANEL_URL},
        require_admin=False,
    )

    # Prime cache in background
    hass.async_create_task(_refresh(hass, force=True))
    return True
