import asyncio
import html
import os
import re
import inspect
import logging
import time
from urllib.parse import urljoin

from aiohttp import web, ClientError
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.components import frontend as ha_frontend
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED

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
    CURATED_BUCKETS,
)

_LOGGER = logging.getLogger(__name__)

TAG_RE = re.compile(r"<[^>]+>")
WS_RE  = re.compile(r"\s+")

def _excerpt(cooked_html: str, max_len: int = 340) -> str:
    txt = TAG_RE.sub(" ", cooked_html or "")
    txt = WS_RE.sub(" ", txt).strip()
    return (txt[: max_len - 1] + "…") if len(txt) > max_len else txt

def _store(hass: HomeAssistant) -> dict:
    return hass.data.setdefault(DOMAIN, {})

def _cfg(hass: HomeAssistant):
    st = _store(hass)
    return st.setdefault("cfg", {
        "max_pages": DEFAULT_MAX_PAGES,
        "cache_seconds": DEFAULT_CACHE_SECONDS,
    })

def _topic_cache(hass: HomeAssistant) -> dict[int, dict]:
    return _store(hass).setdefault("topic_cache", {})

def _topic_locks(hass: HomeAssistant) -> dict[int, asyncio.Lock]:
    return _store(hass).setdefault("topic_locks", {})

def _rate_state(hass: HomeAssistant) -> dict:
    return _store(hass).setdefault("rate_state", {"last": 0.0})

async def _pace(hass: HomeAssistant, min_interval: float = 0.35):
    st = _rate_state(hass)
    now = time.perf_counter()
    wait = max(0.0, (st["last"] + min_interval) - now)
    if wait:
        await asyncio.sleep(wait)
    st["last"] = time.perf_counter()

async def _fetch_json(hass: HomeAssistant, session, url):
    await _pace(hass)
    headers = {
        "Accept": "application/json",
        "User-Agent": "HomeAssistant-BlueprintStore/0.6 (+https://www.home-assistant.io)",
        "Referer": f"{COMMUNITY_BASE}/c/blueprints-exchange/{CATEGORY_ID}"
    }
    _LOGGER.debug("GET %s", url)
    async with session.get(url, headers=headers, allow_redirects=True) as resp:
        text = await resp.text()
        if resp.status != 200:
            raise ClientError(f"{resp.status} {resp.reason} – {url} – body: {text[:200]}")
        try:
            return await resp.json()
        except Exception as e:
            raise ClientError(f"Invalid JSON from {url}: {text[:200]}") from e

def _maybe_int(text: str | None):
    if not text:
        return None
    m = re.search(r"(\d[\d,._]*)", text)
    if not m:
        return None
    return int(m.group(1).replace(",", "").replace("_", ""))

def _guess_uses_from_cooked(cooked: str) -> int | None:
    for pat in (
        r">\s*([\d,._]+)\s*users?\b",
        r">\s*([\d,._]+)\s*uses?\b",
        r'data-users="(\d+)"',
        r'class="[^"]*myha[^"]*".{0,200}?>([\d,._]+)<',
    ):
        m = re.search(pat, cooked or "", flags=re.IGNORECASE | re.DOTALL)
        if m:
            return _maybe_int(m.group(1))
    return None

