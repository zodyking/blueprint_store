from __future__ import annotations

from typing import Any

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN


class BlueprintStoreConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Minimal config flow – single instance."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is None:
            # Display a single confirmation step
            return self.async_show_form(step_id="user", data_schema=None, description_placeholders={})
        return self.async_create_entry(title="Blueprint Store", data={})

    async def async_step_import(self, user_input: dict[str, Any]) -> FlowResult:
        # Support YAML import if someone adds it accidentally
        return await self.async_step_user(user_input)
