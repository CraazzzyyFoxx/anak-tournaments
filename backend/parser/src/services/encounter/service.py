import typing

import sqlalchemy as sa
from loguru import logger

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models
from src.core import utils, enums
from src.services.team import service as team_service
from src.services.tournament import service as tournament_service
from src.services.map import service as map_service


def encounter_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[_AbstractLoad]:
    entities = []
    if "tournament" in in_entities:
        tournament_entity = utils.join_entity(child, models.Encounter.tournament)
        entities.append(tournament_entity)
        entities.extend(
            tournament_service.tournament_entities(
                utils.prepare_entities(in_entities, "tournament"), tournament_entity
            )
        )
    if "tournament_group" in in_entities:
        entities.append(utils.join_entity(child, models.Encounter.tournament_group))
    if "group" in in_entities:
        entities.append(utils.join_entity(child, models.Encounter.tournament_group))
    if "teams" in in_entities:
        home_team_entity = utils.join_entity(child, models.Encounter.home_team)
        away_team_entity = utils.join_entity(child, models.Encounter.away_team)
        entities.append(home_team_entity)
        entities.append(away_team_entity)
        entities.extend(
            team_service.team_entities(
                utils.prepare_entities(in_entities, "teams"), home_team_entity
            )
        )
        entities.extend(
            team_service.team_entities(
                utils.prepare_entities(in_entities, "teams"), away_team_entity
            )
        )
    if "matches" in in_entities:
        matches_entity = utils.join_entity(child, models.Encounter.matches)
        entities.append(matches_entity)
        entities.extend(
            match_entities(
                utils.prepare_entities(in_entities, "matches"), matches_entity
            )
        )

    return entities


def match_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[_AbstractLoad]:
    entities = []

    if "teams" in in_entities:
        home_team_entity = utils.join_entity(child, models.Match.home_team)
        away_team_entity = utils.join_entity(child, models.Match.away_team)
        entities.append(home_team_entity)
        entities.append(away_team_entity)
        entities.extend(
            team_service.team_entities(
                utils.prepare_entities(in_entities, "teams"), home_team_entity
            )
        )
        entities.extend(
            team_service.team_entities(
                utils.prepare_entities(in_entities, "teams"), away_team_entity
            )
        )
    if "encounter" in in_entities:
        entities.append(utils.join_entity(child, models.Match.encounter))
    if "map" in in_entities:
        map_entity = utils.join_entity(child, models.Match.map)
        entities.append(map_entity)
        entities.extend(
            map_service.map_entities(
                utils.prepare_entities(in_entities, "map"), map_entity
            )
        )
    return entities


def join_encounter_entities(query: sa.Select, in_entities: list[str]) -> sa.Select:
    if "tournament" in in_entities:
        query = query.join(
            models.Tournament, models.Encounter.tournament_id == models.Tournament.id
        )
    if "group" in in_entities:
        query = query.join(
            models.TournamentGroup,
            models.Encounter.tournament_group_id == models.TournamentGroup.id,
        )

    return query


async def get_by_challonge_id(
    session: AsyncSession, challonge_id: int, entities: list[str]
) -> models.Encounter | None:
    query = (
        sa.select(models.Encounter)
        .options(*encounter_entities(entities))
        .where(sa.and_(models.Encounter.challonge_id == challonge_id))
    )
    result = await session.execute(query)
    return result.scalars().first()


async def get_by_tournament_group_id(
    session: AsyncSession, tournament_id: int, group_id: int, entities: list[str]
) -> typing.Sequence[models.Encounter]:
    query = (
        sa.select(models.Encounter)
        .options(*encounter_entities(entities))
        .where(
            sa.and_(
                models.Encounter.tournament_id == tournament_id,
                models.Encounter.tournament_group_id == group_id,
            )
        )
    )
    result = await session.execute(query)
    return result.scalars().all()


async def get_by_name_group_id(
    session: AsyncSession, name: str, group_id: int, entities: list[str]
) -> models.Encounter | None:
    query = (
        sa.select(models.Encounter)
        .options(*encounter_entities(entities))
        .where(
            sa.and_(
                models.Encounter.name == name,
                models.Encounter.tournament_group_id == group_id,
            )
        )
    )
    result = await session.execute(query)
    return result.scalars().first()


async def get_match_by_encounter_and_map(
    session: AsyncSession, encounter_id: int, map_id: int, entities: list[str]
) -> models.Match | None:
    query = (
        sa.select(models.Match)
        .where(
            sa.and_(
                models.Match.encounter_id == encounter_id, models.Match.map_id == map_id
            )
        )
        .options(*match_entities(entities))
    )
    result = await session.execute(query)
    return result.scalars().first()


