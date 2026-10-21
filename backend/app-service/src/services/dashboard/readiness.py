"""Tournament readiness aggregate for the hub living checklist.

Up to three round-trips of count/exists scalar subqueries over the shared
models on top of the tournament fetch. Field groups are masked by the caller's
workspace permissions: ``tournament.read`` gates setup/bracket/logs/recalc
fields, ``team.read`` gates registration/pool/balance/draft fields,
``match.read`` gates the result backlog and ``achievement.read`` the
evaluation status — a missing group yields ``None`` so the checklist renders
"no-access" instead of zeros. ``match.read`` and ``achievement.read`` share one
round trip, masked per group after it.

``registrations_ranked`` counts SAVED rank data on registration roles
(``RegistrationRole.rank_value``), never an autofill preview.

The module-level builders take a column or a literal: the dashboard correlates
them on ``Tournament``, the checklist binds one tournament.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import enums
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.draft import DraftSession
from shared.repository import TournamentRepository
from src.schemas import TournamentReadiness

__all__ = (
    "ReadinessService",
    "has_enabled_achievement_rules",
    "latest_evaluation_run_status",
    "readiness",
    "standings_recalc_pending",
)


def latest_evaluation_run_status(tournament_id: sa.SQLColumnExpression[int] | int) -> sa.ScalarSelect[Any]:
    """Status of the tournament's newest achievement evaluation run; ``NULL`` when it never ran."""
    run = models.EvaluationRun
    return (
        sa.select(run.status)
        .where(run.tournament_id == tournament_id)
        .order_by(run.created_at.desc())
        .limit(1)
        .scalar_subquery()
    )


def has_enabled_achievement_rules(
    workspace_id: sa.SQLColumnExpression[int] | int, discipline: sa.SQLColumnExpression[str] | str
) -> sa.Exists:
    """The engine evaluates one game's enabled rules at a time, so "nothing to evaluate" is per discipline."""
    rule = models.AchievementRule
    return sa.exists().where(rule.workspace_id == workspace_id, rule.discipline == discipline, rule.enabled.is_(True))


def standings_recalc_pending(tournament_id: sa.SQLColumnExpression[int] | int) -> sa.Exists:
    """A standings recalculation was requested and has not completed yet."""
    state = models.TournamentRecalculationState
    return sa.exists().where(
        state.tournament_id == tournament_id, state.requested_generation > state.completed_generation
    )


