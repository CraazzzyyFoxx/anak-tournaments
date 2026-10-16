"""Explicit native observation reads shared by public serializers.

These are read contexts, not mapped legacy matches. Visibility is imposed by the
caller; historical game participants are never filtered by today's active flag.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from shared import models
from shared.repository.stats_queries import match_context, team_scores

__all__ = ("MatchReadContext", "duel_matches", "get_match_reads")


def duel_matches(*, discipline: str) -> sa.Subquery:
    """Native headers and observed scores in the owner's historical participation slots."""
    context = match_context(discipline=discipline)
    mt, et = models.StatsMatchTeam, models.EncounterTeam
    participants = (
        sa.select(
            mt.match_id,
            sa.func.max(et.id).filter(et.slot == 1).label("home_encounter_team_id"),
            sa.func.max(et.id).filter(et.slot == 2).label("away_encounter_team_id"),
            sa.func.max(et.team_id).filter(et.slot == 1).label("home_tournament_team_id"),
            sa.func.max(et.team_id).filter(et.slot == 2).label("away_tournament_team_id"),
        )
        .select_from(mt)
        .join(context, sa.and_(context.c.id == mt.match_id, context.c.encounter_id == mt.encounter_id))
        .join(et, sa.and_(et.id == mt.encounter_team_id, et.encounter_id == mt.encounter_id))
        .group_by(mt.match_id)
        .having(sa.func.count() == 2, sa.func.min(et.slot) == 1, sa.func.max(et.slot) == 2)
        .subquery()
    )
    scores = team_scores(discipline=discipline, stat_code="score")
    home, away = scores.alias("home_observed_score"), scores.alias("away_observed_score")
    return (
        sa.select(
            *context.c,
            participants.c.home_encounter_team_id,
            participants.c.away_encounter_team_id,
            participants.c.home_tournament_team_id,
            participants.c.away_tournament_team_id,
            home.c.value.label("home_score"),
            away.c.value.label("away_score"),
        )
        .select_from(context)
        .join(participants, participants.c.match_id == context.c.id)
        .outerjoin(
            home,
            sa.and_(home.c.match_id == context.c.id, home.c.encounter_team_id == participants.c.home_encounter_team_id),
        )
        .outerjoin(
            away,
            sa.and_(away.c.match_id == context.c.id, away.c.encounter_team_id == participants.c.away_encounter_team_id),
        )
        .subquery()
    )


@dataclass(frozen=True, slots=True)
class MatchReadContext:
    match: models.StatsMatch
    game: models.EncounterGame | None
    encounter: models.Encounter
    map: models.CatalogEntity
    job: models.IngestJob | None
    home_participation: models.EncounterTeam
    away_participation: models.EncounterTeam
    home_team: models.Team | None
    away_team: models.Team | None
    home_score: int
    away_score: int
    display_filename: str | None


async def get_match_reads(
    session: AsyncSession,
    *,
    match_ids: Sequence[int],
    discipline: str = "overwatch",
    team_options: Sequence[Any] = (),
    encounter_options: Sequence[Any] = (),
) -> dict[int, MatchReadContext]:
    """Load an authorized batch without per-match team/map/provenance lookups."""
    if not match_ids:
        return {}
    d = duel_matches(discipline=discipline)
    m, g, e, entity, job = (
        models.StatsMatch,
        models.EncounterGame,
        models.Encounter,
        models.CatalogEntity,
        models.IngestJob,
    )
    home = aliased(models.EncounterTeam, name="home_observed_participation")
    away = aliased(models.EncounterTeam, name="away_observed_participation")
    rows = (
        (
            await session.execute(
                sa.select(
                    m,
                    g,
                    e,
                    entity,
                    job,
                    home,
                    away,
                    d.c.home_score,
                    d.c.away_score,
                )
                .select_from(d)
                .join(m, m.id == d.c.id)
                .outerjoin(g, g.id == d.c.encounter_game_id)
                .join(e, e.id == d.c.encounter_id)
                .join(home, home.id == d.c.home_encounter_team_id)
                .join(away, away.id == d.c.away_encounter_team_id)
                .join(
                    entity,
                    sa.and_(entity.id == m.map_entity_id, entity.discipline == m.discipline, entity.kind == "map"),
                )
                .outerjoin(
                    job,
                    sa.and_(
                        job.id == m.ingest_job_id, job.workspace_id == m.workspace_id, job.discipline == m.discipline
                    ),
                )
                .where(m.id.in_(match_ids))
                .options(selectinload(entity.parent), *encounter_options)
            )
        )
        .unique()
        .all()
    )
    team_ids = {seat.team_id for row in rows for seat in (row[5], row[6]) if seat.team_id is not None}
    teams = (
        {
            team.id: team
            for team in (
                await session.scalars(sa.select(models.Team).where(models.Team.id.in_(team_ids)).options(*team_options))
            ).unique()
        }
        if team_ids
        else {}
    )
    output = {}
    for (
        match,
        game,
        encounter,
        map_entity,
        ingest_job,
        home_participation,
        away_participation,
        home_score,
        away_score,
    ) in rows:
        # OW requires actual observed scores, not invented zeros or official results.
        if (
            home_score is None
            or away_score is None
            or not float(home_score).is_integer()
            or not float(away_score).is_integer()
        ):
            raise ValueError(f"match {match.id} has missing or non-integral observed duel scores")
        output[match.id] = MatchReadContext(
            match=match,
            game=game,
            encounter=encounter,
            map=map_entity,
            job=ingest_job,
            home_participation=home_participation,
            away_participation=away_participation,
            home_team=teams.get(home_participation.team_id),
            away_team=teams.get(away_participation.team_id),
            home_score=int(home_score),
            away_score=int(away_score),
            display_filename=ingest_job.filename if ingest_job is not None else None,
        )
    return output
