from __future__ import annotations

from homeassistant import config_entries
from homeassistant.core import callback
import voluptuous as vol

from .const import DOMAIN, DEFAULT_MAX_PAGES, DEFAULT_CACHE_SECONDS

class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="already_configured")
        if user_input is not None:
            return self.async_create_entry(title="Blueprint Store", data={})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    async def async_step_import(self, user_input):
        return await self.async_step_user(user_input)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return OptionsFlowHandler(config_entry)

class OptionsFlowHandler(config_entries.OptionsFlow):
    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        opts = self.config_entry.options
        schema = vol.Schema({
            vol.Optional("max_pages", default=opts.get("max_pages", DEFAULT_MAX_PAGES)): int,
            vol.Optional("cache_seconds", default=opts.get("cache_seconds", DEFAULT_CACHE_SECONDS)): int,
        })
        return self.async_show_form(step_id="init", data_schema=schema)
