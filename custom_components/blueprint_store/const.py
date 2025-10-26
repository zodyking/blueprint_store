DOMAIN = "blueprint_browser"

# Discourse category: Blueprints Exchange (id 53)
CATEGORY_ID = 53

# Defaults (UI Options can override)
DEFAULT_MAX_PAGES = 3               # how many forum pages to scan
DEFAULT_CACHE_SECONDS = 6 * 60 * 60 # 6 hours

# HTTP base
COMMUNITY_BASE = "https://community.home-assistant.io"

# Look for the standard My Home Assistant blueprint import redirect
IMPORT_PATH_FRAGMENT = "/redirect/blueprint_import"

API_BASE = "/api/blueprint_browser"
STATIC_BASE = "/blueprint_browser_static"
PANEL_URL = f"{STATIC_BASE}/index.html"
SIDEBAR_TITLE = "Blueprint Browser"
SIDEBAR_ICON = "mdi:clipboard-text-search-outline"
