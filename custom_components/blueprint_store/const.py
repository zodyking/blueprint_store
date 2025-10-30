# -*- coding: utf-8 -*-
DOMAIN = "blueprint_store"

# Sidebar panel
PANEL_URL_PATH = "blueprint_store"        # shows as /blueprint_store in the UI
PANEL_TITLE = "Blueprint Store"
PANEL_ICON = "mdi:shopping"               # HA built-in icon (store-ish)

# Where we expose the static panel assets (index.html, app.js, css, images)
STATIC_URL_PATH = "/blueprint_store_static"

# Where the integration keeps its data (db, cache, etc)
DATA_DIRNAME = "blueprint_store"
DB_FILENAME = "blueprints.sqlite3"

# Refresh window for background sync (local cache/db)
REFRESH_INTERVAL_SECS = 30 * 60  # 30 minutes

# API base
API_BASE = "/api/blueprint_store"
