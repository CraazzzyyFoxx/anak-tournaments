"""Admin CRUD for the game catalog (``catalog.entity``): one surface for every discipline and kind (D85).

Superuser-only — the catalog is global game content. Pure transport: gate, decode, one service call. The discipline and
kind arrive as path parameters (``/api/v1/admin/catalog/{discipline}/{kind}``).
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core.pagination import paginated_dump
from shared.rpc.query import build_query_model
from shared.services.audit import record_admin_audit
from src import schemas
from src.core import db
from src.services.admin.catalog import catalog as catalog_service
from src.services.admin.catalog import to_read

from . import _common as c

_SF = db.async_session_maker
_AUDIT_TYPE = "catalog_entity"


def _gate(data: dict) -> None:
    c.require_superuser(c.actor(data))


def _path(data: dict) -> tuple[str, str]:
    return str(data.get("discipline") or ""), str(data.get("kind") or "")


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.catalog.admin_list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            discipline, kind = _path(data)
            qp = build_query_model(schemas.CatalogEntityListQueryParams, data.get("query"))
            params = schemas.CatalogEntityListParams.from_query_params(qp)
            return paginated_dump(await catalog_service.list(session, discipline, kind, params))

        return await c.envelope(logger, "catalog.admin_list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog.admin_create")
    async def _create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            discipline, kind = _path(data)
            body = schemas.CatalogEntityCreate.model_validate(c.payload(data))
            await record_admin_audit(
                session,
                action=f"{_AUDIT_TYPE}.create",
                actor=c.actor(data),
                data=data,
                workspace_id=None,
                entity_type=_AUDIT_TYPE,
                entity_label=body.name,
                after={"discipline": discipline, "kind": kind, "name": body.name, "slug": body.slug},
            )
            return to_read(await catalog_service.create(session, discipline, kind, body))

        return await c.envelope(logger, "catalog.admin_create", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog.admin_update")
    async def _update(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            discipline, kind = _path(data)
            entity_id = c.require_id(data)
            body = schemas.CatalogEntityUpdate.model_validate(c.payload(data))
            await record_admin_audit(
                session,
                action=f"{_AUDIT_TYPE}.update",
                actor=c.actor(data),
                data=data,
                workspace_id=None,
                entity_type=_AUDIT_TYPE,
                entity_id=entity_id,
                after=body.model_dump(exclude_unset=True),
            )
            return to_read(await catalog_service.update(session, discipline, kind, entity_id, body))

        return await c.envelope(logger, "catalog.admin_update", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog.admin_delete")
    async def _delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            discipline, kind = _path(data)
            entity_id = c.require_id(data)
            await record_admin_audit(
                session,
                action=f"{_AUDIT_TYPE}.delete",
                actor=c.actor(data),
                data=data,
                workspace_id=None,
                entity_type=_AUDIT_TYPE,
                entity_id=entity_id,
            )
            await catalog_service.delete(session, discipline, kind, entity_id)
            return None

        return await c.envelope(logger, "catalog.admin_delete", op, session_factory=_SF)
