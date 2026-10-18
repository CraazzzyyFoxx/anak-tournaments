"""encounter_result / encounter_comeback — series-grain conditions.

Both nodes emit ``(user_id, tournament_id, encounter_id)``: the fact they
measure belongs to the series itself, not to any single map of it.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.disciplines.overwatch.achievements.duel import Duel
from shared.disciplines.overwatch.achievements.stage_filters import join_bracket_context
from shared.domain.achievements.context import EvalContext
from shared.models.achievements.achievement import AchievementGrain
from shared.repository.stats_queries import match_context

from . import ResultSet, register
from .encounter import join_final_encounters
from .match_win import winning_teams


def _series_roster_query() -> sa.Select:
    """Encounter joined to stage context — no roster join, no columns yet."""
    return join_bracket_context(
        sa.select(models.Encounter.id)
        .select_from(models.Encounter)
        .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
    )


@register(
    "encounter_result",
    grain=AchievementGrain.user_encounter,
    description="A completed series ended in this outcome and scoreline shape",
    required=("outcome",),
    optional=("margin", "opponent_score", "round_type"),
    depends_on=("tournament.encounter", "tournament.player", "tournament.stage"),
)
async def execute_encounter_result(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Roster of the winning or losing side of a decided series. Grain: user_encounter.

    params:
        outcome: "win" | "loss" — which side's roster qualifies.
        margin: the winner's score minus the loser's must equal this.
        opponent_score: the LOSING side's map count must equal this (0 = a sweep).
        round_type: "any" (default) | "final".
    """
    duel = Duel()
    target_team_id = {"win": duel.winner_team_id, "loss": duel.loser_team_id}[params["outcome"]]

    where = [
        models.Tournament.workspace_id == context.workspace_id,
        models.Encounter.workspace_id == context.workspace_id,
        models.Encounter.discipline == "overwatch",
        models.WorkspaceMember.workspace_id == context.workspace_id,
        models.Encounter.status == "COMPLETED",
        # A draw has no winner and no loser, so it qualifies neither side.
        duel.decided,
        models.Player.is_substitution.is_(False),
    ]
    if context.tournament:
        where.append(models.Encounter.tournament_id == context.tournament.id)
    if (margin := params.get("margin")) is not None:
        where.append(duel.margin == margin)
    if (opponent_score := params.get("opponent_score")) is not None:
        where.append(duel.loser_score == opponent_score)

    query = duel.join(
        _series_roster_query().with_only_columns(
            models.WorkspaceMember.player_id.label("user_id"),
            models.Encounter.tournament_id.label("tournament_id"),
            models.Encounter.id.label("encounter_id"),
            duel.winner_score.label("winner_score"),
            duel.loser_score.label("loser_score"),
        )
    )

    if params.get("round_type", "any") == "final":
        query = join_final_encounters(query, context.workspace_id)

    query = (
        query.join(
            models.Player,
            sa.and_(
                models.Player.team_id == target_team_id,
                models.Player.tournament_id == models.Encounter.tournament_id,
            ),
        )
        .join(
            models.WorkspaceMember,
            models.WorkspaceMember.id == models.Player.workspace_member_id,
        )
        .where(*where)
    )

    result = await session.execute(query)
    keys: ResultSet = set()
    for row in result:
        key = (row.user_id, row.tournament_id, row.encounter_id)
        keys.add(key)
        context.record_evidence(
            key,
            winner_score=int(row.winner_score),
            loser_score=int(row.loser_score),
            margin=int(row.winner_score) - int(row.loser_score),
            outcome=params["outcome"],
        )
    return keys


@register(
    "encounter_comeback",
    grain=AchievementGrain.user_encounter,
    description="Won a series after trailing by this many maps",
    optional=("min_deficit",),
    depends_on=("tournament.encounter", "tournament.player", "stats.match", "stats.fact"),
)
async def execute_encounter_comeback(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Series winner that was once behind by ``min_deficit`` maps. Grain: user_encounter.

    params:
        min_deficit: maps the eventual winner had to be down by (default 2).

    The walk happens in Python: one query pulls every candidate series' maps,
    because the running score is sequential and SQL window functions buy
    nothing over a few thousand rows.
    """
    min_deficit = params.get("min_deficit", 2)

    duel = Duel()
    match = match_context(discipline="overwatch")
    winners = winning_teams()
    maps_query = duel.join(
        sa.select(
            models.Encounter.id.label("encounter_id"),
            models.Encounter.tournament_id.label("tournament_id"),
            duel.winner_team_id.label("winner_team_id"),
            duel.loser_team_id.label("loser_team_id"),
            duel.winner_score.label("winner_score"),
            duel.loser_score.label("loser_score"),
            match.c.id.label("match_id"),
            match.c.position,
            winners.c.tournament_team_id.label("map_winner"),
        )
        .select_from(match)
        .outerjoin(winners, winners.c.match_id == match.c.id)
        .join(models.Encounter, models.Encounter.id == match.c.encounter_id)
        .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
    ).where(
        models.Tournament.workspace_id == context.workspace_id,
        match.c.workspace_id == context.workspace_id,
        models.Encounter.status == "COMPLETED",
        duel.decided,
    )
    if context.tournament:
        maps_query = maps_query.where(models.Encounter.tournament_id == context.tournament.id)

    series: dict[int, list] = {}
    for row in await session.execute(maps_query):
        series.setdefault(row.encounter_id, []).append(row)

    # encounter_id -> (tournament_id, winning_team_id, max_deficit, winner_score, loser_score)
    qualifying: dict[int, tuple[int, int, int, int, int]] = {}
    for encounter_id, rows in series.items():
        positions = {row.position for row in rows}
        if None in positions or len(positions) != len(rows):
            # Never infer a deficit from only the ordered subset of a series.
            context.deferred_encounter_ids.add(encounter_id)
            continue
        first = rows[0]
        winner_team_id, loser_team_id = first.winner_team_id, first.loser_team_id

        won = lost = 0
        max_deficit = 0
        for row in sorted(rows, key=lambda r: r.position):
            map_winner = row.map_winner
            if map_winner == winner_team_id:
                won += 1
            elif map_winner == loser_team_id:
                lost += 1
            else:  # a map of some other pairing, defensively ignored
                continue
            max_deficit = max(max_deficit, lost - won)

        if max_deficit >= min_deficit:
            qualifying[encounter_id] = (
                first.tournament_id,
                winner_team_id,
                max_deficit,
                first.winner_score,
                first.loser_score,
            )

    if not qualifying:
        return set()

    winning_team_ids = {entry[1] for entry in qualifying.values()}
    roster_query = (
        sa.select(
            models.Player.team_id.label("team_id"),
            models.WorkspaceMember.player_id.label("user_id"),
        )
        .select_from(models.Player)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
        .where(
            models.Tournament.workspace_id == context.workspace_id,
            models.WorkspaceMember.workspace_id == context.workspace_id,
            models.Player.team_id.in_(winning_team_ids),
            models.Player.is_substitution.is_(False),
        )
    )
    roster: dict[int, list[int]] = {}
    for row in await session.execute(roster_query):
        roster.setdefault(row.team_id, []).append(row.user_id)

    keys: ResultSet = set()
    for encounter_id, (tournament_id, team_id, max_deficit, winner_score, loser_score) in qualifying.items():
        for user_id in roster.get(team_id, ()):
            key = (user_id, tournament_id, encounter_id)
            keys.add(key)
            context.record_evidence(
                key,
                max_deficit=int(max_deficit),
                winner_score=int(winner_score),
                loser_score=int(loser_score),
            )
    return keys
