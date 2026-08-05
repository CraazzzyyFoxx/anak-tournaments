"""Superuser admin RPC for the catalog alias-miss queue.

The parser resolves hero/map/gamemode names from the canonical `name` plus the
`aliases` JSONB list; a name that resolves to neither is upserted into
``overwatch.catalog_alias_miss`` with an occurrence counter. This module is the
other end of that pipe: list what is unresolved, attach a raw name to the entity
it meant, or dismiss it.

`attach` is a dedicated subject rather than a `PATCH aliases=[…]` from the
browser for two reasons: appending client-side is a read-modify-write two admins
would race, and attaching an alias must close the matching miss row in the same
transaction.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from faststream.rabbit import RabbitMessage

from shared.catalog_aliases import normalize_aliases
from shared.core import enums
from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.query import build_query_model
from src import models
from src.core import db
from src.schemas.admin import catalog_alias as alias_schemas

from . import _common as c

_SF = db.async_session_maker

# The three catalog tables that carry an `aliases` column, keyed by the enum the
# miss row and the attach payload both use.
_ENTITY_MODELS: dict[enums.CatalogEntityType, Any] = {
    enums.CatalogEntityType.hero: models.Hero,
    enums.CatalogEntityType.map: models.Map,
    enums.CatalogEntityType.gamemode: models.Gamemode,
}


def _gate(data: dict) -> None:
    c.require_superuser(c.actor(data))


async def _list_misses(session: Any, params: alias_schemas.CatalogAliasMissListParams) -> dict:
    miss = models.CatalogAliasMiss
    filters: list[sa.ColumnElement[bool]] = []
    if not params.include_resolved:
        filters.append(miss.resolved_at.is_(None))
    if params.entity_type is not None:
        filters.append(miss.entity_type == params.entity_type)

    total = await session.scalar(sa.select(sa.func.count()).select_from(miss).where(*filters)) or 0
    # LEFT JOIN for the tournament: a log record is only addressable in the admin
    # UI as /admin/tournaments/{id}/matches/logs, so the bare record id is useless
    # on its own. NULL when no record was recorded or the record was since deleted.
    # Ordering is fixed rather than driven by the inherited `sort`/`order`: this is
    # a worklist, so the name costing the most data comes first.
    record = models.LogProcessingRecord
    query = (
        sa.select(miss, record.tournament_id)
        .outerjoin(record, record.id == miss.last_log_record_id)
        .where(*filters)
        .order_by(miss.occurrences.desc(), miss.last_seen_at.desc(), miss.id.desc())
    )
    rows = (await session.execute(params.apply_pagination(query))).all()

    return {
        "results": [
            alias_schemas.CatalogAliasMissRead.model_validate(row, from_attributes=True).model_copy(
                update={"last_log_tournament_id": tournament_id}
            )
            for row, tournament_id in rows
        ],
        "total": total,
        "page": params.page,
        "per_page": params.per_page,
    }


async def _attach_alias(session: Any, data: alias_schemas.CatalogAliasAttach) -> None:
    """Add `alias` to the entity's `aliases` and close the matching miss, atomically."""
    model = _ENTITY_MODELS[data.entity_type]
    obj = await session.get(model, data.entity_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{data.entity_type.value.capitalize()} not found")

    # JSONB does not track in-place mutation: `obj.aliases.append(...)` never
    # reaches the UPDATE. Reassign.
    obj.aliases = normalize_aliases([*obj.aliases, data.alias])

    miss = models.CatalogAliasMiss
    await session.execute(
        sa.update(miss)
        .where(miss.entity_type == data.entity_type, miss.raw_name == data.alias)
        .values(resolved_at=sa.func.now())
    )
    await session.commit()


async def _dismiss_miss(session: Any, miss_id: int) -> None:
    miss = await session.get(models.CatalogAliasMiss, miss_id)
    if miss is None:
        raise HTTPException(status_code=404, detail="Alias miss not found")

    miss.resolved_at = sa.func.now()
    await session.commit()


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.catalog_aliases.misses_list")
    async def _misses_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            qp = build_query_model(alias_schemas.CatalogAliasMissListQueryParams, data.get("query"))
            res = await _list_misses(session, alias_schemas.CatalogAliasMissListParams.from_query_params(qp))
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
            await _attach_alias(session, alias_schemas.CatalogAliasAttach.model_validate(c.payload(data)))
            return None

        return await c.envelope(logger, "catalog_aliases.attach", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog_aliases.dismiss")
    async def _dismiss(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            await _dismiss_miss(session, c.require_id(data))
            return None

        return await c.envelope(logger, "catalog_aliases.dismiss", op, session_factory=_SF)
