"""One orchestrator for every path that materializes tournament teams.

Three call sites need the same destructive, order-sensitive sequence:

    guard -> cleanup prior export -> insert teams+players -> backfill links
          -> stamp the source row (+ maybe emit an event) -> ONE commit

Before this module, ``admin/balancer.py::export_balance`` and
``draft/export.py::export`` each carried their own copy of it, and a third copy
was about to be added for registered teams. The sequence now lives here once and
each caller supplies only what actually differs: the team list, the prior-export
ids to clean, and callbacks to unlink/stamp its own row.

Transaction ownership
---------------------
The writer used to commit internally, which produced a genuinely broken failure
path: ``export_balance`` deletes the previous ``Standing``/``Player``/``Team``
rows *without* an intervening commit, and its ``except`` branch stamped
``export_status='failed'`` and committed — flushing those pending DELETEs. A
failed re-export therefore left the tournament with its old teams gone and no
replacements.

So the commit moved here, and failure is explicitly **two transactions**: roll
back the data work first (the deletes and partial inserts vanish), then stamp the
failure in a fresh, short transaction. Rolling back alone would lose the operator
diagnostics; committing alone destroys data.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import ApiExc, ApiHTTPException
from shared.models.tournament.standings import Standing
from shared.models.tournament.team import Player, Team
from shared.services.team_export.materialization import (
    MaterializationResult,
    MaterializationTeam,
    OnUnresolved,
    materialize_teams,
)

__all__ = ("ExportOutcome", "ExportPlan", "TeamMaterializationService", "team_materialization")

logger = logging.getLogger(__name__)

#: Called after the prior export's rows are deleted, to clear the source rows'
#: ``exported_team_id`` back-links. Synchronous: it only mutates loaded ORM objects.
UnlinkHook = Callable[[], None]
#: Called with the materialized teams keyed by ``balancer_name`` — writes the
#: back-links and stamps the source row, and may enqueue that path's event.
FinalizeHook = Callable[[AsyncSession, Mapping[str, Team]], Awaitable[None]]
#: Called after rollback, in a fresh transaction, to record the failure.
FailureHook = Callable[[AsyncSession, BaseException], Awaitable[None]]


@dataclass
class ExportPlan:
    """What one materialization path contributes to the shared sequence."""

    tournament_id: int
    teams: Sequence[MaterializationTeam]
    prior_team_ids: Sequence[int] = ()
    on_unresolved: OnUnresolved = "skip"
    #: Refuse to run when standings exist for teams this export does not own.
    #: Off for the balancer/draft paths, which have always re-exported
    #: destructively; on for registered teams, where re-export after a bracket
    #: exists would silently invalidate it.
    guard_standings: bool = False
    unlink: UnlinkHook | None = None
    finalize: FinalizeHook | None = None
    on_failure: FailureHook | None = None


@dataclass
class ExportOutcome:
    removed_teams: int = 0
    imported_teams: int = 0
    materialization: MaterializationResult = field(default_factory=MaterializationResult)


class TeamMaterializationService:
    """Runs an :class:`ExportPlan`. Owns the transaction boundary."""

    async def run(self, session: AsyncSession, plan: ExportPlan) -> ExportOutcome:
        try:
            outcome = await self._run(session, plan)
            await session.commit()
            return outcome
        except BaseException as exc:
            # Discard the destructive work: without this rollback the pending
            # DELETEs would be committed by the failure stamp below.
            await session.rollback()
            if plan.on_failure is not None:
                try:
                    await plan.on_failure(session, exc)
                    await session.commit()
                except Exception:  # pragma: no cover - diagnostics must not mask the cause
                    logger.exception("team export failure hook failed for tournament %s", plan.tournament_id)
                    await session.rollback()
            raise

    async def _run(self, session: AsyncSession, plan: ExportPlan) -> ExportOutcome:
        prior_ids = list(plan.prior_team_ids)

        if plan.guard_standings:
            await self._assert_no_foreign_standings(session, plan.tournament_id, prior_ids)

        if prior_ids:
            await session.execute(sa.delete(Standing).where(Standing.team_id.in_(prior_ids)))
            await session.execute(sa.delete(Player).where(Player.team_id.in_(prior_ids)))
            await session.execute(sa.delete(Team).where(Team.id.in_(prior_ids)))
            if plan.unlink is not None:
                plan.unlink()
            await session.flush()

        materialization = await materialize_teams(
            session,
            plan.tournament_id,
            plan.teams,
            on_unresolved=plan.on_unresolved,
        )

        # Re-queried rather than taken from ``materialization.created_teams``: a
        # team reused by name keeps whatever ``balancer_name`` it already had, and
        # both existing callers have always linked back only what this query
        # matches. Narrowing that is a behaviour change, not a cleanup.
        by_name: Mapping[str, Team] = {}
        names = [team.balancer_name for team in plan.teams]
        if names:
            rows = (
                await session.scalars(
                    sa.select(Team).where(
                        Team.tournament_id == plan.tournament_id,
                        Team.balancer_name.in_(names),
                    )
                )
            ).all()
            by_name = {team.balancer_name: team for team in rows}

        if plan.finalize is not None:
            await plan.finalize(session, by_name)

        return ExportOutcome(
            removed_teams=len(prior_ids),
            imported_teams=len(plan.teams),
            materialization=materialization,
        )

    @staticmethod
    async def _assert_no_foreign_standings(
        session: AsyncSession,
        tournament_id: int,
        prior_team_ids: Sequence[int],
    ) -> None:
        """Refuse when standings exist for teams this export will not replace.

        Re-export is destructive-then-idempotent, not diffed, so a bracket built
        on teams outside ``prior_team_ids`` would be silently invalidated.
        """
        query = (
            sa.select(sa.literal(1))
            .select_from(Standing)
            .join(Team, Team.id == Standing.team_id)
            .where(Team.tournament_id == tournament_id)
            .limit(1)
        )
        if prior_team_ids:
            query = query.where(Standing.team_id.notin_(list(prior_team_ids)))
        if await session.scalar(query) is not None:
            raise ApiHTTPException(
                status_code=409,
                detail=[
                    ApiExc(
                        code="standings_exist",
                        msg=(
                            "Standings already exist for this tournament; re-exporting teams "
                            "would invalidate them. Remove the standings first."
                        ),
                    )
                ],
            )


#: Module-level singleton — the service is stateless.
team_materialization = TeamMaterializationService()
