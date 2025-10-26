DOMAIN = "blueprint_store"

# Discourse category: Blueprints Exchange (id 53)
CATEGORY_ID = 53

# Crawl limits / refresh
DEFAULT_MAX_PAGES = 800              # scan deep so search returns “everything”
DEFAULT_CACHE_SECONDS = 6 * 60 * 60  # reserved for future cache

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
