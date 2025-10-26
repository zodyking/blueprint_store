# -------- Curated category (bucket) classifier --------
_BUCKET_KEYWORDS = {
    "Lighting": [
        "light", "lights", "lamp", "dimmer", "brightness", "color",
        "wled", "led", "hue", "lifx", "switch (light)"
    ],
    "Climate & Ventilation": [
        "climate", "thermostat", "hvac", "heating", "cooling", "heatpump", "ac",
        "humidifier", "dehumidifier", "ventilation", "fan", "air conditioner"
    ],
    "Security & Alarm": [
        "alarmo", "alarm", "arming", "arm", "disarm", "siren", "intrusion",
        "security system"
    ],
    "Safety (Smoke/CO/Leak)": [
        "smoke", "smoke detector", "co detector", "carbon monoxide", "gas leak",
        "leak", "water leak", "flood", "fire", "safety"
    ],
    "Presence & Occupancy": [
        "presence", "occupancy", "motion", "motion sensor", "person", "people",
        "arrive", "arrival", "leave", "leaving", "zone", "geofence", "proximity",
        "bluetooth", "ble", "wifi presence"
    ],
    "Access & Locks": [
        "lock", "unlock", "door lock", "garage", "garage door", "gate",
        "door", "window", "contact", "reed", "keypad", "entry"
    ],
    "Cameras & Vision": [
        "camera", "snapshot", "record", "frigate", "object detection", "rtsp",
        "nvr", "doorbell", "face", "recognition", "ocr", "image"
    ],
    "Media & Entertainment": [
        "media", "tv", "cast", "chromecast", "sonos", "speaker", "spotify",
        "plex", "kodi", "volume", "music", "shield"
    ],
    "AI & Assistants": [   # NEW
        "ai", "assistant", "assist", "agent", "llm", "large language model",
        "openai", "chatgpt", "gpt", "claude", "gemini", "ollama",
        "whisper", "stt", "speech-to-text", "asr",
        "rhasspy", "wyoming", "piper", "coqui", "intent", "nlu", "conversation"
    ],
    "Announcements & Notifications": [   # TTS kept here
        "notify", "notification", "announce", "announcement",
        "tts", "text-to-speech", "say", "speak",
        "mobile_app", "push", "telegram", "discord", "slack",
        "email", "signal", "matrix"
    ],
    "Energy & Power": [
        "energy", "power", "solar", "pv", "inverter", "battery",
        "consumption", "kwh", "watt", "utility_meter", "price", "tariff",
        "charger", "ev", "vehicle", "wallbox", "smart plug"
    ],
    "Environment & Weather": [
        "weather", "forecast", "rain", "wind", "storm",
        "temperature", "humidity", "pressure",
        "air quality", "aqi", "pm2.5", "co2", "uv", "sun", "sunrise", "sunset"
    ],
    "Appliances & Utilities": [
        "washing", "washer", "dryer", "dishwasher", "vacuum", "roomba", "mower",
        "irrigation", "sprinkler", "pool", "spa", "water heater", "boiler",
        "oven", "stove"
    ],
    "Scheduling & Scenes": [
        "schedule", "scheduler", "timer", "countdown", "delay",
        "scene", "mode", "away", "night", "sleep", "dnd", "calendar", "routine"
    ],
    "System & Maintenance": [
        "backup", "watchdog", "update", "restart", "health", "uptime",
        "database", "recorder", "purge", "snapshot", "template", "script"
    ],
    "Other": [],
}

def _classify_bucket(title: str, tags: set[str]) -> str:
    """Return one of CURATED_BUCKETS for a topic based on title/tags."""
    t = (title or "").lower()
    lower_tags = {s.lower() for s in (tags or set())}

    # 1) keyword pass
    for bucket, words in _BUCKET_KEYWORDS.items():
        for w in words:
            if w and (w in t or w in lower_tags):
                return bucket

    # 2) tiny heuristics for common patterns
    if "alarm" in t or "alarmo" in t:
        return "Security & Alarm"
    if any(x in t for x in ("smoke", "leak", "gas", "carbon monoxide", "co ")):
        return "Safety (Smoke/CO/Leak)"
    if "light" in t or "wled" in t:
        return "Lighting"
    if any(x in t for x in ("assistant", " llm", " ai", "whisper", "stt", "speech-to-text", "intent", "nlu")):
        return "AI & Assistants"

    return "Other"
