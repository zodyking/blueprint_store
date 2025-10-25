# custom_components/blueprint_store/config_flow.py
from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    OptionsFlow,
)
from homeassistant.core import callback

# Keep the domain local here to avoid import cycles
DOMAIN = "blueprint_store"

# Defaults for options
DEFAULT_OPTIONS = {
    "show_in_sidebar": True,
    "require_admin": False,
}


class BlueprintStoreConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the config flow for Blueprint Store (single instance)."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """The only step: create a single instance or abort if already configured."""
        # Enforce single instance
        if any(entry.domain == DOMAIN for entry in self._async_current_entries()):
            return self.async_abort(reason="single_instance_allowed")

        # No fields to ask—just create the entry
        return self.async_create_entry(
            title="Blueprint Store",
            data={},  # no secrets or credentials to store
            options=DEFAULT_OPTIONS.copy(),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow handler."""
        return BlueprintStoreOptionsFlow(config_entry)


class BlueprintStoreOptionsFlow(OptionsFlow):
    """Handle options for Blueprint Store."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._entry = config_entry

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            # Save options only; do NOT set self.config_entry manually (deprecated)
            return self.async_create_entry(title="", data=user_input)

        current = {**DEFAULT_OPTIONS, **(self._entry.options or {})}

        schema = vol.Schema(
            {
                vol.Optional("show_in_sidebar", default=current["show_in_sidebar"]): bool,
                vol.Optional("require_admin", default=current["require_admin"]): bool,
            }
        )

        return self.async_show_form(step_id="init", data_schema=schema)
