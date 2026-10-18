"""Public native catalog reads (P7 §3.2): ``GET /api/v1/catalog/{discipline}/{kind}[/{id}]``.

``AuthNone`` at the gateway: the catalog is global per discipline, so there is no actor and no workspace. Pure
transport: decode, one service call. Mutations stay on the superuser surface in ``rpc/metadata_admin.py``.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core.pagination import paginated_dump
from shared.rpc.query import build_query_model
from src import schemas
from src.core import db
from src.services import catalog as catalog_service

from . import _common as c

_SF = db.async_session_maker


def _path(data: dict) -> tuple[str, str]:
    return str(data.get("discipline") or ""), str(data.get("kind") or "")


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.catalog.list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            discipline, kind = _path(data)
            qp = build_query_model(schemas.CatalogEntityListQueryParams, data.get("query"))
            params = schemas.CatalogEntityListParams.from_query_params(qp)
            return paginated_dump(await catalog_service.list_entities(session, discipline, kind, params))

        return await c.envelope(logger, "catalog.list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog.get")
    async def _get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            discipline, kind = _path(data)
            return await catalog_service.get_entity(session, discipline, kind, c.require_id(data))

        return await c.envelope(logger, "catalog.get", op, session_factory=_SF)
