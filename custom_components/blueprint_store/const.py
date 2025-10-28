# custom_components/blueprint_store/const.py
from __future__ import annotations
from datetime import timedelta

# --- Core domain ---
DOMAIN = "blueprint_store"

# --- Discourse source (Blueprints Exchange category) ---
DISCOURSE_BASE = "https://community.home-assistant.io"
CATEGORY_ID = 53

# --- Panel / Static asset paths ---
PANEL_URL_PATH = "blueprint_store"           # sidebar route
STATIC_URL_PATH = "/blueprint_store_static"  # served static base
STATIC_DIR_NAME = "www"                      # under this integration folder
INDEX_RELATIVE = "index.html"                # entry page inside www/

# --- API / paging ---
PAGE_SIZE = 30

# --- Update / crawl defaults (used by config_flow + coordinator) ---
DEFAULT_UPDATE_MINUTES = 30     # refresh cadence
DEFAULT_MAX_PAGES      = 5      # Discourse pages per refresh
DEFAULT_MAX_TOPICS     = 120    # hard cap per refresh
DEFAULT_CONCURRENCY    = 3      # parallel topic-detail fetches (to avoid 429)

UPDATE_INTERVAL = timedelta(minutes=DEFAULT_UPDATE_MINUTES)

# --- Options keys for Config Entry options ---
CONF_UPDATE_MINUTES = "update_minutes"
CONF_MAX_PAGES      = "max_pages"
CONF_MAX_TOPICS     = "max_topics"
CONF_CONCURRENCY    = "concurrency"

# --- Friendly defaults map (for config_flow / options flow) ---
DEFAULT_OPTIONS = {
    CONF_UPDATE_MINUTES: DEFAULT_UPDATE_MINUTES,
    CONF_MAX_PAGES:      DEFAULT_MAX_PAGES,
    CONF_MAX_TOPICS:     DEFAULT_MAX_TOPICS,
    CONF_CONCURRENCY:    DEFAULT_CONCURRENCY,
}
