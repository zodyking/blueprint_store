"""Constants for the Blueprint Store integration."""
# ---- Core domain & storage keys ----
DOMAIN = "blueprint_store"
DATA_DIRNAME = "blueprint_store"
DATA_COORDINATOR = f"{DOMAIN}_coordinator"
DATA_LOADED = f"{DOMAIN}_loaded"
# ---- Sidebar panel (frontend) ----
# URL slug that appears in the sidebar (e.g., /blueprint_store)
PANEL_URL_PATH = "blueprint_store"
# Displayed title in the sidebar
PANEL_TITLE = "Blueprint Store"
# Use a built-in Material Design Icon available in Home Assistant
# (avoid external files to reduce setup friction)
PANEL_ICON = "mdi:storefront-outline"
# Static path (served by HA) for images/etc.
# Your repo stores branding at:
# custom_components/blueprint_store/images/...
# We’ll mount that directory at the URL path below.
STATIC_URL_PATH = "/blueprint_store_static"
IMAGES_DIRNAME = "images" # joined in __init__.py to the component folder
# Panel filenames (kept here so __init__.py can import cleanly)
PANEL_DIRNAME = "panel"
PANEL_INDEX_FILE = "index.html"
PANEL_APP_BUNDLE = "app.js"
# ---- REST API base (served by integration views) ----
API_BASE = f"/api/{DOMAIN}"
API_BP_LIST = f"{API_BASE}/blueprints"
API_BP_TOPIC = f"{API_BASE}/topic"
API_FILTERS = f"{API_BASE}/filters"
API_REDIRECT = f"{API_BASE}/go"
# ---- Config Flow / Options ----
# Keys
CONF_SCAN_INTERVAL_MIN = "scan_interval_min"
CONF_MAX_PAGES = "max_pages"
CONF_CACHE_TTL_MIN = "cache_ttl_min"
CONF_ENABLE_SPOTLIGHT = "enable_spotlight"
CONF_SORT_DEFAULT = "sort_default" # "new" | "likes" | "title"
# Sensible defaults (kept conservative to avoid rate limiting)
DEFAULT_SCAN_INTERVAL_MIN = 30 # how often to refresh cache (minutes)
DEFAULT_MAX_PAGES = 4 # how many forum pages to crawl per refresh
DEFAULT_CACHE_TTL_MIN = 30 # in-memory cache TTL (minutes)
DEFAULT_ENABLE_SPOTLIGHT = True # show Creator Spotlight section
DEFAULT_SORT_DEFAULT = "new" # initial sort mode
# Some flows expect a mapping they can import directly.
DEFAULT_OPTIONS = {
    CONF_SCAN_INTERVAL_MIN: DEFAULT_SCAN_INTERVAL_MIN,
    CONF_MAX_PAGES: DEFAULT_MAX_PAGES,
    CONF_CACHE_TTL_MIN: DEFAULT_CACHE_TTL_MIN,
    CONF_ENABLE_SPOTLIGHT: DEFAULT_ENABLE_SPOTLIGHT,
    CONF_SORT_DEFAULT: DEFAULT_SORT_DEFAULT,
}
# ---- Misc keys used across modules (keep names stable) ----
ATTR_ID = "id"
ATTR_TITLE = "title"
ATTR_SLUG = "slug"
ATTR_AUTHOR = "author"
ATTR_EXCERPT = "excerpt"
ATTR_TAGS = "tags"
ATTR_BUCKET = "bucket"
ATTR_IMPORT_URL = "import_url"
ATTR_LIKES = "likes"
ATTR_VIEWS = "views"
ATTR_REPLIES = "replies"
ATTR_USES = "uses" # if you compute “install count” heuristics
ATTR_CREATED_AT = "created_at"
ATTR_UPDATED_AT = "updated_at"
# Sorting modes accepted by the frontend (drop-down)
SORT_NEW = "new"
SORT_LIKES = "likes"
SORT_TITLE = "title"
VALID_SORTS = {SORT_NEW, SORT_LIKES, SORT_TITLE}
# Query param names (so views and UI can share a contract)
QP_PAGE = "page"
QP_Q_TITLE = "q_title"
QP_Q_TEXT = "q_text"
QP_SORT = "sort"
QP_BUCKET = "bucket"
# Retry/backoff defaults for forum requests (UI may show 429s otherwise)
HTTP_RETRY_BASE_MS = 600
HTTP_RETRY_MAX_TRIES = 3
# Keys for hass.data scoping
DATA_HTTP_SESSION = f"{DOMAIN}_http_session"
DATA_STATIC_MOUNTED = f"{DOMAIN}_static_mounted"
