from __future__ import annotations

from homeassistant import config_entries
from homeassistant.core import callback

DOMAIN = "blueprint_store"


class BlueprintStoreConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create the config entry with no fields."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            if self._async_current_entries():
                return self.async_abort(reason="already_configured")
            return self.async_create_entry(title="Blueprint Store", data={})
        return self.async_show_form(step_id="user", data_schema=None)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return BlueprintStoreOptionsFlow(config_entry)


class BlueprintStoreOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, entry):
        self.entry = entry

    async def async_step_init(self, user_input=None):
        return self.async_create_entry(title="", data={})
