from __future__ import annotations

DOMAIN = "blueprint_store"

# Sidebar panel
PANEL_URL_PATH = "blueprint_store"
PANEL_TITLE = "Blueprint Store"
PANEL_ICON = "mdi:store"

# Where we mount local static assets used by the panel UI
STATIC_URL_PREFIX = "/blueprint_store_static"

# Route base for API views
API_BASE = "/api/blueprint_store"

# Discourse category for Blueprints Exchange
DISCOURSE_BASE = "https://community.home-assistant.io"
DISCOURSE_BLUEPRINTS_CAT = 53

# Curated buckets exposed as "tags" in the UI filter
CURATED_BUCKETS = [
    "lighting",
    "climate",
    "security",
    "presence",
    "media",
    "notifications",
    "voice",
    "cameras",
    "entry",
    "energy",
    "scenes",
    "buttons",
    "sensors",
    "scheduling",
    "robotics",
    "irrigation",
    "pets",
    "vehicles",
    "zigbee",
    "zwave",
    "mqtt",
    "system",
    "ai",
    "other",
]

# Lightweight keyword mapping for bucket hinting
BUCKET_KEYWORDS = {
    "lighting": ["light", "lights", "luz", "illum", "motion light"],
    "climate": ["hvac", "thermostat", "heating", "cooling", "temperature", "climate"],
    "security": ["security", "alarm", "arm", "disarm", "siren"],
    "presence": ["presence", "occupancy", "person", "people", "away", "home"],
    "media": ["media", "tv", "cast", "spotify", "music", "plex", "kodi"],
    "notifications": ["notify", "notification", "telegram", "pushover", "email"],
    "voice": ["voice", "assistant", "alexa", "google", "conversation", "tts"],
    "cameras": ["camera", "cctv", "snapshot"],
    "entry": ["door", "lock", "doorbell", "garage"],
    "energy": ["energy", "solar", "pv", "battery", "kwh"],
    "scenes": ["scene", "mood", "mode", "sleep", "night"],
    "buttons": ["button", "switch", "remote", "press"],
    "sensors": ["sensor", "humidity", "luminosity", "co2", "ppm"],
    "scheduling": ["schedule", "timer", "cron"],
    "robotics": ["vacuum", "roomba", "robot"],
    "irrigation": ["sprinkler", "irrigation", "watering"],
    "pets": ["pet", "feeder", "litter"],
    "vehicles": ["car", "vehicle", "tesla", "ev", "charger"],
    "zigbee": ["zigbee", "z2m", "zigbee2mqtt"],
    "zwave": ["zwave", "zwavejs", "z-wave"],
    "mqtt": ["mqtt"],
    "system": ["backup", "update", "health", "diagnostic", "utility"],
    "ai": ["ai", "llm", "assistant", "openai"],
}
