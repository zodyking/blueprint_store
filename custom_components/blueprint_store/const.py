"""Constants for the Blueprint Store integration."""

from __future__ import annotations

from datetime import timedelta

# --- Core ---
DOMAIN = "blueprint_store"
NAME = "Blueprint Store"
MANUFACTURER = "Blueprint Store"

# Panel (uses built-in MDI icon name; does not require any static asset)
PANEL_URL_PATH = "blueprint_store"
PANEL_TITLE = "Blueprint Store"
PANEL_ICON = "mdi:shopping-outline"  # uses HA's built-in icon set

# --- Options / Config keys ---
CONF_MAX_PAGES = "max_pages"
CONF_UPDATE_MINUTES = "update_minutes"
CONF_SEARCH_SOURCE = "search_source"          # "live" | "db"
CONF_ENABLE_CREATOR_SPOTLIGHT = "enable_creator_spotlight"
CONF_TAG_THRESHOLD = "tag_threshold"          # int: how many tag keywords must match
CONF_DB_REFRESH_MINUTES = "db_refresh_minutes"
CONF_DB_PRUNE_DAYS = "db_prune_days"

# Valid values for CONF_SEARCH_SOURCE
SEARCH_SOURCE_LIVE = "live"
SEARCH_SOURCE_DB = "db"

# Reasonable defaults used by config_flow and __init__ if option is missing.
DEFAULT_OPTIONS: dict = {
    CONF_MAX_PAGES: 6,                        # how many forum pages to walk per query
    CONF_UPDATE_MINUTES: 30,                  # live crawl backoff / cache window
    CONF_SEARCH_SOURCE: SEARCH_SOURCE_LIVE,   # keep current behavior unless you switch to sqlite
    CONF_ENABLE_CREATOR_SPOTLIGHT: True,
    CONF_TAG_THRESHOLD: 3,                    # require >=3 tag terms to classify
    CONF_DB_REFRESH_MINUTES: 30,              # if/when DB mode is enabled
    CONF_DB_PRUNE_DAYS: 90,                   # keep ~3 months of rows
}

# Helper: convert minutes defaults to timedeltas where needed
DEFAULT_UPDATE_INTERVAL = timedelta(minutes=DEFAULT_OPTIONS[CONF_UPDATE_MINUTES])
DEFAULT_DB_REFRESH_INTERVAL = timedelta(minutes=DEFAULT_OPTIONS[CONF_DB_REFRESH_MINUTES])

# Web endpoints your panel JS calls (keep in sync with your view routes)
API_BASE = f"/api/{DOMAIN}"
API_BLUEPRINTS = f"{API_BASE}/blueprints"
API_FILTERS = f"{API_BASE}/filters"
API_TOPIC = f"{API_BASE}/topic"
API_GO = f"{API_BASE}/go"

# Keys your panel expects in each item (kept here for reference)
ITEM_KEYS = (
    "id", "slug", "title", "author", "excerpt",
    "import_url", "tags", "bucket", "likes", "views", "replies", "uses"
)
