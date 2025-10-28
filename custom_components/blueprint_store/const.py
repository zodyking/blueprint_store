from __future__ import annotations
from datetime import timedelta

DOMAIN = "blueprint_store"

# Discourse category: Blueprints Exchange
DISCOURSE_BASE = "https://community.home-assistant.io"
CATEGORY_ID = 53

# Update cadence (with jitter in coordinator)
UPDATE_INTERVAL = timedelta(minutes=30)

# Static UI (keep your current folder names)
PANEL_URL_PATH = "blueprint_store"
STATIC_URL_PATH = "/blueprint_store_static"
STATIC_DIR_NAME = "www"  # <config>/custom_components/blueprint_store/www
INDEX_RELATIVE = "index.html"

# Page size for API (matches your frontend)
PAGE_SIZE = 30
