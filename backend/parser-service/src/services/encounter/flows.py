"""Bind Workshop observations to one existing live game without inventing results."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.pick_ban_config import pool_allows
from shared.models.tournament.pick_ban import PickBanConfig
from src import models
from src.core import enums, errors

from . import service


async def resolve_for_log(
    session: AsyncSession,
    team_ids: tuple[int, int],
    *,
    job: models.IngestJob,
    map_id: int,
    map_pools: Sequence[PickBanConfig],
) -> tuple[models.Encounter, models.EncounterGame, list[models.EncounterTeam]] | None:
    encounter, game, team, side = models.Encounter, models.EncounterGame, models.EncounterTeam, models.EncounterGameTeam
    if len(set(team_ids)) != 2:
        raise errors.ApiHTTPException(
            status_code=400, detail=[errors.ApiExc(code="invalid_teams", msg="A log must name two different teams")]
        )
    parents = sa.select(encounter).where(
        encounter.workspace_id == job.workspace_id,
        encounter.discipline == job.discipline,
        encounter.tournament_id == job.hint_tournament_id,
        encounter.slot_count == 2,
        *(sa.exists().where(team.encounter_id == encounter.id, team.team_id == tid) for tid in team_ids),
    )
    if job.hint_encounter_id is not None:
        parents = parents.where(encounter.id == job.hint_encounter_id)
    if job.hint_encounter_game_id is not None:
        parent_id = await session.scalar(sa.select(game.encounter_id).where(game.id == job.hint_encounter_game_id))
        parents = parents.where(encounter.id == parent_id)
    # All game creation/replacement under a series serializes on its parent.
    encounters = list(await session.scalars(parents.order_by(encounter.id).with_for_update(of=encounter)))
    if (job.hint_encounter_id is not None or job.hint_encounter_game_id is not None) and not encounters:
        raise errors.ApiHTTPException(
            status_code=422,
            detail=[
                errors.ApiExc(
                    code="attached_encounter_mismatch",
                    msg="Attached encounter does not agree with the log's owner and teams",
                )
            ],
        )
    if not encounters:
        return None
    parent_by_id = {row.id: row for row in encounters}
    positions = await service.bracket_positions(session, list(parent_by_id))
    permitted = {
        eid
        for eid in parent_by_id
        if pool_allows(
            map_pools,
            stage_id=positions.get(eid, (None, None))[0],
            round=positions.get(eid, (None, None))[1],
            item_id=map_id,
        )
    }
    if not permitted:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[errors.ApiExc(code="map_not_in_pool", msg="Map is outside the configured encounter pool")],
        )
    query = sa.select(game).where(
        game.encounter_id.in_(permitted),
        game.map_id == map_id,
        game.state != enums.EncounterGameState.CANCELLED,
    )
    hinted_game = job.hint_encounter_game_id
    if hinted_game is None:
        # A previously validated provenance link is stronger than today's
        # ambiguous map list. It never authorizes moving an existing match.
        linked = list(
            await session.scalars(
                sa.select(models.StatsMatch.encounter_game_id).where(
                    models.StatsMatch.ingest_job_id == job.id,
                    models.StatsMatch.workspace_id == job.workspace_id,
                    models.StatsMatch.discipline == job.discipline,
                )
            )
        )
        if len(linked) == 1:
            hinted_game = linked[0]
    if hinted_game is not None:
        query = query.where(game.id == hinted_game)
    games = list(await session.scalars(query.order_by(game.id).with_for_update(of=game)))
    candidates = []
    for candidate in games:
        participants = list(
            await session.scalars(
                sa.select(team)
                .join(side, side.encounter_team_id == team.id)
                .where(
                    side.game_id == candidate.id,
                    side.encounter_id == candidate.encounter_id,
                    team.encounter_id == candidate.encounter_id,
                )
                .order_by(team.id)
            )
        )
        if len(participants) == 2 and {row.team_id for row in participants} == set(team_ids):
            candidates.append((parent_by_id[candidate.encounter_id], candidate, participants))
    if hinted_game is not None and not candidates:
        raise errors.ApiHTTPException(
            status_code=422,
            detail=[
                errors.ApiExc(
                    code="attached_game_mismatch",
                    msg="Attached game does not agree with the log's owner, map and teams",
                )
            ],
        )
    return candidates[0] if len(candidates) == 1 else None
