"""Config-driven public read engine for app-service reference entities.

achievement get+list are uniform public reads (no auth, no owning workspace), so they run through the shared CRUD
engine with ``public_read=True`` instead of bespoke subscribers. ``service_get``/``list_fn`` delegate to the existing
flows (which own entity-expansion, pagination, search and caching).

Gateway routes set ``data["entity"]`` + ``action`` and hit ``rpc.app.read.get`` / ``rpc.app.read.list`` (see
``src/rpc/reads_generic.py``). The game catalog is not here: ``src/rpc/catalog.py`` serves it natively.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import pagination
from shared.models.achievements.achievement import AchievementRule
from shared.rpc.crud import CrudDispatcher, EntityConfig
from shared.rpc.query import build_query_model
from shared.services.workspace_scope import ALL_WORKSPACES
from src import schemas
from src.core import db
from src.rpc import _common as c
from src.services.achievements.service import achievements as achievement_service


def _entities(data: dict[str, Any]) -> list[str]:
    return c.q(data, "entities") or []


async def _ser(session: AsyncSession, obj: Any) -> Any:
    # service_get hooks return a Pydantic schema (AchievementRead); nulls are part
    # of the response contract, so no ``exclude_none``.
    return obj.model_dump(mode="json")


# --- achievement -------------------------------------------------------------
async def _achievement_get(session: AsyncSession, obj_id: int, data: dict[str, Any]) -> Any:
    # `workspace_id=all` is the catalogue's cross-workspace view, which lists one
    # representative per slug with pooled numbers; the detail has to agree.
    return await achievement_service.get(
        session, obj_id, _entities(data), merge_slugs=c.q_workspace_scope(data) is ALL_WORKSPACES
    )


async def _achievement_list(session: AsyncSession, data: dict[str, Any]) -> Any:
    qp = build_query_model(schemas.AchievementListQueryParams, data.get("query"))
    params = pagination.PaginationSortParams(**qp.model_dump(exclude={"discipline"}))
    result = await achievement_service.get_all(
        session, params, workspace_id=c.q_workspace_id(data), discipline=qp.discipline
    )
    return result.model_dump(mode="json")


REGISTRY: dict[str, EntityConfig] = {
    "achievement": EntityConfig(
        entity="achievement",
        model=AchievementRule,
        permission_resource="achievement",
        serializer=_ser,
        public_read=True,
        service_get=_achievement_get,
        list_fn=_achievement_list,
        not_found_detail="Achievement not found",
        actions=frozenset({"get", "list"}),
    ),
}

dispatcher = CrudDispatcher(REGISTRY, db.async_session_maker)
