"""The universe ``NOT`` complements against, for Overwatch rules.

Every query is scoped to ``context.workspace_id`` and ``context.discipline``: a player who only appears in another
game's tournaments, or in another workspace, is not a candidate and so can never be awarded by ``NOT``.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.disciplines.overwatch.achievements.duel import active_seat
from shared.domain.achievements.context import EvalContext
from shared.domain.achievements.registry import ResultSet
from shared.models.achievements.achievement import AchievementGrain
from shared.repository.stats_queries import match_context


async def all_eligible_users(
    session: AsyncSession,
    context: EvalContext,
) -> ResultSet:
    """All users on a roster of the context's workspace and discipline, as (user_id,) tuples."""
    query = (
        sa.select(models.WorkspaceMember.player_id.distinct())
        .select_from(models.Player)
        .join(
            models.WorkspaceMember,
            models.WorkspaceMember.id == models.Player.workspace_member_id,
        )
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            models.Tournament.workspace_id == context.workspace_id,
            models.Tournament.discipline == context.discipline,
        )
    )
    result = await session.execute(query)
    return {(row[0],) for row in result}


async def eligible_keys(
    session: AsyncSession,
    context: EvalContext,
    grain: AchievementGrain | str,
) -> ResultSet:
    """Universe for ``NOT``: keys of ``grain``, narrowed to ``context.tournament`` when set.

    Roster-based grains exclude substitutes, matching ``match_win`` and the
    team/streak nodes, so ``NOT match_win`` cannot award a bench player.
    """
    resolved = AchievementGrain(grain)
    if resolved is AchievementGrain.user:
        return await all_eligible_users(session, context)

    if resolved is AchievementGrain.user_tournament:
        query = (
            sa.select(models.WorkspaceMember.player_id, models.Player.tournament_id)
            .select_from(models.Player)
            .join(
                models.WorkspaceMember,
                models.WorkspaceMember.id == models.Player.workspace_member_id,
            )
            .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
            .where(
                models.Tournament.workspace_id == context.workspace_id,
                models.Tournament.discipline == context.discipline,
                models.Player.is_substitution.is_(False),
            )
        )
        if context.tournament:
            query = query.where(models.Player.tournament_id == context.tournament.id)
        result = await session.execute(query)
        return {(row[0], row[1]) for row in result}

    if resolved is AchievementGrain.user_encounter:
        seat, on_seat = active_seat()
        query = (
            sa.select(
                models.WorkspaceMember.player_id,
                models.Encounter.tournament_id,
                models.Encounter.id.label("encounter_id"),
            )
            .select_from(models.Encounter)
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .join(seat, on_seat)
            .join(
                models.Player,
                sa.and_(
                    models.Player.team_id == seat.team_id,
                    models.Player.tournament_id == models.Encounter.tournament_id,
                ),
            )
            .join(
                models.WorkspaceMember,
                models.WorkspaceMember.id == models.Player.workspace_member_id,
            )
            .where(
                models.Tournament.workspace_id == context.workspace_id,
                models.Tournament.discipline == context.discipline,
                models.Player.is_substitution.is_(False),
            )
        )
        if context.tournament:
            query = query.where(models.Encounter.tournament_id == context.tournament.id)
        result = await session.execute(query)
        return {(row[0], row[1], row[2]) for row in result}

    match = match_context(discipline=context.discipline)
    query = (
        sa.select(
            models.WorkspaceMember.player_id,
            match.c.tournament_id,
            match.c.id.label("match_id"),
        )
        .select_from(match)
        .join(
            models.StatsMatchTeam,
            sa.and_(
                models.StatsMatchTeam.match_id == match.c.id,
                models.StatsMatchTeam.encounter_id == match.c.encounter_id,
            ),
        )
        .join(
            models.EncounterTeam,
            sa.and_(
                models.EncounterTeam.id == models.StatsMatchTeam.encounter_team_id,
                models.EncounterTeam.encounter_id == match.c.encounter_id,
            ),
        )
        .join(
            models.Player,
            sa.and_(
                models.Player.team_id == models.EncounterTeam.team_id,
                models.Player.tournament_id == match.c.tournament_id,
            ),
        )
        .join(
            models.WorkspaceMember,
            sa.and_(
                models.WorkspaceMember.id == models.Player.workspace_member_id,
                models.WorkspaceMember.workspace_id == match.c.workspace_id,
            ),
        )
        .where(
            match.c.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    )
    if context.tournament:
        query = query.where(match.c.tournament_id == context.tournament.id)
    result = await session.execute(query)
    return {(row[0], row[1], row[2]) for row in result}
