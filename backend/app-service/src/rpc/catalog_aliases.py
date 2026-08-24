"""Superuser admin RPC for the catalog alias-miss queue.

Pure transport: gate, decode, one service call. The worklist query, the alias
attach and the dismiss all live on ``services.admin.catalog_aliases``, which
also owns the transaction — attaching an alias closes the matching miss row in
the same commit.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.rpc.query import build_query_model
from src import schemas
from src.core import db
from src.services.admin.catalog_aliases import catalog_aliases as alias_service

from . import _common as c

_SF = db.async_session_maker


def _gate(data: dict) -> None:
    c.require_superuser(c.actor(data))


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.catalog_aliases.misses_list")
    async def _misses_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            qp = build_query_model(schemas.CatalogAliasMissListQueryParams, data.get("query"))
            params = schemas.CatalogAliasMissListParams.from_query_params(qp)
            res = await alias_service.list_misses(session, params)
            return {
                "results": [r.model_dump(mode="json") for r in res["results"]],
                "total": res["total"],
                "page": res["page"],
                "per_page": res["per_page"],
            }

        return await c.envelope(logger, "catalog_aliases.misses_list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog_aliases.attach")
    async def _attach(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            await alias_service.attach(session, schemas.CatalogAliasAttach.model_validate(c.payload(data)))
            return None

        return await c.envelope(logger, "catalog_aliases.attach", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog_aliases.dismiss")
    async def _dismiss(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            await alias_service.dismiss(session, c.require_id(data))
            return None

        return await c.envelope(logger, "catalog_aliases.dismiss", op, session_factory=_SF)