class ReadinessService:
    """The tournament-readiness checklist: batched scalar-subquery selects, one
    per granted permission group, and the permission-gated assembly over them."""

    def __init__(self, *, tournaments: TournamentRepository = TournamentRepository()) -> None:
        self.tournaments = tournaments

    async def get_tournament_or_404(self, session: AsyncSession, tournament_id: int) -> models.Tournament:
        tournament = await self.tournaments.get(session, tournament_id)
        if tournament is None:
            raise HTTPException(status_code=404, detail="Tournament not found")
        return tournament

    async def compute_readiness(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        can_tournament_read: bool = True,
        can_team_read: bool = True,
        can_match_read: bool = True,
        can_achievement_read: bool = True,
    ) -> TournamentReadiness:
        tournament = await self.get_tournament_or_404(session, tournament_id)

        # Every field starts masked; each granted group fills its own.
        fields: dict[str, Any] = dict.fromkeys(TournamentReadiness.model_fields)
        fields.update(
            tournament_id=tournament.id,
            status=tournament.status.value,
            team_formation=tournament.team_formation,
        )

        if can_tournament_read:
            row = await self.setup_row(session, tournament_id)
            n_slots, n_empty = row[2] or 0, row[3] or 0
            duels_with_logs = row[6] or 0
            fields.update(
                schedule_configured=(row[0] or 0) > 0,
                grid_selected=tournament.division_grid_version_id is not None,
                stages_total=row[1] or 0,
                stage_slots_filled=n_slots > 0 and n_empty == 0,
                bracket_generated=(row[4] or 0) > 0,
                duel_encounters_total=row[5] or 0,
                duel_encounters_with_logs=duels_with_logs,
                logs_used=duels_with_logs > 0,
                standings_recalc_pending=bool(row[7]),
            )

        if can_team_read:
            row = await self.team_row(session, tournament_id)
            exported_at = row[8]
            fields.update(
                registration_form_configured=row[6] is not None,
                registrations_pending=row[0] or 0,
                registrations_approved=row[1] or 0,
                registrations_checked_in=row[2] or 0,
                registrations_ranked=row[3] or 0,
                pool_ready=row[4] or 0,
                pool_need_fix=row[5] or 0,
                balance_saved=row[7] is not None,
                balance_exported_at=exported_at.isoformat() if exported_at is not None else None,
                draft_session_status=row[9],
            )

        if can_match_read or can_achievement_read:
            row = await self.results_row(session, tournament)
            if can_match_read:
                fields.update(
                    results_overdue=row[0] or 0,
                    results_pending_confirmation=row[1] or 0,
                    results_disputed=row[2] or 0,
                )
            if can_achievement_read:
                fields["achievements_status"] = (row[4] or "none") if row[3] else "not_configured"

        return TournamentReadiness(**fields)

    async def setup_row(self, session: AsyncSession, tournament_id: int) -> sa.Row:
        """Schedule/grid/stage/bracket/log/recalc state — the ``tournament.read`` group."""
        schedule_rows = sa.select(sa.func.count(models.TournamentPhaseSchedule.id)).where(
            models.TournamentPhaseSchedule.tournament_id == tournament_id
        )
        stages_total = sa.select(sa.func.count(models.Stage.id)).where(models.Stage.tournament_id == tournament_id)
        slots = (
            sa.select(models.StageItemInput.id, models.StageItemInput.input_type)
            .join(models.StageItem, models.StageItem.id == models.StageItemInput.stage_item_id)
            .join(models.Stage, models.Stage.id == models.StageItem.stage_id)
            .where(models.Stage.tournament_id == tournament_id)
            .subquery()
        )
        slots_total = sa.select(sa.func.count(slots.c.id))
        slots_empty = sa.select(sa.func.count(slots.c.id)).where(slots.c.input_type == enums.StageItemInputType.EMPTY)
        encounters_bracket = (
            sa.select(sa.func.count(models.Encounter.id))
            .join(models.BracketEncounter, models.BracketEncounter.encounter_id == models.Encounter.id)
            .where(models.Encounter.tournament_id == tournament_id, models.BracketEncounter.stage_id.is_not(None))
        )
        # A lobby never produces a match log: only duels count toward log coverage.
        duels = sa.select(sa.func.count(models.Encounter.id)).where(
            models.Encounter.tournament_id == tournament_id, models.Encounter.slot_count == 2
        )
        duels_with_logs = duels.where(models.Encounter.has_logs.is_(True))
        return (
            await session.execute(
                sa.select(
                    schedule_rows.scalar_subquery(),
                    stages_total.scalar_subquery(),
                    slots_total.scalar_subquery(),
                    slots_empty.scalar_subquery(),
                    encounters_bracket.scalar_subquery(),
                    duels.scalar_subquery(),
                    duels_with_logs.scalar_subquery(),
                    standings_recalc_pending(tournament_id),
                )
            )
        ).one()

    async def team_row(self, session: AsyncSession, tournament_id: int) -> sa.Row:
        """Registration/pool/balance/draft state — the ``team.read`` group.

        Every value rides in one statement: form row exists, saved balance and
        latest draft status are scalar subqueries here like the counters, so
        this group costs one round trip.
        """
        reg = models.Registration
        active = (reg.tournament_id == tournament_id, reg.deleted_at.is_(None))
        reg_pending = sa.select(sa.func.count(reg.id)).where(*active, reg.status == "pending")
        reg_approved = sa.select(sa.func.count(reg.id)).where(*active, reg.status == "approved")
        reg_checked_in = sa.select(sa.func.count(reg.id)).where(*active, reg.checked_in.is_(True))
        # Saved rank data only: >=1 role row with a stored rank_value.
        role = models.RegistrationRole
        reg_ranked = sa.select(sa.func.count(sa.distinct(role.registration_id))).where(
            role.rank_value.is_not(None),
            role.registration_id.in_(sa.select(reg.id).where(*active).scalar_subquery()),
        )
        pool_ready = sa.select(sa.func.count(reg.id)).where(*active, reg.balancer_status == "ready")
        pool_need_fix = sa.select(sa.func.count(reg.id)).where(*active, reg.balancer_status == "incomplete")
        # "A form row exists", not "registration is open": openness is the phase
        # schedule's window, and a tournament whose window merely ENDED still has
        # its form configured.
        form_configured = (
            sa.select(sa.literal(1))
            .select_from(models.RegistrationForm)
            .where(models.RegistrationForm.tournament_id == tournament_id)
            .limit(1)
        )
        # Existence and value are separate probes: ``exported_at`` is nullable, so
        # a single scalar subquery could not tell "no balance saved" apart from
        # "saved but never exported".
        balance_id = (
            sa.select(models.BalancerBalance.id).where(models.BalancerBalance.tournament_id == tournament_id).limit(1)
        )
        balance_exported_at = (
            sa.select(models.BalancerBalance.exported_at)
            .where(models.BalancerBalance.tournament_id == tournament_id)
            .limit(1)
        )
        draft_status = (
            sa.select(DraftSession.status)
            .where(DraftSession.tournament_id == tournament_id)
            .order_by(DraftSession.created_at.desc())
            .limit(1)
        )
        return (
            await session.execute(
                sa.select(
                    reg_pending.scalar_subquery(),
                    reg_approved.scalar_subquery(),
                    reg_checked_in.scalar_subquery(),
                    reg_ranked.scalar_subquery(),
                    pool_ready.scalar_subquery(),
                    pool_need_fix.scalar_subquery(),
                    form_configured.scalar_subquery(),
                    balance_id.scalar_subquery(),
                    balance_exported_at.scalar_subquery(),
                    draft_status.scalar_subquery(),
                )
            )
        ).one()

    async def results_row(self, session: AsyncSession, tournament: models.Tournament) -> sa.Row:
        """Result backlog and achievement evaluation — the ``match.read`` and
        ``achievement.read`` groups, in one statement the caller masks per group."""
        encounter = models.Encounter
        results = sa.select(sa.func.count(encounter.id)).where(encounter.tournament_id == tournament.id)
        # The dashboard's "overdue": no result for a past slot of an unfinished match.
        overdue = results.where(
            encounter.result_status == enums.EncounterResultStatus.NONE,
            encounter.scheduled_at < datetime.now(UTC),
            encounter.status != enums.EncounterStatus.COMPLETED,
        )
        pending = results.where(encounter.result_status == enums.EncounterResultStatus.PENDING_CONFIRMATION)
        disputed = results.where(encounter.result_status == enums.EncounterResultStatus.DISPUTED)
        return (
            await session.execute(
                sa.select(
                    overdue.scalar_subquery(),
                    pending.scalar_subquery(),
                    disputed.scalar_subquery(),
                    has_enabled_achievement_rules(tournament.workspace_id, tournament.discipline),
                    latest_evaluation_run_status(tournament.id),
                )
            )
        ).one()


readiness = ReadinessService()
