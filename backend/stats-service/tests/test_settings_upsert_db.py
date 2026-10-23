"""``upsert_setting`` against a real database: the returned row must serialize after an UPDATE."""

from __future__ import annotations

import asyncio
import os

import sqlalchemy as sa

from shared import models
from shared.testing.db import real_db_sessionmaker
from src import schemas
from src.services.admin.settings import settings_service


def test_saving_an_existing_setting_returns_a_row_the_response_can_read() -> None:
    # Regression: the UPDATE flush expires ``updated_at`` (onupdate=func.now()), so reading it
    # for the response lazy-loaded outside the greenlet -> MissingGreenlet on every re-save.
    key = f"test-{os.getpid()}.rank_collection"

    async def run() -> None:
        async with real_db_sessionmaker() as factory:
            try:
                for enabled in (False, True):
                    async with factory() as session:
                        setting = await settings_service.upsert_setting(
                            session, key, {"enabled": enabled}, description=None, updated_by=None
                        )
                        read = schemas.SettingRead.model_validate(setting)
                assert read.value == {"enabled": True}
                assert read.updated_at is not None
            finally:
                async with factory() as session:
                    await session.execute(sa.delete(models.Settings).where(models.Settings.key == key))
                    await session.commit()

    asyncio.run(run())
