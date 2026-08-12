"""Tournament readiness aggregate for the hub living checklist (D13, §7.1).

Single round-trip of count/exists scalar subqueries over the shared models
(same pattern as ``service.get_counts``). Field groups are masked by the
caller's workspace permissions: ``tournament.read`` gates setup/bracket/logs
fields, ``team.read`` gates registration/pool/balance/draft fields — a missing
group yields ``None`` so the checklist renders "no-access" instead of zeros.

``registrations_ranked`` counts SAVED rank data on registration roles
(``BalancerRegistrationRole.rank_value``), never an autofill preview (SK-O12).
"""

from __future__ import annotations

import sqlalchemy as sa
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import enums
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.balancer.draft import DraftSession
from src import models


class TournamentReadiness(BaseModel):
    tournament_id: int
    status: str
    team_formation: str
    # visible with tournament.read:
    schedule_configured: bool | None
    grid_selected: bool | None
    stages_total: int | None
    stage_slots_filled: bool | None
    bracket_generated: bool | None
    encounters_total: int | None
    encounters_with_logs: int | None
    logs_used: bool | None
    # visible with team.read (None -> checklist renders no-access):
    registration_form_configured: bool | None
    registration_open: bool | None
    registrations_pending: int | None
    registrations_approved: int | None
    registrations_checked_in: int | None
    registrations_ranked: int | None
    pool_ready: int | None
    pool_need_fix: int | None
    balance_saved: bool | None
    balance_exported_at: str | None
    draft_session_status: str | None


async def get_tournament_or_404(session: AsyncSession, tournament_id: int) -> models.Tournament:
    tournament = await session.scalar(sa.select(models.Tournament).where(models.Tournament.id == tournament_id))
    if tournament is None:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return tournament


async def compute_readiness(
    session: AsyncSession,
    tournament_id: int,
    *,
    can_tournament_read: bool = True,
    can_team_read: bool = True,
) -> TournamentReadiness:
    tournament = await get_tournament_or_404(session, tournament_id)

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
        row = (
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
        row = (
            await session.execute(
                sa.select(
                    reg_pending.scalar_subquery(),
                    reg_approved.scalar_subquery(),
                    reg_checked_in.scalar_subquery(),
                    reg_ranked.scalar_subquery(),
                    pool_ready.scalar_subquery(),
                    pool_need_fix.scalar_subquery(),
                )
            )
        ).one()
        form_open = await session.scalar(
            sa.select(models.BalancerRegistrationForm.is_open).where(
                models.BalancerRegistrationForm.tournament_id == tournament_id
            )
        )
        balance = (
            await session.execute(
                sa.select(models.BalancerBalance.exported_at).where(
                    models.BalancerBalance.tournament_id == tournament_id
                )
            )
        ).one_or_none()
        draft_status = await session.scalar(
            sa.select(DraftSession.status)
            .where(DraftSession.tournament_id == tournament_id)
            .order_by(DraftSession.created_at.desc())
            .limit(1)
        )
        team = {
            "registration_form_configured": form_open is not None,
            "registration_open": bool(form_open),
            "registrations_pending": row[0] or 0,
            "registrations_approved": row[1] or 0,
            "registrations_checked_in": row[2] or 0,
            "registrations_ranked": row[3] or 0,
            "pool_ready": row[4] or 0,
            "pool_need_fix": row[5] or 0,
            "balance_saved": balance is not None,
            "balance_exported_at": (balance[0].isoformat() if balance is not None and balance[0] is not None else None),
            "draft_session_status": draft_status,
        }

    return TournamentReadiness(
        tournament_id=tournament.id,
        status=tournament.status.value,
        team_formation=tournament.team_formation,
        **setup,  # type: ignore[arg-type]
        **team,  # type: ignore[arg-type]
    )
