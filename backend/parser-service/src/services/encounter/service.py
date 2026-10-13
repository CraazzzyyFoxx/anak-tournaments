import typing

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.repository import MatchRepository, TeamRepository
from src import models
from src.core import utils
from src.services.map import service as map_service


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
            TeamRepository.team_entities(
                utils.prepare_entities(in_entities, "home_team"),
                home_team_entity,
            )
        )
    if "away_team" in in_entities:
        away_team_entity = utils.join_entity(child, models.Match.away_team)
        entities.append(away_team_entity)
        entities.extend(
            TeamRepository.team_entities(
                utils.prepare_entities(in_entities, "away_team"),
                away_team_entity,
            )
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

    async def list_by_teams(self, session: AsyncSession, *team_ids: int) -> typing.Sequence[models.Encounter]:
        """Every duel whose active seats are exactly ``team_ids``.

        Only active participations count: a team a bracket correction replaced
        no longer plays the encounter, whatever games it left behind. A lobby
        (``slot_count > 2``) never matches, and neither does an encounter with
        a third seat: two teams of one FFA group share every lobby of their
        stage, and a log between two teams is a duel.
        """
        seated = [
            sa.exists().where(
                models.EncounterTeam.encounter_id == models.Encounter.id,
                models.EncounterTeam.team_id == team_id,
                models.EncounterTeam.active.is_(True),
            )
            for team_id in team_ids
        ]
        strangers = sa.exists().where(
            models.EncounterTeam.encounter_id == models.Encounter.id,
            models.EncounterTeam.active.is_(True),
            models.EncounterTeam.team_id.not_in(team_ids),
        )
        result = await session.execute(
            sa.select(models.Encounter)
            .where(models.Encounter.slot_count == len(team_ids), ~strangers, *seated)
            .order_by(models.Encounter.id)
        )
        return result.scalars().all()

    async def active_team_ids(self, session: AsyncSession, encounter_id: int) -> set[int]:
        """Source tournament teams seated in the encounter right now."""
        result = await session.execute(
            sa.select(models.EncounterTeam.team_id).where(
                models.EncounterTeam.encounter_id == encounter_id,
                models.EncounterTeam.active.is_(True),
                models.EncounterTeam.team_id.is_not(None),
            )
        )
        return set(result.scalars().all())

    async def bracket_positions(
        self, session: AsyncSession, encounter_ids: typing.Sequence[int]
    ) -> dict[int, tuple[int | None, int]]:
        """``encounter_id -> (stage_id, round)``; an encounter outside any bracket has no entry."""
        result = await session.execute(
            sa.select(
                models.BracketEncounter.encounter_id, models.BracketEncounter.stage_id, models.BracketEncounter.round
            ).where(models.BracketEncounter.encounter_id.in_(encounter_ids))
        )
        return {encounter_id: (stage_id, round_) for encounter_id, stage_id, round_ in result}

    async def encounter_ids_with_log(
        self, session: AsyncSession, encounter_ids: typing.Sequence[int], log_name: str
    ) -> set[int]:
        """Which of ``encounter_ids`` already hold a map parsed from ``log_name``."""
        result = await session.execute(
            sa.select(models.Match.encounter_id)
            .where(models.Match.encounter_id.in_(encounter_ids), models.Match.log_name == log_name)
            .distinct()
        )
        return set(result.scalars().all())

    async def encounter_ids_with_map(
        self, session: AsyncSession, encounter_ids: typing.Sequence[int], map_id: int
    ) -> set[int]:
        """Which of ``encounter_ids`` already hold a parsed match on ``map_id``."""
        result = await session.execute(
            sa.select(models.Match.encounter_id)
            .where(models.Match.encounter_id.in_(encounter_ids), models.Match.map_id == map_id)
            .distinct()
        )
        return set(result.scalars().all())

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
list_by_teams = encounter_service.list_by_teams
active_team_ids = encounter_service.active_team_ids
bracket_positions = encounter_service.bracket_positions
encounter_ids_with_log = encounter_service.encounter_ids_with_log
encounter_ids_with_map = encounter_service.encounter_ids_with_map
create_match = encounter_service.create_match