async def get_by_teams(
    session: AsyncSession,
    home_team_id: int,
    away_team_id: int,
    entities: list[str],
    *,
    has_closeness: bool | None = False,
) -> models.Encounter | None:
    query = (
        sa.select(models.Encounter)
        .options(*encounter_entities(entities))
        .where(
            sa.or_(
                sa.and_(
                    models.Encounter.home_team_id == home_team_id,
                    models.Encounter.away_team_id == away_team_id,
                ),
                sa.and_(
                    models.Encounter.home_team_id == away_team_id,
                    models.Encounter.away_team_id == home_team_id,
                ),
            )
        )
    )

    if isinstance(has_closeness, bool):
        if has_closeness:
            query = query.where(models.Encounter.closeness.isnot(None))
        else:
            query = query.where(models.Encounter.closeness.is_(None))

    result = await session.execute(query)
    return result.scalars().first()


def get_by_teams_sync(
    session: Session, home_team_id: int, away_team_id: int, entities: list[str]
) -> models.Encounter | None:
    query = (
        sa.select(models.Encounter)
        .options(*encounter_entities(entities))
        .where(
            sa.or_(
                sa.and_(
                    models.Encounter.home_team_id == home_team_id,
                    models.Encounter.away_team_id == away_team_id,
                ),
                sa.and_(
                    models.Encounter.home_team_id == away_team_id,
                    models.Encounter.away_team_id == home_team_id,
                ),
            )
        )
    )
    result = session.execute(query)
    return result.scalars().first()


async def get_by_team(
    session: AsyncSession, team_id: int, entities: list[str]
) -> typing.Sequence[models.Encounter]:
    query = (
        sa.select(models.Encounter)
        .options(*encounter_entities(entities))
        .where(
            sa.or_(
                models.Encounter.home_team_id == team_id,
                models.Encounter.away_team_id == team_id,
            )
        )
    )
    result = await session.execute(query)
    return result.scalars().all()


async def get_encounter_by_names(
    session: AsyncSession,
    tournament: models.Tournament,
    home_team: models.Team,
    away_team: models.Team,
) -> models.Encounter:
    query = sa.select(models.Encounter).where(
        sa.and_(
            models.Encounter.tournament_id == tournament.id,
            models.Encounter.home_team_id == home_team.id,
            models.Encounter.away_team_id == away_team.id,
        )
    )
    result = await session.execute(query)
    return result.scalars().one()


async def create(
    session: AsyncSession,
    *,
    name: str,
    home_team: models.Team | None,
    away_team: models.Team | None,
    home_score: int,
    away_score: int,
    round: int,
    tournament: models.Tournament,
    group_id: int | None,
    status: enums.EncounterStatus,
    challonge_id: int | None = None,
    has_logs: bool = False,
) -> models.Encounter:
    encounter = models.Encounter(
        name=name,
        home_team=home_team,
        away_team=away_team,
        home_score=home_score,
        away_score=away_score,
        round=round,
        tournament_id=tournament.id,
        tournament_group_id=group_id,
        challonge_id=challonge_id,
        status=status,
        has_logs=has_logs,
    )
    session.add(encounter)
    await session.commit()
    return encounter


async def update(
    session: AsyncSession,
    encounter: models.Encounter,
    *,
    name: str | None = None,
    home_team_id: int | None = None,
    away_team_id: int | None = None,
    home_score: int | None = None,
    away_score: int | None = None,
    round: int | None = None,
    tournament_id: int | None = None,
    group_id: int | None = None,
    challonge_id: int | None = None,
    status: enums.EncounterStatus | None = None,
    has_logs: bool,
) -> models.Encounter:
    encounter.name = name or encounter.name
    encounter.home_team_id = home_team_id or encounter.home_team_id
    encounter.away_team_id = away_team_id or encounter.away_team_id
    encounter.home_score = home_score or encounter.home_score
    encounter.away_score = away_score or encounter.away_score
    encounter.round = round or encounter.round
    encounter.tournament_id = tournament_id or encounter.tournament_id
    encounter.tournament_group_id = group_id or encounter.tournament_group_id
    encounter.challonge_id = challonge_id or encounter.challonge_id
    encounter.has_logs = has_logs or encounter.has_logs
    encounter.status = status or encounter.status
    await session.commit()
    return encounter


async def create_match(
    session: AsyncSession,
    encounter: models.Encounter,
    *,
    time: float,
    log_name: str,
    map: models.Map,
    home_team_id: int,
    away_team_id: int,
    home_score: int,
    away_score: int,
) -> models.Match:
    match = models.Match(
        time=time,
        log_name=log_name,
        home_team_id=home_team_id,
        away_team_id=away_team_id,
        home_score=home_score,
        away_score=away_score,
        encounter_id=encounter.id,
        map_id=map.id,
    )
    session.add(match)
    await session.commit()
    logger.info(
        f"Match created [home_team_id={home_team_id}, away_team_id={away_team_id}] for encounter {encounter.id}"
    )
    return match
