DOMAIN = "blueprint_store"

# Discourse category: Blueprints Exchange (id 53)
CATEGORY_ID = 53

# Paging / refresh
DEFAULT_MAX_PAGES = 12               # how deep infinite-scroll will go
DEFAULT_CACHE_SECONDS = 6 * 60 * 60  # reserved for future cache logic

# Discourse + import detection
COMMUNITY_BASE = "https://community.home-assistant.io"
IMPORT_PATH_FRAGMENT = "/redirect/blueprint_import"

# HTTP endpoints and panel paths
API_BASE = "/api/blueprint_store"
STATIC_BASE = "/blueprint_store_static"
PANEL_URL = f"{STATIC_BASE}/index.html"

# Sidebar
SIDEBAR_TITLE = "Blueprint Store"
SIDEBAR_ICON = "mdi:clipboard-text-search-outline"
