from __future__ import annotations

import logging
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN
from .db import async_refresh_if_due

_LOGGER = logging.getLogger(__name__)


class BlueprintStoreCoordinator(DataUpdateCoordinator):
    """Refresh the SQLite cache on a schedule / first load."""

    def __init__(self, hass: HomeAssistant, db_path: str) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_coordinator",
            update_interval=None,  # we call refresh explicitly / in db layer
        )
        self.db_path = db_path

    async def _async_update_data(self):
        try:
            await async_refresh_if_due(self.hass, self.db_path)
            return True
        except Exception as err:  # noqa: BLE001
            raise UpdateFailed(str(err)) from err

    async def async_config_entry_first_refresh(self) -> None:
        """Run one refresh during setup, without waiting for scheduler."""
        await self._async_update_data()