_BUCKET_KEYWORDS = {
    "Lighting": ["light","lights","lamp","dimmer","brightness","color","wled","led","hue","lifx","switch (light)"],
    "Climate & Ventilation": ["climate","thermostat","hvac","heating","cooling","heatpump","ac","humidifier","dehumidifier","ventilation","fan","air conditioner"],
    "Security & Alarm": ["alarmo","alarm","arming","arm","disarm","siren","intrusion","security system"],
    "Safety (Smoke/CO/Leak)": ["smoke","smoke detector","co detector","carbon monoxide","gas leak","leak","water leak","flood","fire","safety"],
    "Presence & Occupancy": ["presence","occupancy","motion","motion sensor","person","people","arrive","arrival","leave","leaving","zone","geofence","proximity","bluetooth","ble","wifi presence"],
    "Access & Locks": ["lock","unlock","door lock","garage","garage door","gate","door","window","contact","reed","keypad","entry"],
    "Cameras & Vision": ["camera","snapshot","record","frigate","object detection","rtsp","nvr","doorbell","face","recognition","ocr","image"],
    "Media & Entertainment": ["media","tv","cast","chromecast","sonos","speaker","spotify","plex","kodi","volume","music","shield"],
    "AI & Assistants": ["ai","assistant","assist","agent","llm","openai","chatgpt","gpt","claude","gemini","ollama","whisper","stt","speech-to-text","asr","rhasspy","wyoming","piper","coqui","intent","nlu","conversation"],
    "Announcements & Notifications": ["notify","notification","announce","announcement","tts","text-to-speech","say","speak","mobile_app","push","telegram","discord","slack","email","signal","matrix"],
    "Energy & Power": ["energy","power","solar","pv","inverter","battery","consumption","kwh","watt","utility_meter","price","tariff","charger","ev","vehicle","wallbox","smart plug"],
    "Environment & Weather": ["weather","forecast","rain","wind","storm","temperature","humidity","pressure","air quality","aqi","pm2.5","co2","uv","sun","sunrise","sunset"],
    "Appliances & Utilities": ["washing","washer","dryer","dishwasher","vacuum","roomba","mower","irrigation","sprinkler","pool","spa","water heater","boiler","oven","stove"],
    "Scheduling & Scenes": ["schedule","scheduler","timer","countdown","delay","scene","mode","away","night","sleep","dnd","calendar","routine"],
    "System & Maintenance": ["backup","watchdog","update","restart","health","uptime","database","recorder","purge","snapshot","template","script"],
    "Other": [],
}

def _classify_bucket(title: str, tags: set[str]) -> str:
    t = (title or "").lower()
    lower_tags = {s.lower() for s in (tags or set())}
    for bucket, words in _BUCKET_KEYWORDS.items():
        for w in words:
            if w and (w in t or w in lower_tags):
                return bucket
    if "alarm" in t or "alarmo" in t: return "Security & Alarm"
    if any(x in t for x in ("smoke","leak","gas","carbon monoxide","co ")): return "Safety (Smoke/CO/Leak)"
    if "light" in t or "wled" in t: return "Lighting"
    if any(x in t for x in ("assistant"," llm"," ai","whisper","stt","speech-to-text","intent","nlu")): return "AI & Assistants"
    return "Other"

async def _topic_detail(hass: HomeAssistant, session, topic_id: int):
    cache = _topic_cache(hass)
    entry = cache.get(topic_id)
    now = time.time()
    ttl = int(_cfg(hass).get("cache_seconds", DEFAULT_CACHE_SECONDS))
    if entry and (now - entry["ts"] < max(ttl, 1800)):
        return entry["data"]

    locks = _topic_locks(hass)
    lock = locks.setdefault(topic_id, asyncio.Lock())
    async with lock:
        entry = cache.get(topic_id)
        if entry and (time.time() - entry["ts"] < max(ttl, 1800)):
            return entry["data"]

        data = await _fetch_json(hass, session, f"{COMMUNITY_BASE}/t/{topic_id}.json")
        posts = data.get("post_stream", {}).get("posts", [])
        if not posts:
            cache[topic_id] = {"ts": now, "data": None}
            return None

        cooked = posts[0].get("cooked", "") or ""
        m = re.search(r'href="([^"]+%s[^"]*)"' % re.escape(IMPORT_PATH_FRAGMENT), cooked)
        if not m:
            cache[topic_id] = {"ts": now, "data": None}
            return None

        import_href = html.unescape(m.group(1))
        if import_href.startswith("/"):
            import_href = urljoin("https://my.home-assistant.io", import_href)

        author_obj = (data.get("details", {}) or {}).get("created_by", {}) or {}
        author = author_obj.get("username") or ""
        uses = _guess_uses_from_cooked(cooked)

        payload = {
            "import_url": import_href,
            "excerpt": _excerpt(cooked),
            "author": author,
            "uses": uses,
            "cooked": cooked,
        }
        cache[topic_id] = {"ts": time.time(), "data": payload}
        return payload

