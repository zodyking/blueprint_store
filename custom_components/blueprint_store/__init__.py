# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import os
from pathlib import Path

from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.http import StaticPathConfig

from .const import (
    DOMAIN,
    PANEL_URL_PATH,
    PANEL_TITLE,
    PANEL_ICON,
    STATIC_URL_PATH,
    DATA_DIRNAME,
    DB_FILENAME,
)
from .db import async_init_db, async_refresh_if_due

try:
    from .api import register_api_views  # (hass, db_path) -> None
except Exception:
    register_api_views = None

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Blueprint Store from a config entry."""

    # 1) Data dir + DB
    data_dir = Path(hass.config.path(DATA_DIRNAME))
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = str(data_dir / DB_FILENAME)
    await async_init_db(hass, db_path)

    # 2) Static mounts
    #    - /blueprint_store_static -> panel dir (index.html, app.js, css)
    #    - /blueprint_store_static/images -> images dir (outside panel)
    panel_dir = Path(os.path.dirname(__file__)) / "panel"
    images_dir = Path(os.path.dirname(__file__)) / "images"

    if not panel_dir.exists():
        _LOGGER.warning("Panel directory does not exist: %s", panel_dir)
    if not images_dir.exists():
        _LOGGER.warning("Images directory does not exist: %s", images_dir)

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                url_path=STATIC_URL_PATH,      # e.g. /blueprint_store_static
                path=str(panel_dir),           # serves index.html, app.js, css
                cache_headers=True,
            ),
            StaticPathConfig(
                url_path=f"{STATIC_URL_PATH}/images",  # e.g. /blueprint_store_static/images
                path=str(images_dir),                 # serves component-level images
                cache_headers=True,
            ),
        ]
    )

    # 3) Sidebar panel (iframe to our index.html)
    await hass.components.frontend.async_register_built_in_panel(
        component_name="iframe",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,  # /blueprint_store
        config={"url": f"{STATIC_URL_PATH}/index.html"},
        require_admin=False,
    )

    # 4) Keep state for unload
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["db_path"] = db_path
    hass.data[DOMAIN]["panel_registered"] = True

    # 5) API views (if present)
    if register_api_views:
        try:
            register_api_views(hass, db_path)
        except Exception as e:
            _LOGGER.exception("Failed to register Blueprint Store API views: %s", e)

    # 6) Non-fatal refresh gate
    try:
        await async_refresh_if_due(hass, db_path, force=False)
    except Exception as e:
        _LOGGER.debug("Refresh gate check failed (non-fatal): %s", e)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload integration and remove the sidebar panel."""
    try:
        if hass.data.get(DOMAIN, {}).get("panel_registered"):
            await hass.components.frontend.async_remove_panel(PANEL_URL_PATH)
    except Exception as e:
        _LOGGER.debug("Panel removal warning: %s", e)

    hass.data.pop(DOMAIN, None)
    return True
