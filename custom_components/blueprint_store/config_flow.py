# custom_components/blueprint_store/config_flow.py
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback

DOMAIN = "blueprint_store"


class BlueprintStoreConfigFlow(ConfigFlow, domain=DOMAIN):
    """Simple single-instance config flow (no fields)."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        # Allow only one instance
        if any(entry.domain == DOMAIN for entry in self._async_current_entries()):
            return self.async_abort(reason="single_instance_allowed")
        return self.async_create_entry(title="Blueprint Store", data={})

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return BlueprintStoreOptionsFlow(config_entry)


class BlueprintStoreOptionsFlow(OptionsFlow):
    """No-op options (kept for future expansion)."""

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry

    async def async_step_init(self, user_input=None):
        # Nothing to configure yet
        return self.async_create_entry(title="", data={})
