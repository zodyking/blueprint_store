from __future__ import annotations

from typing import Any
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback

from .const import DOMAIN, DEFAULT_MAX_PAGES, DEFAULT_CACHE_SECONDS


class BlueprintStoreConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Set up the Blueprint Store integration from the UI."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            # Create a single entry; options will hold tunables
            return self.async_create_entry(title="Blueprint Store", data={}, options={
                "max_pages": DEFAULT_MAX_PAGES,
                "cache_seconds": DEFAULT_CACHE_SECONDS,
            })

        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        return BlueprintStoreOptionsFlow(config_entry)


class BlueprintStoreOptionsFlow(config_entries.OptionsFlow):
    """Options flow without storing the entry on self manually (no deprecation)."""

    def __init__(self, entry: config_entries.ConfigEntry) -> None:
        self._entry = entry  # keep a ref, do NOT assign on base class

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        return await self.async_step_main(user_input)

    async def async_step_main(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        opts = self._entry.options
        return self.async_show_form(
            step_id="main",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        "max_pages",
                        default=opts.get("max_pages", DEFAULT_MAX_PAGES),
                    ): int,
                    vol.Optional(
                        "cache_seconds",
                        default=opts.get("cache_seconds", DEFAULT_CACHE_SECONDS),
                    ): int,
                }
            ),
        )
