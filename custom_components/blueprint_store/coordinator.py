# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN, DB_FILENAME, REFRESH_INTERVAL_SECS
# Import the module, not a symbol, to avoid ImportError on partially-loaded modules
from . import db as dbmod

_LOGGER = logging.getLogger(__name__)


class BlueprintStoreCoordinator(DataUpdateCoordinator[Dict[str, Any]]):
    """Coordinates background upkeep of the local Blueprint Store database."""

    def __init__(self, hass: HomeAssistant, db_path: str | None = None) -> None:
        self.hass = hass
        # Default DB location (inside HA config dir)
        self.db_path = db_path or str(Path(hass.config.path(DB_FILENAME)))

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_coordinator",
            update_interval=timedelta(seconds=int(REFRESH_INTERVAL_SECS)),
        )

    async def _async_update_data(self) -> Dict[str, Any]:
        """Periodic tick. Ensure DB exists and open a refresh window if due.

        Actual scraping/upserting is performed elsewhere (API view / task),
        so this coordinator only handles gating and health.
        """
        # Ensure the DB schema exists
        await self.hass.async_add_executor_job(dbmod.ensure_db, self.db_path)

        # Handle possible stale module cache gracefully
        try:
            refresh_due = await dbmod.async_refresh_if_due(self.hass, self.db_path)
        except AttributeError:
            # If a stale db.py was cached during a reload, force a reload once.
            from importlib import reload

            _LOGGER.debug("Reloading db module after AttributeError on import")
            reload(dbmod)
            refresh_due = await dbmod.async_refresh_if_due(self.hass, self.db_path)

        if refresh_due:
            _LOGGER.debug(
                "Refresh window is open for %s; fetcher/upserter will run separately.",
                DOMAIN,
            )

        # Return an empty payload; consumers query the DB directly via your views
        return {}
