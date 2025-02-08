from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from src import models, schemas
from src.core import enums, errors
from src.services.challonge import service as challonge_service
from src.services.team import flows as team_flows
from src.services.tournament import flows as tournament_flows
from src.services.tournament import service as tournament_service

from . import service


async def get_by_teams_ids(
    session: AsyncSession,
    home_team_id: int,
    away_team_id: int,
    entities: list[str],
    *,
    has_closeness: bool | None = None,
) -> models.Encounter:
    encounter = await service.get_by_teams(
        session, home_team_id, away_team_id, entities, has_closeness=has_closeness
    )
    if not encounter:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Encounter with teams [{home_team_id}, {away_team_id}] not found",
                )
            ],
        )
    return encounter


def get_by_teams_ids_sync(
    session: Session, home_team_id: int, away_team_id: int
) -> models.Encounter:
    encounter = service.get_by_teams_sync(session, home_team_id, away_team_id, [])
    if not encounter:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Encounter with teams [{home_team_id}, {away_team_id}] not found",
                )
            ],
        )
    return encounter


async def _create_encounter_from_challonge(
    session: AsyncSession,
    tournament: models.Tournament,
    group_id: int,
    match: schemas.ChallongeMatch,
) -> models.Encounter:
    home_team = await team_flows.get_by_tournament_challonge_id(
        session, tournament.id, match.player1_id, []
    )
    away_team = await team_flows.get_by_tournament_challonge_id(
        session, tournament.id, match.player2_id, []
    )
    try:
        home_score, away_score = map(int, match.scores_csv.split("-"))
    except ValueError:
        home_score, away_score = 0, 0
    name = f"{home_team.name} vs {away_team.name}"
    existed = await service.get_by_challonge_id(session, match.id, [])
    if existed:
        logger.info(
            f"Encounter [name={existed.name}] already exists in tournament "
            f"[id={tournament.id} number={tournament.number}]. Skipping..."
        )
        return existed
    match_db = await service.create(
        session,
        name=name,
        home_team=home_team,
        away_team=away_team,
        home_score=home_score,
        away_score=away_score,
        round=match.round,
        tournament=tournament,
        group_id=group_id,
        challonge_id=match.id,
        status=enums.EncounterStatus(match.state),
    )
    logger.info(
        f"Encounter [name={match_db.name}] created in tournament "
        f"[id={tournament.id} number={tournament.number}]"
    )
    return match_db


async def bulk_create_for_tournament_from_challonge(
    session: AsyncSession,
    tournament_id: int,
    skip_finals: bool = False,
) -> None:
    tournament = await tournament_flows.get(session, tournament_id, ["groups"])
    if not tournament.challonge_id:
        for group in tournament.groups:
            matches = await challonge_service.fetch_matches(group.challonge_id)
            for match in matches:
                if match.group_id is None and skip_finals:
                    continue
                await _create_encounter_from_challonge(
                    session, tournament, group.id, match
                )
    else:
        matches = await challonge_service.fetch_matches(tournament.challonge_id)
        groups_dict = {group.challonge_id: group.id for group in tournament.groups}

        for match in matches:
            if match.group_id is None and len(groups_dict.keys()) == 1:
                group_id = list(groups_dict.values())[0]
            else:
                group_id = groups_dict[match.group_id]

            if match.group_id is None and skip_finals:
                continue

            await _create_encounter_from_challonge(session, tournament, group_id, match)


async def bulk_create_for_from_challonge(session: AsyncSession) -> None:
    tournaments = await tournament_service.get_all(session)
    for tournament in tournaments:
        if tournament.id == 4:
            continue  # In this tournament we have two brackets, but the first bracket is not finished.
            # Suz Playoffs filled manually
        await bulk_create_for_tournament_from_challonge(session, tournament.id)


def create_match(
    session: Session,
    encounter: models.Encounter,
    *,
    time: int,
    map: models.Map,
    log_name: str,
    home_team_id: int,
    away_team_id: int,
    home_score: int,
    away_score: int,
) -> models.Match:
    match = service.get_match_by_encounter_and_map(session, encounter.id, map.id, [])
    if match:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="already_exists",
                    msg=f"Match with encounter {encounter.id} and map {map.id} already exists",
                )
            ],
        )
    return service.create_match(
        session,
        encounter=encounter,
        time=time,
        map=map,
        log_name=log_name,
        home_team_id=home_team_id,
        away_team_id=away_team_id,
        home_score=home_score,
        away_score=away_score,
    )
