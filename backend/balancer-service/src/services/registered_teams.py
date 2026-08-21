"""Materialize pre-formed registered teams into ``tournament.team``.

The third caller of the shared materialization orchestrator, alongside
``admin/balancer.py`` (balance export) and ``draft/export.py`` (draft export). It
lives in balancer-service for the same reason they do: that service is the single
writer of ``tournament.team``/``tournament.player``, and decision 15 kept it that
way rather than opening a second write path in tournament-service.

Two settings differ from the other two callers, both deliberately:

* ``guard_standings=True``. The balancer and draft exports have always re-exported
  destructively, and their operators expect that. A registered-team re-export after
  a bracket exists would silently invalidate it, so it refuses instead.
* ``on_unresolved="error"``. Registered members arrive with
  ``workspace_member_id`` already set, so a failure to resolve one is a bug rather
  than a data-quality fact. ``"skip"`` would produce an under-sized roster with no
  error anywhere — the exact failure the shared writer's docstring warns about.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import ApiExc, ApiHTTPException
from shared.domain.roster_shape import resolve_roster_shape
from shared.repository import BalancerRegistrationTeamRepository, TournamentRepository
from shared.services.roster_shape_access import get_tournament_roster_slots, get_workspace_roster_slots
from shared.services.team_export import ExportPlan, team_materialization
from shared.services.team_export.registered import SkippedTeam, build_registered_export
from src import models

__all__ = ("RegisteredExportResult", "RegisteredTeamsService", "registered_teams_service")

logger = logging.getLogger(__name__)


@dataclass
class RegisteredExportResult:
    removed_teams: int = 0
    imported_teams: int = 0
    created_players: int = 0
    skipped: list[SkippedTeam] = field(default_factory=list)


def _err(code: str, msg: str, status_code: int = 400) -> ApiHTTPException:
    return ApiHTTPException(status_code=status_code, detail=[ApiExc(msg=msg, code=code)])


class RegisteredTeamsService:
    def __init__(
        self,
        *,
        tournaments: TournamentRepository = TournamentRepository(),
        registration_teams: BalancerRegistrationTeamRepository = BalancerRegistrationTeamRepository(),
    ) -> None:
        self.tournaments = tournaments
        self.registration_teams = registration_teams

    async def export_registered(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        team_ids: Sequence[int] | None = None,
    ) -> RegisteredExportResult:
        """Export this tournament's complete registered teams. Commits (via the
        orchestrator) or rolls back as one unit.

        Nothing to export is a **success with an empty result**, not an error: an
        organizer clicking export before any team completed should be told which teams
        are incomplete, which is exactly what ``skipped`` carries.
        """
        tournament = await self.tournaments.get(session, tournament_id)
        if tournament is None:
            raise _err("not_found", f"Tournament {tournament_id} not found", status_code=404)

        tournament_slots = await get_tournament_roster_slots(session, tournament_id)
        workspace_slots = await get_workspace_roster_slots(session, tournament.workspace_id)
        shape = resolve_roster_shape(tournament_slots, workspace_slots)

        payload = await build_registered_export(session, tournament_id, shape, team_ids=team_ids)
        if not payload.teams:
            # No transaction at all: there is nothing to delete and nothing to write,
            # so running the orchestrator would only take the standings guard for no
            # reason.
            return RegisteredExportResult(skipped=payload.skipped)

        source_teams = payload.source_teams

        def _unlink() -> None:
            for team in source_teams:
                team.exported_team_id = None

        async def _finalize(inner: AsyncSession, by_name: Mapping[str, models.Team]) -> None:
            stamped = datetime.now(UTC)
            for source, mapped in zip(source_teams, payload.teams, strict=True):
                public_team = by_name.get(mapped.balancer_name)
                if public_team is not None:
                    source.exported_team_id = public_team.id
                source.exported_at = stamped
                source.export_status = "success"
                source.export_error = None

        async def _on_failure(inner: AsyncSession, exc: BaseException) -> None:
            # Fresh reads: the rollback detached everything the failed attempt loaded.
            # Row-by-row rather than one bulk UPDATE, matching ``draft/export.py``'s
            # failure hook — the count is tens of teams on an error path.
            for source in source_teams:
                fresh = await self.registration_teams.get(inner, source.id)
                if fresh is not None:
                    fresh.export_status = "failed"
                    fresh.export_error = str(exc)[:500]

        outcome = await team_materialization.run(
            session,
            ExportPlan(
                tournament_id=tournament_id,
                teams=payload.teams,
                prior_team_ids=payload.prior_team_ids,
                on_unresolved="error",
                guard_standings=True,
                unlink=_unlink,
                finalize=_finalize,
                on_failure=_on_failure,
            ),
        )
        return RegisteredExportResult(
            removed_teams=outcome.removed_teams,
            imported_teams=outcome.imported_teams,
            created_players=outcome.materialization.created_players,
            skipped=payload.skipped,
        )


registered_teams_service = RegisteredTeamsService()
