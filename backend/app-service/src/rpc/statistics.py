"""Bespoke statistics + dashboard reads (all public, workspace-filtered)."""

from __future__ import annotations

import typing
from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.query import build_query_model
from src.core import db, pagination
from src.rpc import _common as c
from src.services.dashboard.readiness import readiness as readiness_service
from src.services.dashboard.service import dashboard as dashboard_service
from src.services.statistics.service import statistics as statistics_service

_SF = db.async_session_maker
_STAT_SORT = typing.Literal["id", "name", "value"]


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.statistics.dashboard")
    async def _dashboard(data: dict, msg: RabbitMessage) -> dict:
        # ``get_dashboard_stats`` opens its own three sessions for the parallel
        # fan-out (AsyncSession is not concurrency-safe), so the envelope's
        # session is deliberately unused here.
        async def op(_session: Any) -> Any:
            return await dashboard_service.get_dashboard_stats(workspace_id=c.q1(data, "workspace_id", int))

        return await c.envelope(logger, "statistics.dashboard", op, session_factory=_SF)

    # GET /api/v1/admin/tournaments/{id}/readiness — hub living checklist (D13, §7.1).
    # Gate: ANY(tournament.read, team.read) on the tournament's workspace; the
    # granted groups drive field masking inside compute_readiness (G-O1/D16).
    # Deliberately NO hidden-tournament gate: a workspace reader may see hidden
    # tournaments of their own workspace (same disposition as balancer admin RPCs).
    @broker.subscriber("rpc.app.statistics.tournament_readiness")
    async def _tournament_readiness(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            tournament_id = c.require_id(data)
            tournament = await readiness_service.get_tournament_or_404(session, tournament_id)
            can_tournament_read = user.has_workspace_permission(tournament.workspace_id, "tournament", "read")
            can_team_read = user.has_workspace_permission(tournament.workspace_id, "team", "read")
            if not (can_tournament_read or can_team_read):
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied for workspace {tournament.workspace_id}: "
                    "tournament.read or team.read required",
                )
            return await readiness_service.compute_readiness(
                session,
                tournament_id,
                can_tournament_read=can_tournament_read,
                can_team_read=can_team_read,
            )

        return await c.envelope(logger, "statistics.tournament_readiness", op, session_factory=_SF)

    @broker.subscriber("rpc.app.statistics.champion")
    async def _champion(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            qp = build_query_model(pagination.PaginationSortQueryParams[_STAT_SORT], data.get("query"))
            return await statistics_service.get_most_champions(
                session,
                pagination.PaginationSortParams.from_query_params(qp),
                workspace_id=c.q1(data, "workspace_id", int),
            )

        return await c.envelope(logger, "statistics.champion", op, session_factory=_SF)

    @broker.subscriber("rpc.app.statistics.winrate")
    async def _winrate(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            qp = build_query_model(pagination.PaginationSortQueryParams[_STAT_SORT], data.get("query"))
            return await statistics_service.get_to_winrate_players(
                session,
                pagination.PaginationSortParams.from_query_params(qp),
                workspace_id=c.q1(data, "workspace_id", int),
            )

        return await c.envelope(logger, "statistics.winrate", op, session_factory=_SF)

    @broker.subscriber("rpc.app.statistics.won_maps")
    async def _won_maps(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            qp = build_query_model(pagination.PaginationSortQueryParams[_STAT_SORT], data.get("query"))
            return await statistics_service.get_to_won_players(
                session,
                pagination.PaginationSortParams.from_query_params(qp),
                workspace_id=c.q1(data, "workspace_id", int),
            )

        return await c.envelope(logger, "statistics.won_maps", op, session_factory=_SF)