async def _fetch_category_topics(hass: HomeAssistant, session, page: int):
    endpoints = [
        f"{COMMUNITY_BASE}/c/blueprints-exchange/{CATEGORY_ID}.json?page={page}",
        f"{COMMUNITY_BASE}/c/{CATEGORY_ID}.json?page={page}",
        f"{COMMUNITY_BASE}/c/blueprints-exchange/{CATEGORY_ID}/l/latest.json?page={page}",
    ]
    last_error = None
    for url in endpoints:
        try:
            data = await _fetch_json(hass, session, url)
            tl = data.get("topic_list", data) or {}
            topics = tl.get("topics", []) or []
            more = bool(tl.get("more_topics_url") or tl.get("more_topics"))
            if topics:
                return topics, more
        except Exception as e:
            last_error = e
            _LOGGER.debug("List endpoint failed %s -> %s", url, e)
    if last_error:
        raise last_error
    return [], False

async def _list_page(hass: HomeAssistant, page: int, q_title: str | None, bucket_filter: str | None):
    session = async_get_clientsession(hass)
    topics, more_hint = await _fetch_category_topics(hass, session, page)

    sem = asyncio.Semaphore(4)
    out = []

    async def process(t):
        async with sem:
            tid = t.get("id")
            if not tid:
                return
            title = t.get("title") or t.get("fancy_title") or f"Topic {tid}"
            topic_tags = set(t.get("tags") or [])
            if q_title and q_title.lower() not in title.lower():
                return
            try:
                detail = await _topic_detail(hass, session, tid)
            except Exception as e:
                _LOGGER.debug("topic %s detail failed: %s", tid, e)
                return
            if not detail:
                return
            bucket = _classify_bucket(title, topic_tags)
            if bucket_filter and bucket != bucket_filter:
                return

            slug = t.get("slug") or ""
            topic_url = f"{COMMUNITY_BASE}/t/{slug}/{tid}" if slug else f"{COMMUNITY_BASE}/t/{tid}"

            out.append({
                "id": tid,
                "title": title,
                "author": detail["author"],
                "topic_url": topic_url,
                "import_url": detail["import_url"],
                "excerpt": detail["excerpt"],
                "uses": detail["uses"],
                "tags": list(topic_tags),
                "bucket": bucket,
            })

    await asyncio.gather(*(process(t) for t in topics if isinstance(t, dict)))
    out.sort(key=lambda x: x["id"], reverse=True)
    return out, more_hint

class BlueprintsPagedView(HomeAssistantView):
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
        q_title = request.query.get("q_title")
        bucket = request.query.get("bucket")
        if bucket and bucket not in CURATED_BUCKETS:
            bucket = None
        sort = (request.query.get("sort") or "new").lower()

        max_pages = int(_cfg(self.hass).get("max_pages", DEFAULT_MAX_PAGES))
        if page >= max_pages:
            return self.json({"items": [], "page": page, "has_more": False})

        try:
            items, more_hint = await _list_page(self.hass, page, q_title, bucket)
            if sort == "title":
                items.sort(key=lambda x: x["title"].lower())
            elif sort == "uses":
                items.sort(key=lambda x: (x["uses"] or 0), reverse=True)
            has_more = more_hint and ((page + 1) < max_pages)
            return self.json({"items": items, "page": page, "has_more": has_more})
        except Exception as e:
            _LOGGER.exception("Blueprint Store: paged list failed")
            return self.json({"items": [], "page": page, "has_more": False, "error": f"{type(e).__name__}: {e}"})

class BlueprintFiltersView(HomeAssistantView):
    url = f"{API_BASE}/filters"
    name = f"{DOMAIN}:filters"
    requires_auth = False
    cors_allowed = True
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
    async def get(self, request):
        return self.json({"tags": CURATED_BUCKETS})

