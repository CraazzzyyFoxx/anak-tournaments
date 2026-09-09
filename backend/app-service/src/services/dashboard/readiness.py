"""Tournament readiness aggregate for the hub living checklist (D13, §7.1).

Two round-trips of count/exists scalar subqueries over the shared models
(same pattern as ``service.get_counts``) on top of the tournament fetch. Field
groups are masked by the caller's workspace permissions: ``tournament.read``
gates setup/bracket/logs fields, ``team.read`` gates registration/pool/balance/
draft fields — a missing group yields ``None`` so the checklist renders
"no-access" instead of zeros.

``registrations_ranked`` counts SAVED rank data on registration roles
(``BalancerRegistrationRole.rank_value``), never an autofill preview (SK-O12).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import enums
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.balancer.draft import DraftSession
from shared.repository import TournamentRepository
from shared.services.registration_window import registration_open_clause
from src import models
from src.schemas import TournamentReadiness

__all__ = ("ReadinessService", "readiness")


class ReadinessService:
    """The tournament-readiness checklist: two batched scalar-subquery selects
    and the permission-gated assembly over them."""

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
    ) -> TournamentReadiness:
        tournament = await self.get_tournament_or_404(session, tournament_id)

        setup: dict[str, bool | int | None] = {
            "schedule_configured": None,
            "grid_selected": None,
            "stages_total": None,
            "stage_slots_filled": None,
            "bracket_generated": None,
            "encounters_total": None,
            "encounters_with_logs": None,
            "logs_used": None,
        }
        team: dict[str, bool | int | str | None] = {
            "registration_form_configured": None,
            "registration_open": None,
            "registrations_pending": None,
            "registrations_approved": None,
            "registrations_checked_in": None,
            "registrations_ranked": None,
            "pool_ready": None,
            "pool_need_fix": None,
            "balance_saved": None,
            "balance_exported_at": None,
            "draft_session_status": None,
        }

        if can_tournament_read:
            row = await self.setup_row(session, tournament_id)
            n_slots, n_empty = row[2] or 0, row[3] or 0
            with_logs = row[6] or 0
            setup = {
                "schedule_configured": (row[0] or 0) > 0,
                "grid_selected": tournament.division_grid_version_id is not None,
                "stages_total": row[1] or 0,
                "stage_slots_filled": n_slots > 0 and n_empty == 0,
                "bracket_generated": (row[5] or 0) > 0,
                "encounters_total": row[4] or 0,
                "encounters_with_logs": with_logs,
                "logs_used": with_logs > 0,
            }

        if can_team_read:
            row = await self.team_row(session, tournament_id)
            exported_at = row[9]
            team = {
                "registration_form_configured": row[6] is not None,
                "registration_open": bool(row[7]),
                "registrations_pending": row[0] or 0,
                "registrations_approved": row[1] or 0,
                "registrations_checked_in": row[2] or 0,
                "registrations_ranked": row[3] or 0,
                "pool_ready": row[4] or 0,
                "pool_need_fix": row[5] or 0,
                "balance_saved": row[8] is not None,
                "balance_exported_at": (exported_at.isoformat() if exported_at is not None else None),
                "draft_session_status": row[10],
            }

        return TournamentReadiness(
            tournament_id=tournament.id,
            status=tournament.status.value,
            team_formation=tournament.team_formation,
            **setup,  # type: ignore[arg-type]
            **team,  # type: ignore[arg-type]
        )

    async def setup_row(self, session: AsyncSession, tournament_id: int) -> sa.Row:
        """Schedule/grid/stage/bracket/log counters — the ``tournament.read`` group."""
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
        encounters_total = sa.select(sa.func.count(models.Encounter.id)).where(
            models.Encounter.tournament_id == tournament_id
        )
        encounters_bracket = sa.select(sa.func.count(models.Encounter.id)).where(
            models.Encounter.tournament_id == tournament_id,
            models.Encounter.stage_id.is_not(None),
        )
        encounters_with_logs = sa.select(sa.func.count(models.Encounter.id)).where(
            models.Encounter.tournament_id == tournament_id,
            models.Encounter.has_logs.is_(True),
        )
        return (
            await session.execute(
                sa.select(
                    schedule_rows.scalar_subquery(),
                    stages_total.scalar_subquery(),
                    slots_total.scalar_subquery(),
                    slots_empty.scalar_subquery(),
                    encounters_total.scalar_subquery(),
                    encounters_bracket.scalar_subquery(),
                    encounters_with_logs.scalar_subquery(),
                )
            )
        ).one()

    async def team_row(self, session: AsyncSession, tournament_id: int) -> sa.Row:
        """Registration/pool/balance/draft state — the ``team.read`` group.

        Every value rides in one statement: the four questions that used to be
        their own round trips (form row exists, registration window open, saved
        balance, latest draft status) are scalar subqueries here like the
        counters, so this group costs one round trip instead of five.
        """
        reg = models.BalancerRegistration
        active = (reg.tournament_id == tournament_id, reg.deleted_at.is_(None))
        reg_pending = sa.select(sa.func.count(reg.id)).where(*active, reg.status == "pending")
        reg_approved = sa.select(sa.func.count(reg.id)).where(*active, reg.status == "approved")
        reg_checked_in = sa.select(sa.func.count(reg.id)).where(*active, reg.checked_in.is_(True))
        # Saved rank data only (SK-O12): >=1 role row with a stored rank_value.
        role = models.BalancerRegistrationRole
        reg_ranked = sa.select(sa.func.count(sa.distinct(role.registration_id))).where(
            role.rank_value.is_not(None),
            role.registration_id.in_(sa.select(reg.id).where(*active).scalar_subquery()),
        )
        pool_ready = sa.select(sa.func.count(reg.id)).where(*active, reg.balancer_status == "ready")
        pool_need_fix = sa.select(sa.func.count(reg.id)).where(*active, reg.balancer_status == "incomplete")
        # Two DISTINCT questions that used to share one nullable scalar
        # (``form_open is not None`` vs ``bool(form_open)``). Registration
        # openness moved to the phase schedule, so "a form row exists" must be
        # asked separately — otherwise every tournament whose window merely
        # ENDED would report its registration form as unconfigured.
        form_configured = (
            sa.select(sa.literal(1))
            .select_from(models.BalancerRegistrationForm)
            .where(models.BalancerRegistrationForm.tournament_id == tournament_id)
            .limit(1)
        )
        registration_open = sa.select(registration_open_clause()).where(models.Tournament.id == tournament_id)
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
                    registration_open.scalar_subquery(),
                    balance_id.scalar_subquery(),
                    balance_exported_at.scalar_subquery(),
                    draft_status.scalar_subquery(),
                )
            )
        ).one()


readiness = ReadinessService()
