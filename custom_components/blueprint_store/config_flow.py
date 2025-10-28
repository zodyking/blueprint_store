from __future__ import annotations
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    DOMAIN,
    DEFAULT_OPTIONS,
    CONF_UPDATE_MINUTES,
    CONF_MAX_PAGES,
    CONF_MAX_TOPICS,
    CONF_CONCURRENCY,
)


class BlueprintStoreConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Minimal, fast config flow (no heavy work at import time)."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        # Single instance
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        # Immediately create with defaults (no fields needed)
        if user_input is not None:
            return self.async_create_entry(
                title="Blueprint Store",
                data={},
                options=DEFAULT_OPTIONS.copy(),
            )

        # Empty form just to show “Submit”
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        return BlueprintStoreOptionsFlow(config_entry)


class BlueprintStoreOptionsFlow(config_entries.OptionsFlow):
    """Simple options UI; kept lightweight."""

    def __init__(self, entry: config_entries.ConfigEntry) -> None:
        self._entry = entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        opts = {**DEFAULT_OPTIONS, **(self._entry.options or {})}

        if user_input is not None:
            # Sanitize & clamp
            new_opts = {
                CONF_UPDATE_MINUTES: max(5, int(user_input.get(CONF_UPDATE_MINUTES, opts[CONF_UPDATE_MINUTES]))),
                CONF_MAX_PAGES:      max(1, int(user_input.get(CONF_MAX_PAGES, opts[CONF_MAX_PAGES]))),
                CONF_MAX_TOPICS:     max(20, int(user_input.get(CONF_MAX_TOPICS, opts[CONF_MAX_TOPICS]))),
                CONF_CONCURRENCY:    min(6, max(1, int(user_input.get(CONF_CONCURRENCY, opts[CONF_CONCURRENCY])))),
            }
            return self.async_create_entry(title="", data=new_opts)

        schema = vol.Schema({
            vol.Required(CONF_UPDATE_MINUTES, default=opts[CONF_UPDATE_MINUTES]): int,
            vol.Required(CONF_MAX_PAGES,      default=opts[CONF_MAX_PAGES]):      int,
            vol.Required(CONF_MAX_TOPICS,     default=opts[CONF_MAX_TOPICS]):     int,
            vol.Required(CONF_CONCURRENCY,    default=opts[CONF_CONCURRENCY]):    int,
        })
        return self.async_show_form(step_id="init", data_schema=schema)
