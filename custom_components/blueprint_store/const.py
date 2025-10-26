DOMAIN = "blueprint_browser"  # keeping domain stable so you don't need to reinstall

# Discourse category: Blueprints Exchange (id 53)
CATEGORY_ID = 53

# Paging / refresh (Options UI can override cache if you want later)
DEFAULT_MAX_PAGES = 12               # how deep infinite-scroll will go
DEFAULT_CACHE_SECONDS = 6 * 60 * 60  # not used for paged fetch, but kept for future

# HTTP base
COMMUNITY_BASE = "https://community.home-assistant.io"

# Look for the standard My Home Assistant blueprint import redirect
IMPORT_PATH_FRAGMENT = "/redirect/blueprint_import"

API_BASE = "/api/blueprint_browser"
STATIC_BASE = "/blueprint_browser_static"
PANEL_URL = f"{STATIC_BASE}/index.html"

# Sidebar
SIDEBAR_TITLE = "Blueprint Store"
SIDEBAR_ICON = "mdi:clipboard-text-search-outline"
