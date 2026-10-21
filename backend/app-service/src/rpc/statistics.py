"""Bespoke statistics + dashboard reads. The statistics reads are public and workspace-filtered (the player
leaderboards span every game unless one is named); the readiness checklist and the organizer dashboard are
authenticated, gated on workspace read permissions."""

from __future__ import annotations

import typing
from datetime import UTC, datetime
from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core import pagination
from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.query import build_query_model
from src import schemas
from src.core import db
from src.core.workspace import resolve_workspace_context
from src.rpc import _common as c
from src.services.dashboard.overview import DashboardPermissions
from src.services.dashboard.overview import overview as overview_service
from src.services.dashboard.readiness import readiness as readiness_service
from src.services.dashboard.trends import trends as trends_service
from src.services.hero.service import heroes as character_service
from src.services.statistics.service import statistics as statistics_service

_SF = db.async_session_maker
_STAT_SORT = typing.Literal["id", "name", "value"]


def register(broker: Any, logger: Any) -> None:
    # GET /api/v1/statistics/{discipline}/characters/playtime — one game's character playtime shares.
    @broker.subscriber("rpc.app.statistics.character_playtime")
    async def _character_playtime(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            discipline = c.require_discipline(data, in_path=True)
            await c.gate_tournament(session, data, c.q1(data, "tournament_id", int))
            qp = build_query_model(schemas.CharacterPlaytimeQueryPaginationParams, data.get("query"))
            return await character_service.get_playtime(
                session,
                schemas.CharacterPlaytimePaginationParams.from_query_params(qp),
                discipline=discipline,
                workspace_id=c.q1(data, "workspace_id", int),
            )

        return await c.envelope(logger, "statistics.character_playtime", op, session_factory=_SF)

    # GET /api/v1/statistics/{discipline}/characters/{entity_id}/leaderboard — 404 for another game's character.
    @broker.subscriber("rpc.app.statistics.character_leaderboard")
    async def _character_leaderboard(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            discipline = c.require_discipline(data, in_path=True)
            await c.gate_tournament(session, data, c.q1(data, "tournament_id", int))
            ws = await resolve_workspace_context(session, c.q_workspace_scope(data), discipline=discipline)
            qp = build_query_model(schemas.CharacterLeaderboardQueryParams, data.get("query"))
            return await character_service.get_hero_leaderboard(
                session,
                discipline=discipline,
                entity_id=c.require_id(data),
                params=schemas.CharacterLeaderboardParams.from_query_params(qp),
                workspace_id=ws.id,
                grid=ws.grid,
            )

        return await c.envelope(logger, "statistics.character_leaderboard", op, session_factory=_SF)

    # GET /api/v1/admin/tournaments/{id}/readiness — hub living checklist.
    # Gate: ANY(tournament.read, team.read) on the tournament's workspace; the
    # granted groups drive field masking inside compute_readiness.
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

    # GET /api/v1/admin/dashboard — the organizer home of one workspace.
    # Gate: ANY of the five workspace read permissions; each grant unmasks its
    # field group. workspace_id is required even for a superuser (no all-workspaces view).
    @broker.subscriber("rpc.app.statistics.admin_dashboard")
    async def _admin_dashboard(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            workspace_id = c.require_query_int(data, "workspace_id")
            permissions = DashboardPermissions.of(user, workspace_id)
            if not permissions.any_granted:
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied for workspace {workspace_id}: "
                    "tournament.read, team.read, match.read, user.read or achievement.read required",
                )
            return await overview_service.get_dashboard(
                session, workspace_id=workspace_id, permissions=permissions, now=datetime.now(UTC)
            )

        return await c.envelope(logger, "statistics.admin_dashboard", op, session_factory=_SF)

    # GET /api/v1/admin/dashboard/trends — the workspace's last 10 finished public tournaments.
    @broker.subscriber("rpc.app.statistics.admin_dashboard_trends")
    async def _admin_dashboard_trends(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            workspace_id = c.require_query_int(data, "workspace_id")
            if not user.has_workspace_permission(workspace_id, "tournament", "read"):
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied for workspace {workspace_id}: tournament.read required",
                )
            return await trends_service.get_trends(
                session, workspace_id=workspace_id, discipline=c.optional_discipline(data)
            )

        return await c.envelope(logger, "statistics.admin_dashboard_trends", op, session_factory=_SF)

    @broker.subscriber("rpc.app.statistics.champion")
    async def _champion(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            qp = build_query_model(pagination.PaginationSortQueryParams[_STAT_SORT], data.get("query"))
            return await statistics_service.get_most_champions(
                session,
                pagination.PaginationSortParams.from_query_params(qp),
                discipline=c.optional_discipline(data),
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
                discipline=c.optional_discipline(data),
                workspace_id=c.q1(data, "workspace_id", int),
            )

        return await c.envelope(logger, "statistics.winrate", op, session_factory=_SF)

    # GET /api/v1/statistics/players — the almanac players table (titles, tournaments, maps, win rate).
    @broker.subscriber("rpc.app.statistics.players")
    async def _players(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await statistics_service.get_players(
                session,
                build_query_model(schemas.PlayerLeaderboardQueryParams, data.get("query")),
                discipline=c.optional_discipline(data),
                workspace_id=c.q1(data, "workspace_id", int),
            )

        return await c.envelope(logger, "statistics.players", op, session_factory=_SF)

    # GET /api/v1/statistics/records — all-time records; the parsed-log ones only for one game.
    @broker.subscriber("rpc.app.statistics.records")
    async def _records(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await statistics_service.get_records(
                session, discipline=c.optional_discipline(data), workspace_id=c.q1(data, "workspace_id", int)
            )

        return await c.envelope(logger, "statistics.records", op, session_factory=_SF)

    # GET /api/v1/statistics/{discipline}/maps — one game's maps by mode.
    @broker.subscriber("rpc.app.statistics.maps")
    async def _maps(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await statistics_service.get_maps(
                session,
                discipline=c.require_discipline(data, in_path=True),
                workspace_id=c.q1(data, "workspace_id", int),
            )

        return await c.envelope(logger, "statistics.maps", op, session_factory=_SF)
