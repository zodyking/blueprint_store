DOMAIN = "blueprint_store"

# Discourse category: Blueprints Exchange (id 53)
CATEGORY_ID = 53

# Crawl limits / refresh
DEFAULT_MAX_PAGES = 800
DEFAULT_CACHE_SECONDS = 6 * 60 * 60

# Discourse + import detection
COMMUNITY_BASE = "https://community.home-assistant.io"
IMPORT_PATH_FRAGMENT = "/redirect/blueprint_import"

# HTTP endpoints & panel
API_BASE = "/api/blueprint_store"
STATIC_BASE = "/blueprint_store_static"
PANEL_URL = f"{STATIC_BASE}/index.html"

# Sidebar
SIDEBAR_TITLE = "Blueprint Store"
SIDEBAR_ICON = "mdi:clipboard-text-search-outline"

# Curated categories shown in the UI (and used for server-side filtering)
CURATED_BUCKETS = [
    "Lighting",
    "Climate & Ventilation",
    "Security & Alarm",
    "Safety (Smoke/CO/Leak)",
    "Presence & Occupancy",
    "Access & Locks",
    "Cameras & Vision",
    "Media & Entertainment",
    "AI & Assistants",                 # NEW
    "Announcements & Notifications",   # (TTS lives here)
    "Energy & Power",
    "Environment & Weather",
    "Appliances & Utilities",
    "Scheduling & Scenes",
    "System & Maintenance",
    "Other",
]
