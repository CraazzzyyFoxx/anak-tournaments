import typing

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.repository import MatchRepository, TeamRepository
from src import models
from src.core import utils
from src.services.map import service as map_service
from src.services.tournament import service as tournament_service


def encounter_entities(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    entities = []
    if "tournament" in in_entities:
        tournament_entity = utils.join_entity(child, models.Encounter.tournament)
        entities.append(tournament_entity)
        entities.extend(
            tournament_service.tournament_entities(utils.prepare_entities(in_entities, "tournament"), tournament_entity)
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
        entities.extend(TeamRepository.team_entities(utils.prepare_entities(in_entities, "teams"), home_team_entity))
        entities.extend(TeamRepository.team_entities(utils.prepare_entities(in_entities, "teams"), away_team_entity))
    if "home_team" in in_entities:
        home_team_entity = utils.join_entity(child, models.Encounter.home_team)
        entities.append(home_team_entity)
        entities.extend(
            TeamRepository.team_entities(utils.prepare_entities(in_entities, "home_team"),
            home_team_entity,)
        )
    if "away_team" in in_entities:
        away_team_entity = utils.join_entity(child, models.Encounter.away_team)
        entities.append(away_team_entity)
        entities.extend(
            TeamRepository.team_entities(utils.prepare_entities(in_entities, "away_team"),
            away_team_entity,)
        )
    if "stage" in in_entities:
        stage_entity = utils.join_entity(child, models.Encounter.stage)
        stage_items_entity = utils.join_entity(stage_entity, models.Stage.items)
        entities.append(stage_entity)
        entities.append(stage_items_entity)
        entities.append(utils.join_entity(stage_items_entity, models.StageItem.inputs))
    if "stage_item" in in_entities:
        stage_item_entity = utils.join_entity(child, models.Encounter.stage_item)
        entities.append(stage_item_entity)
        entities.append(utils.join_entity(stage_item_entity, models.StageItem.inputs))
    if "matches" in in_entities:
        matches_entity = utils.join_entity(child, models.Encounter.matches)
        entities.append(matches_entity)
        entities.extend(match_entities(utils.prepare_entities(in_entities, "matches"), matches_entity))

    return entities


def match_entities(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    entities = []

    if "teams" in in_entities:
        home_team_entity = utils.join_entity(child, models.Match.home_team)
        away_team_entity = utils.join_entity(child, models.Match.away_team)
        entities.append(home_team_entity)
        entities.append(away_team_entity)
        entities.extend(TeamRepository.team_entities(utils.prepare_entities(in_entities, "teams"), home_team_entity))
        entities.extend(TeamRepository.team_entities(utils.prepare_entities(in_entities, "teams"), away_team_entity))
    if "home_team" in in_entities:
        home_team_entity = utils.join_entity(child, models.Match.home_team)
        entities.append(home_team_entity)
        entities.extend(
            TeamRepository.team_entities(utils.prepare_entities(in_entities, "home_team"),
            home_team_entity,)
        )
    if "away_team" in in_entities:
        away_team_entity = utils.join_entity(child, models.Match.away_team)
        entities.append(away_team_entity)
        entities.extend(
            TeamRepository.team_entities(utils.prepare_entities(in_entities, "away_team"),
            away_team_entity,)
        )
    if "encounter" in in_entities:
        entities.append(utils.join_entity(child, models.Match.encounter))
    if "map" in in_entities:
        map_entity = utils.join_entity(child, models.Match.map)
        entities.append(map_entity)
        entities.extend(map_service.map_entities(utils.prepare_entities(in_entities, "map"), map_entity))
    return entities


class EncounterService:
    def __init__(self, *, match_repo: MatchRepository = MatchRepository()) -> None:
        self.match_repo = match_repo

    async def get_match_by_encounter_and_map(
        self, session: AsyncSession, encounter_id: int, map_id: int, entities: list[str]
    ) -> models.Match | None:
        query = (
            sa.select(models.Match)
            .where(sa.and_(models.Match.encounter_id == encounter_id, models.Match.map_id == map_id))
            .options(*match_entities(entities))
        )
        result = await session.execute(query)
        return result.unique().scalars().first()

    async def get_by_teams(
        self,
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
        return result.unique().scalars().first()

    async def create_match(
        self,
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
        log_record_id: int | None = None,
    ) -> models.Match:
        match = models.Match(
            time=time,
            log_name=log_name,
            log_record_id=log_record_id,
            home_team_id=home_team_id,
            away_team_id=away_team_id,
            home_score=home_score,
            away_score=away_score,
            encounter_id=encounter.id,
            map_id=map.id,
        )
        await self.match_repo.create(session, match)
        logger.info(
            f"Match created [home_team_id={home_team_id}, away_team_id={away_team_id}] for encounter {encounter.id}"
        )
        return match


encounter_service = EncounterService()
get_match_by_encounter_and_map = encounter_service.get_match_by_encounter_and_map
get_by_teams = encounter_service.get_by_teams
create_match = encounter_service.create_match
