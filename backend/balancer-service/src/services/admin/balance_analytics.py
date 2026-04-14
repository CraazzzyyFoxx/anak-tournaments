"""Analytics snapshot creation for balance exports.

Creates analytics.balance_snapshot and analytics.balance_player_snapshot
records when a balance is exported to a tournament.
"""

from __future__ import annotations

import math

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.schemas.team import InternalBalancerTeamsPayload


ROLE_NAME_TO_CODE: dict[str, str] = {
    "Tank": "tank",
    "tank": "tank",
    "Damage": "dps",
    "dps": "dps",
    "DPS": "dps",
    "Support": "support",
    "support": "support",
}


async def create_balance_snapshot(
    session: AsyncSession,
    balance: models.BalancerBalance,
    payload: InternalBalancerTeamsPayload,
    exported_teams: dict[str, models.Team],
) -> models.AnalyticsBalanceSnapshot | None:
    """Create analytics snapshot at balance export time.

    Args:
        balance: The BalancerBalance being exported.
        payload: Parsed balance result payload.
        exported_teams: Map of balancer_name -> tournament.Team (just created).
    """
    if not payload.teams:
        return None

    # Delete existing snapshot for this balance
    await session.execute(
        sa.delete(models.AnalyticsBalanceSnapshot).where(
            models.AnalyticsBalanceSnapshot.balance_id == balance.id
        )
    )

    # Compute aggregate metrics
    team_avgs = [t.avg_mmr for t in payload.teams]
    avg_sr_overall = sum(team_avgs) / len(team_avgs) if team_avgs else 0.0
    sr_range = max(team_avgs) - min(team_avgs) if len(team_avgs) > 1 else 0.0
    sr_std_dev = (
        math.sqrt(sum((a - avg_sr_overall) ** 2 for a in team_avgs) / len(team_avgs))
        if team_avgs
        else 0.0
    )

    total_discomfort = 0
    off_role_count = 0
    player_count = 0
    for team in payload.teams:
        for role_name, players in team.roster.items():
            for player in players:
                player_count += 1
                discomfort = player.discomfort or 0
                total_discomfort += discomfort
                if player.preferences:
                    first_pref = player.preferences[0].strip().lower()
                    assigned = role_name.strip().lower()
                    if first_pref in ("damage", "dps"):
                        first_pref = "dps"
                    if assigned in ("damage", "dps"):
                        assigned = "dps"
                    if first_pref != assigned:
                        off_role_count += 1

    # Resolve variant if exists
    variant_id = None
    if balance.variants:
        selected = next((v for v in balance.variants if v.is_selected), None)
        if selected:
            variant_id = selected.id

    snapshot = models.AnalyticsBalanceSnapshot(
        tournament_id=balance.tournament_id,
        balance_id=balance.id,
        variant_id=variant_id,
        workspace_id=balance.workspace_id,
        algorithm=balance.algorithm or "unknown",
        division_scope=balance.division_scope,
        division_grid_json=balance.division_grid_json,
        team_count=len(payload.teams),
        player_count=player_count,
        avg_sr_overall=round(avg_sr_overall, 2),
        sr_std_dev=round(sr_std_dev, 2),
        sr_range=round(sr_range, 2),
        total_discomfort=total_discomfort,
        off_role_count=off_role_count,
        objective_score=None,
    )
    session.add(snapshot)
    await session.flush()

    # Build player lookup
    bp_result = await session.execute(
        sa.select(models.BalancerPlayer).where(
            models.BalancerPlayer.tournament_id == balance.tournament_id,
        )
    )
    bp_lookup: dict[str, models.BalancerPlayer] = {}
    for bp in bp_result.scalars().all():
        bp_lookup[bp.battle_tag_normalized] = bp

    for team_data in payload.teams:
        tournament_team = exported_teams.get(team_data.name)
        tournament_team_id = tournament_team.id if tournament_team else None

        for role_name, players in team_data.roster.items():
            role_code = ROLE_NAME_TO_CODE.get(role_name, role_name.lower())

            for player in players:
                name_normalized = player.name.replace(" ", "").strip().lower()
                bp = bp_lookup.get(name_normalized)
                user_id = bp.user_id if bp else None

                preferred_role: str | None = None
                was_off_role = False
                if player.preferences:
                    pref_display = player.preferences[0]
                    preferred_role = ROLE_NAME_TO_CODE.get(pref_display, pref_display.lower())
                    was_off_role = preferred_role != role_code

                session.add(
                    models.AnalyticsBalancePlayerSnapshot(
                        balance_snapshot_id=snapshot.id,
                        tournament_id=balance.tournament_id,
                        user_id=user_id,
                        team_id=tournament_team_id,
                        assigned_role=role_code,
                        preferred_role=preferred_role,
                        assigned_rank=player.rating,
                        discomfort=player.discomfort or 0,
                        division_number=bp.division_number if bp else None,
                        is_captain=player.is_captain,
                        was_off_role=was_off_role,
                    )
                )

    return snapshot