class BlueprintTopicView(HomeAssistantView):
    url = f"{API_BASE}/topic"
    name = f"{DOMAIN}:topic"
    requires_auth = False
    cors_allowed = True
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
    async def get(self, request):
        try:
            tid = int(request.query.get("id", "0"))
        except ValueError:
            tid = 0
        if not tid:
            return self.json_message("Bad request", status_code=400)
        session = async_get_clientsession(self.hass)
        try:
            detail = await _topic_detail(self.hass, session, tid)
            if not detail:
                return self.json({"id": tid, "cooked": ""})
            return self.json({"id": tid, "title": "", "cooked": detail["cooked"]})
        except Exception as e:
            _LOGGER.exception("Blueprint Store: topic fetch failed")
            return self.json({"id": tid, "cooked": "", "error": f"{type(e).__name__}: {e}"})

class BlueprintStaticView(HomeAssistantView):
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

class BlueprintImagesStaticView(HomeAssistantView):
    url = f"{STATIC_BASE}/images/{{filename:.*}}"
    name = f"{DOMAIN}:static_images"
    requires_auth = False
    cors_allowed = True
    def __init__(self, images_dir: str) -> None:
        self._images_dir = images_dir
    async def get(self, request, filename: str):
        base = os.path.abspath(self._images_dir)
        path = os.path.abspath(os.path.join(base, filename or ""))
        if not path.startswith(base) or not os.path.isfile(path):
            return self.json_message("Not found", status_code=404)
        return web.FileResponse(path)

async def _register_views_and_panel(hass: HomeAssistant):
    store = _store(hass)
    lock: asyncio.Lock = store.setdefault("reg_lock", asyncio.Lock())
    async with lock:
        if store.get("registered"):
            return
        try:
            hass.http.register_view(BlueprintsPagedView(hass))
            hass.http.register_view(BlueprintFiltersView(hass))
            hass.http.register_view(BlueprintTopicView(hass))
        except Exception as e:
            _LOGGER.exception("Blueprint Store: failed to register API views: %s", e)

        try:
            panel_dir = os.path.join(os.path.dirname(__file__), "panel")
            images_dir = os.path.join(os.path.dirname(__file__), "images")
            hass.http.register_view(BlueprintStaticView(panel_dir))
            hass.http.register_view(BlueprintImagesStaticView(images_dir))
        except Exception as e:
            _LOGGER.exception("Blueprint Store: failed to register static views: %s", e)

        try:
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
        except ValueError as e:
            if "Overwriting panel" in str(e):
                _LOGGER.debug("Blueprint Store: panel already exists; continuing")
            else:
                _LOGGER.exception("Blueprint Store: panel register failed: %s", e)
        except Exception as e:
            _LOGGER.exception("Blueprint Store: panel register failed: %s", e)

        store["registered"] = True

async def _register(hass: HomeAssistant):
    await _register_views_and_panel(hass)

async def async_setup(hass: HomeAssistant, _config) -> bool:
    try:
        if getattr(hass, "http", None) is None:
            async def _on_started(_):
                await _register(hass)
            hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _on_started)
        else:
            await _register(hass)
    except Exception as e:
        _LOGGER.exception("Blueprint Store: async_setup soft-failed: %s", e)
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    try:
        cfg = _cfg(hass)
        cfg["max_pages"] = int(entry.options.get("max_pages", DEFAULT_MAX_PAGES))
        cfg["cache_seconds"] = int(entry.options.get("cache_seconds", DEFAULT_CACHE_SECONDS))
        if getattr(hass, "http", None) is None:
            async def _on_started(_):
                await _register(hass)
            hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _on_started)
        else:
            await _register(hass)
        return True
    except Exception as e:
        _LOGGER.exception("Blueprint Store: async_setup_entry soft-failed: %s", e)
        return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    _store(hass).pop("registered", None)
    return True
