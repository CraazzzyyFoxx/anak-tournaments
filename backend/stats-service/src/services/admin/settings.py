"""Admin service for global Settings CRUD (superuser only)."""

from __future__ import annotations

from collections.abc import Sequence

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import errors
from shared.repository import SettingsRepository
from shared.schemas.settings import settings_schema
from shared.services.settings_provider import settings_provider

__all__ = ("SettingsService", "settings_service")


class SettingsService:
    def __init__(self, *, repo: SettingsRepository = SettingsRepository()) -> None:
        self.repo = repo

    async def list_settings(self, session: AsyncSession) -> Sequence[models.Settings]:
        rows, _ = await self.repo.list(session)
        return rows

    async def get_setting(self, session: AsyncSession, key: str) -> models.Settings:
        setting = await self.repo.get_by_key(session, key)
        if setting is None:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg=f"Setting '{key}' not found")],
            )
        return setting

    @staticmethod
    def _validate_value(key: str, value: dict) -> None:
        model = settings_schema(key)
        if model is None:
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[errors.ApiExc(code="unknown_setting", msg=f"Unknown settings key '{key}'")],
            )
        try:
            model.model_validate(value)
        except ValidationError as exc:
            raise errors.ApiHTTPException(
                status_code=422,
                detail=[errors.ApiExc(code="invalid_setting", msg=str(exc))],
            )

    async def upsert_setting(
        self,
        session: AsyncSession,
        key: str,
        value: dict,
        *,
        description: str | None,
        updated_by: int | None,
    ) -> models.Settings:
        """Validate against the per-key schema, persist, and invalidate the cache."""
        self._validate_value(key, value)
        setting = await self.repo.upsert(session, key, value, description=description, updated_by=updated_by)
        await session.commit()
        # ``updated_at`` (onupdate=func.now()) is expired by the UPDATE flush; load it here so
        # the response's sync read does not lazy-load outside the greenlet (MissingGreenlet).
        await session.refresh(setting)
        await settings_provider.invalidate_setting(key)
        return setting


settings_service = SettingsService()
