DOMAIN = "blueprint_browser"

# Discourse category: Blueprints Exchange (id 53)
# We page through a few pages for performance; bump if you want more.
CATEGORY_ID = 53
MAX_PAGES = 3  # 3 pages ~ recent topics; increase for deeper history

# Cache refresh (seconds)
CACHE_SECONDS = 6 * 60 * 60  # 6 hours

# HTTP base
COMMUNITY_BASE = "https://community.home-assistant.io"

# Recognize posts that have a "My HA" blueprint import button
IMPORT_PATH_FRAGMENT = "/redirect/blueprint_import"

API_BASE = "/api/blueprint_browser"
STATIC_BASE = "/blueprint_browser_static"
PANEL_URL = f"{STATIC_BASE}/index.html"
SIDEBAR_TITLE = "Blueprint Browser"
SIDEBAR_ICON = "mdi:clipboard-text-search-outline"
