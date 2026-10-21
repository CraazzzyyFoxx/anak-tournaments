"""Typed-RPC handlers for the remaining stats-unique admin surface:

- Catalog sync of one discipline from its module's source (superuser): ``POST /admin/catalog-sync/{discipline}``.
- Global settings CRUD (superuser).
"""

from __future__ import annotations

from typing import Any

import httpx
from faststream.rabbit import RabbitMessage

from shared.catalog_sync import CatalogImageMirror
from shared.clients import CircuitBreakerOpen
from shared.core import errors
from shared.core.errors import BaseAPIException as HTTPException
from shared.disciplines import DISCIPLINES
from shared.services.audit import record_admin_audit
from src import schemas
from src.core import db
from src.core.clients import s3_client
from src.services.admin.settings import settings_service

from . import _common as c

_SF = db.async_session_maker
_catalog_images = CatalogImageMirror(s3_client)


def register(broker: Any, logger: Any) -> None:
    # ── catalog sync (superuser: global game content; the module owns its source) ──────────
    @broker.subscriber("rpc.stats.catalog.sync")
    async def _catalog_sync(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            code = str(data.get("discipline") or "")
            spec = DISCIPLINES.get(code)
            if spec is None or spec.catalog_sync is None:
                raise errors.ApiHTTPException(
                    status_code=404,
                    detail=[errors.ApiExc(code="not_found", msg=f"Discipline {code!r} has no catalog sync")],
                )
            # The sync commits itself: it releases the session before every image round-trip.
            try:
                await spec.catalog_sync(session, _catalog_images)
            except (httpx.HTTPError, CircuitBreakerOpen) as exc:
                # An unreachable or failing source is the upstream's fault, not ours: 503 ("retry shortly", the
                # envelope's `unavailable`; it has no 502), not an opaque 500.
                raise errors.ApiHTTPException(
                    status_code=503,
                    detail=[
                        errors.ApiExc(
                            code="catalog_source_unavailable",
                            msg=f"The {spec.name} catalog source did not answer ({type(exc).__name__}); "
                            "try again in a minute",
                        )
                    ],
                ) from exc
            return {"success": True}

        return await c.envelope(logger, "catalog.sync", op, session_factory=_SF)

    # ── Global settings (superuser) ─────────────────────────────────────────────
    @broker.subscriber("rpc.stats.settings.list")
    async def _settings_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            rows = await settings_service.list_settings(session)
            return [schemas.SettingRead.model_validate(row) for row in rows]

        return await c.envelope(logger, "settings.list", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.settings.get")
    async def _settings_get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            key = data.get("key")
            if not key:
                raise HTTPException(status_code=422, detail="key is required")
            setting = await settings_service.get_setting(session, key)
            return schemas.SettingRead.model_validate(setting)

        return await c.envelope(logger, "settings.get", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.settings.upsert")
    async def _settings_upsert(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_superuser(user)
            key = data.get("key")
            if not key:
                raise HTTPException(status_code=422, detail="key is required")
            body = schemas.SettingUpsert.model_validate(c.payload(data))
            after: dict[str, Any] = {"key": key}
            if body.description is not None:
                after["description"] = body.description
            # Key (+ description) only — a setting value can carry a credential.
            await record_admin_audit(
                session,
                action="setting.upsert",
                actor=user,
                data=data,
                workspace_id=None,
                entity_type="setting",
                entity_label=key,
                after=after,
            )
            # `settings_service.upsert_setting` already commits — no rpc-level
            # re-commit.
            setting = await settings_service.upsert_setting(
                session, key, body.value, description=body.description, updated_by=user.id
            )
            return schemas.SettingRead.model_validate(setting)

        return await c.envelope(logger, "settings.upsert", op, session_factory=_SF)
