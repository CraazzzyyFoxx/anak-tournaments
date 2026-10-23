"""Public achievement reads (``rpc.stats.achievements.*``): the catalogue list and one rule, its earners, and one
user's earned/locked achievements. The rule admin and the engine are ``rpc.stats.ach.*`` (``achievements.py``)."""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core import errors, pagination
from shared.rpc.query import build_query_model
from shared.services.workspace_scope import ALL_WORKSPACES
from src import schemas
from src.core import db
from src.rpc import _common as c
from src.services.achievement_reads.service import achievements as achievement_service

_SF = db.async_session_maker


def register(broker: Any, logger: Any, *, channel: Any) -> None:
    @broker.subscriber("rpc.stats.achievements.list", channel=channel)
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            qp = build_query_model(schemas.AchievementListQueryParams, data.get("query"))
            params = pagination.PaginationSortParams(**qp.model_dump(exclude={"discipline"}))
            return await achievement_service.get_all(
                session, params, workspace_id=c.q_workspace_id(data), discipline=qp.discipline
            )

        return await c.envelope(logger, "achievements.list", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.achievements.get", channel=channel)
    async def _get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            # `workspace_id=all` is the catalogue's cross-workspace view, which lists one
            # representative per slug with pooled numbers; the detail has to agree.
            return await achievement_service.get(
                session,
                c.require_id(data),
                c.q(data, "entities") or [],
                merge_slugs=c.q_workspace_scope(data) is ALL_WORKSPACES,
            )

        return await c.envelope(logger, "achievements.get", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.achievements.users", channel=channel)
    async def _users(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            qp = build_query_model(pagination.PaginationQueryParams, data.get("query"))
            return await achievement_service.get_achievement_users(
                session,
                c.require_id(data),
                pagination.PaginationParams.from_query_params(qp),
                merge_slugs=c.q_workspace_scope(data) is ALL_WORKSPACES,
            )

        return await c.envelope(logger, "achievements.users", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.achievements.user", channel=channel)
    async def _user(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            tournament_id = c.q1(data, "tournament_id", int)
            without_tournament = c.q1(data, "without_tournament", c.qbool, False)
            if tournament_id is not None and without_tournament:
                raise errors.ApiHTTPException(
                    status_code=400,
                    detail=[
                        errors.ApiExc(
                            code="invalid_request",
                            msg="Use either tournament_id or without_tournament=true, not both.",
                        )
                    ],
                )
            await c.gate_tournament(session, data, tournament_id)
            # Optional: a profile reads one game's rules (earned AND locked); absent or "all" keeps every game (admin
            # hub). A code no module declares is 404 `discipline_not_installed`, never an empty list.
            discipline = c.optional_discipline(data)
            return await achievement_service.get_user_achievements(
                session,
                c.require_id(data),
                c.q(data, "entities") or [],
                tournament_id=tournament_id,
                without_tournament=without_tournament,
                workspace_id=c.q_workspace_id(data),
                include_locked=c.q1(data, "include_locked", c.qbool, False),
                discipline=discipline,
            )

        return await c.envelope(logger, "achievements.user", op, session_factory=_SF)
