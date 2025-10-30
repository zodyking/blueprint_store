"""Config and Options flow for Blueprint Store."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResult

from .const import (
    DOMAIN,
    NAME,
    DEFAULT_OPTIONS,
    CONF_MAX_PAGES,
    CONF_UPDATE_MINUTES,
    CONF_SEARCH_SOURCE,
    CONF_ENABLE_CREATOR_SPOTLIGHT,
    CONF_TAG_THRESHOLD,
    CONF_DB_REFRESH_MINUTES,
    CONF_DB_PRUNE_DAYS,
    SEARCH_SOURCE_DB,
    SEARCH_SOURCE_LIVE,
)

# Single instance integration
class BlueprintStoreFlowHandler(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        # Only one instance allowed
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        # We don’t need any data to start; create with defaults
        return self.async_create_entry(title=NAME, data={}, options=DEFAULT_OPTIONS.copy())

    async def async_step_import(self, user_input: dict[str, Any]) -> FlowResult:
        # For YAML (not really used here) – behave like user step
        return await self.async_step_user(user_input)


def _options_schema(current: dict[str, Any]) -> vol.Schema:
    """Build the options schema using current options as defaults."""
    return vol.Schema(
        {
            vol.Optional(CONF_MAX_PAGES, default=current.get(CONF_MAX_PAGES, DEFAULT_OPTIONS[CONF_MAX_PAGES])): vol.All(
                int, vol.Range(min=1, max=50)
            ),
            vol.Optional(CONF_UPDATE_MINUTES, default=current.get(CONF_UPDATE_MINUTES, DEFAULT_OPTIONS[CONF_UPDATE_MINUTES])): vol.All(
                int, vol.Range(min=5, max=720)
            ),
            vol.Optional(CONF_DB_REFRESH_MINUTES, default=current.get(CONF_DB_REFRESH_MINUTES, DEFAULT_OPTIONS[CONF_DB_REFRESH_MINUTES])): vol.All(
                int, vol.Range(min=10, max=1440)
            ),
            vol.Optional(CONF_DB_PRUNE_DAYS, default=current.get(CONF_DB_PRUNE_DAYS, DEFAULT_OPTIONS[CONF_DB_PRUNE_DAYS])): vol.All(
                int, vol.Range(min=7, max=365)
            ),
            vol.Optional(
                CONF_SEARCH_SOURCE, default=current.get(CONF_SEARCH_SOURCE, DEFAULT_OPTIONS[CONF_SEARCH_SOURCE])
            ): vol.In([SEARCH_SOURCE_LIVE, SEARCH_SOURCE_DB]),
            vol.Optional(
                CONF_ENABLE_CREATOR_SPOTLIGHT,
                default=current.get(CONF_ENABLE_CREATOR_SPOTLIGHT, DEFAULT_OPTIONS[CONF_ENABLE_CREATOR_SPOTLIGHT]),
            ): bool,
            vol.Optional(
                CONF_TAG_THRESHOLD, default=current.get(CONF_TAG_THRESHOLD, DEFAULT_OPTIONS[CONF_TAG_THRESHOLD])
            ): vol.All(int, vol.Range(min=1, max=10)),
        }
    )


class BlueprintStoreOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle Blueprint Store options."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self.config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            # Persist merged options
            new = dict(self.config_entry.options)
            new.update(user_input)
            return self.async_create_entry(title="", data=new)

        schema = _options_schema(self.config_entry.options or {})
        return self.async_show_form(step_id="init", data_schema=schema)


async def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> BlueprintStoreOptionsFlowHandler:
    return BlueprintStoreOptionsFlowHandler(config_entry)
