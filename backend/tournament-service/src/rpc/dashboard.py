"""Organizer dashboard reads: the tournament readiness checklist, the workspace dashboard and its trends.

Authenticated, gated on workspace read permissions; each grant unmasks its field group.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from faststream.rabbit.annotations import RabbitMessage

from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.common import require_active, require_query_int
from src.rpc._helpers import _dump, _identity, _optional_discipline, _require_id, _run
from src.services.dashboard.overview import DashboardPermissions
from src.services.dashboard.overview import overview as overview_service
from src.services.dashboard.readiness import readiness as readiness_service
from src.services.dashboard.trends import trends as trends_service


def register(broker: Any, logger: Any) -> None:
    # GET /api/v1/admin/tournaments/{id}/readiness — hub living checklist.
    # Gate: ANY(tournament.read, team.read) on the tournament's workspace; the
    # granted groups (also match.read, achievement.read) drive field masking
    # inside compute_readiness.
    # Deliberately NO hidden-tournament gate: a workspace reader may see hidden
    # tournaments of their own workspace (same disposition as balancer admin RPCs).
    @broker.subscriber("rpc.tournament.tournament_readiness")
    async def _tournament_readiness(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            require_active(user)
            tournament_id = _require_id(data)
            tournament = await readiness_service.get_tournament_or_404(session, tournament_id)
            ws = tournament.workspace_id
            can_tournament_read = user.has_workspace_permission(ws, "tournament", "read")
            can_team_read = user.has_workspace_permission(ws, "team", "read")
            if not (can_tournament_read or can_team_read):
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied for workspace {ws}: tournament.read or team.read required",
                )
            return _dump(
                await readiness_service.compute_readiness(
                    session,
                    tournament_id,
                    can_tournament_read=can_tournament_read,
                    can_team_read=can_team_read,
                    can_match_read=user.has_workspace_permission(ws, "match", "read"),
                    can_achievement_read=user.has_workspace_permission(ws, "achievement", "read"),
                )
            )

        return await _run(logger, op)

    # GET /api/v1/admin/dashboard — the organizer home of one workspace.
    # Gate: ANY of the five workspace read permissions; each grant unmasks its
    # field group. workspace_id is required even for a superuser (no all-workspaces view).
    @broker.subscriber("rpc.tournament.admin_dashboard")
    async def _admin_dashboard(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            require_active(user)
            workspace_id = require_query_int(data, "workspace_id")
            permissions = DashboardPermissions.of(user, workspace_id)
            if not permissions.any_granted:
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied for workspace {workspace_id}: "
                    "tournament.read, team.read, match.read, user.read or achievement.read required",
                )
            return _dump(
                await overview_service.get_dashboard(
                    session, workspace_id=workspace_id, permissions=permissions, now=datetime.now(UTC)
                )
            )

        return await _run(logger, op)

    # GET /api/v1/admin/dashboard/trends — the workspace's last 10 finished public tournaments.
    @broker.subscriber("rpc.tournament.admin_dashboard_trends")
    async def _admin_dashboard_trends(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            require_active(user)
            workspace_id = require_query_int(data, "workspace_id")
            if not user.has_workspace_permission(workspace_id, "tournament", "read"):
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied for workspace {workspace_id}: tournament.read required",
                )
            return _dump(
                await trends_service.get_trends(
                    session, workspace_id=workspace_id, discipline=_optional_discipline(data)
                )
            )

        return await _run(logger, op)
