from __future__ import annotations
import asyncio, random
from typing import List, Dict, Any
from datetime import timedelta
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from .const import UPDATE_INTERVAL
from .db import async_upsert_many
from . import discourse

class BlueprintStoreCoordinator(DataUpdateCoordinator):
    """Pulls forum updates into SQLite periodically."""

    def __init__(self, hass: HomeAssistant, db_path: str) -> None:
        super().__init__(
            hass,
            logger=hass.helpers.logger.logger,  # HA logger
            name="Blueprint Store Coordinator",
            update_interval=UPDATE_INTERVAL + timedelta(seconds=random.randint(0, 60)),
        )
        self.db_path = db_path

    async def _async_update_data(self):
        # Strategy: crawl first N pages by recent activity; for each topic, fetch detail
        # Keep it conservative per tick to avoid 429.
        MAX_PAGES = 5
        MAX_TOPICS = 120

        topics: List[Dict[str, Any]] = []
        for p in range(MAX_PAGES):
            try:
                page_items = await discourse.fetch_category_page(self.hass, p)
            except Exception:  # noqa
                break
            topics.extend(page_items)
            if len(page_items) < 20:
                break
            if len(topics) >= MAX_TOPICS:
                break

        # Fetch details in small parallel batches
        out_rows: List[Dict[str, Any]] = []
        SEM = asyncio.Semaphore(3)

        async def get_one(topic_id: int):
            async with SEM:
                try:
                    detail = await discourse.fetch_topic_detail(self.hass, topic_id)
                    out_rows.append(detail)
                except Exception:
                    return

        await asyncio.gather(*(get_one(t["id"]) for t in topics if t.get("id")))

        if out_rows:
            await async_upsert_many(self.hass, self.db_path, out_rows)

        # The coordinator doesn't return useful state to callers in this design.
        return {"updated": len(out_rows)}
