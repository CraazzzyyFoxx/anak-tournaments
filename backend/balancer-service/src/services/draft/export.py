"""Export a completed draft to tournament teams/players.

Synthesizes a ``BalancerTeam`` payload from the final rosters and hands it to the
shared team-materialization orchestrator, which owns the destructive cleanup, the
``exported_team_id`` backfill and the transaction boundary — the same sequence
``export_balance`` runs.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import DraftPickStatus, DraftPlayerStatus, DraftStatus
from shared.domain.roster_shape import FLEX_SLOT_CODE, RosterShape
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftSession, DraftTeam
from shared.services.team_export import ExportPlan, team_materialization
from src import models
from src.schemas.team import BalancerTeam, BalancerTeamMember
from src.services.draft import feasibility, loaders, ranks
from src.services.draft._errors import err as _err
from src.services.team import to_materialization_teams


def _draft_to_balancer_payload(
    teams: list[DraftTeam],
    roster_by_team: dict[int, list[DraftPlayer]],
    shape: RosterShape,
    pick_by_player_id: dict[int, DraftPick] | None = None,
) -> list[BalancerTeam]:
    """Pure mapping: draft rosters -> balancer export payload.

    The team name is the captain's battle_tag/name so the export's
    ``find_users_by_battle_tags`` resolves the captain; members carry their
    battle_tag, the slot they were *drafted into* (tank/dps/support), and the
    rank ``shape`` gives them on it. Mirrors the balancer's own payload
    (assigned role + assigned rating) so both feed
    ``bulk_create_from_balancer`` identically.

    A role-less (all-flex) shape drafted nobody onto a role, so it exports the
    ``flex`` slot code -- which ``bulk_create_from_balancer`` stores as
    ``HeroClass.flex`` -- and the rank is the one ``ranks.slot_rank`` hands out
    for no role: the player's maximum, the same number the draft board showed
    the captain who picked them. The frozen pick rank is skipped there because
    it was frozen against a role the shape gives no meaning to.
    """
    pick_by_player_id = pick_by_player_id or {}
    payload: list[BalancerTeam] = []
    for team in sorted(teams, key=lambda t: t.draft_position):
        roster = roster_by_team.get(team.id, [])
        captain = next((p for p in roster if p.is_captain), None)
        team_name = (captain.battle_tag if captain and captain.battle_tag else None) or team.name

        members: list[BalancerTeamMember] = []
        total_sr = 0
        for p in roster:
            pk = pick_by_player_id.get(p.id)
            if shape.has_role_slots:
                # Drafted role + its rank. Captains have no pick -> primary role.
                role = (pk.target_role if (pk and pk.target_role) else None) or p.primary_role
                rank = (
                    pk.target_rank_value
                    if (pk is not None and pk.target_rank_value is not None)
                    else (ranks.slot_rank(p, role, shape) or 0)
                )
            else:
                role = FLEX_SLOT_CODE
                rank = ranks.slot_rank(p, None, shape) or 0
            total_sr += rank
            members.append(
                BalancerTeamMember(
                    uuid=str(p.user_id) if p.user_id is not None else str(uuid4()),
                    name=p.battle_tag or "",
                    sub_role=p.sub_role,
                    role=role,  # tank/dps/support/flex
                    rank=rank,
                )
            )
        avg_sr = (total_sr / len(members)) if members else 0.0
        payload.append(BalancerTeam(uuid=uuid4(), name=team_name, avgSr=avg_sr, totalSr=total_sr, members=members))
    return payload


async def export(session: AsyncSession, draft_session: DraftSession) -> tuple[DraftSession, int, int]:
    """Export a COMPLETED draft. Returns (session, removed_teams, imported_teams)."""
    if draft_session.status != DraftStatus.COMPLETED.value:
        raise _err("draft_not_completed", "Only a completed draft can be exported")

    teams = (await session.scalars(sa.select(DraftTeam).where(DraftTeam.session_id == draft_session.id))).all()
    roster_rows = (
        await session.scalars(
            sa.select(DraftPlayer)
            .where(
                DraftPlayer.session_id == draft_session.id,
                DraftPlayer.status == DraftPlayerStatus.PICKED.value,
            )
            # payload reads p.user_id and ranks.role_rank(p, ...) -> role_ranks.
            .options(*loaders.player_options())
        )
    ).all()
    roster_by_team: dict[int, list[DraftPlayer]] = defaultdict(list)
    for p in roster_rows:
        if p.drafted_by_team_id is not None:
            roster_by_team[p.drafted_by_team_id].append(p)

    # Resolved picks carry the drafted role + its rank (frozen at finalize).
    pick_rows = (
        await session.scalars(
            sa.select(DraftPick).where(
                DraftPick.session_id == draft_session.id,
                DraftPick.status.in_([DraftPickStatus.COMPLETED.value, DraftPickStatus.AUTOPICKED.value]),
            )
        )
    ).all()
    pick_by_player_id = {pk.picked_player_id: pk for pk in pick_rows if pk.picked_player_id is not None}

    payload = _draft_to_balancer_payload(
        list(teams),
        roster_by_team,
        await feasibility.resolve_shape(session, draft_session),
        pick_by_player_id,
    )
    # Idempotent cleanup + insert + backfill + stamp, all in the shared
    # orchestrator's single transaction (it used to be two: the writer committed
    # the deletes and inserts internally, and the caller committed the backfill).
    linked_ids = [t.exported_team_id for t in teams if t.exported_team_id is not None]

    def _unlink() -> None:
        for t in teams:
            t.exported_team_id = None

    async def _finalize(inner: AsyncSession, by_name: Mapping[str, models.Team]) -> None:
        for team, mapped in zip(teams, payload, strict=False):
            public_team = by_name.get(mapped.name)
            if public_team is not None:
                team.exported_team_id = public_team.id
        draft_session.exported_at = datetime.now(UTC)
        draft_session.export_status = "success"

    async def _on_failure(inner: AsyncSession, exc: BaseException) -> None:
        fresh = await inner.get(DraftSession, draft_session.id)
        if fresh is not None:
            fresh.export_status = "failed"

    outcome = await team_materialization.run(
        session,
        ExportPlan(
            tournament_id=draft_session.tournament_id,
            teams=to_materialization_teams(payload),
            prior_team_ids=linked_ids,
            on_unresolved="skip",
            unlink=_unlink,
            finalize=_finalize,
            on_failure=_on_failure,
        ),
    )
    return draft_session, outcome.removed_teams, outcome.imported_teams
