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

    # Collect all individual player ratings for aggregate metrics
    all_ratings: list[int] = []
    for team in payload.teams:
        for players in team.roster.values():
            for player in players:
                all_ratings.append(player.rating)

    avg_sr_overall = sum(all_ratings) / len(all_ratings) if all_ratings else 0.0
    sr_range = max(all_ratings) - min(all_ratings) if len(all_ratings) > 1 else 0.0
    sr_std_dev = (
        math.sqrt(sum((r - avg_sr_overall) ** 2 for r in all_ratings) / len(all_ratings))
        if all_ratings
        else 0.0
    )

    total_discomfort = 0
    player_count = 0
    # off_role_count will be summed from per-player was_off_role flags after the per-player loop
    per_player_off_role: list[bool] = []
    for team in payload.teams:
        for role_name, players in team.roster.items():
            for player in players:
                player_count += 1
                discomfort = player.discomfort or 0
                total_discomfort += discomfort
                was_off_role = False
                if player.preferences:
                    first_pref = player.preferences[0].strip().lower()
                    assigned = role_name.strip().lower()
                    if first_pref in ("damage", "dps"):
                        first_pref = "dps"
                    if assigned in ("damage", "dps"):
                        assigned = "dps"
                    was_off_role = first_pref != assigned
                per_player_off_role.append(was_off_role)

    off_role_count = sum(1 for v in per_player_off_role if v)

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

    # Build player lookup (with role_entries eagerly loaded)
    from sqlalchemy.orm import selectinload

    bp_result = await session.execute(
        sa.select(models.BalancerPlayer)
        .where(
            models.BalancerPlayer.tournament_id == balance.tournament_id,
        )
        .options(selectinload(models.BalancerPlayer.role_entries))
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

                # Look up division_number from the role_entry matching assigned_role
                division_number: int | None = None
                if bp is not None:
                    matching_entry = next(
                        (e for e in bp.role_entries if e.role == role_code),
                        None,
                    )
                    if matching_entry is not None:
                        division_number = matching_entry.division_number

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
                        division_number=division_number,
                        is_captain=player.is_captain,
                        was_off_role=was_off_role,
                    )
                )

    return snapshot
