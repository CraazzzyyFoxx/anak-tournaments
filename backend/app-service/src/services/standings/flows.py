import typing

from shared.services.tournament_utils import is_completed_encounter, sort_bracket_matches
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import utils
from src.services.encounter import flows as encounter_flows
from src.services.team import flows as team_flows
from src.services.tournament import flows as tournament_flows

from . import service


def sort_matches(
    matches: typing.Sequence[schemas.EncounterRead],
) -> list[schemas.EncounterRead]:
    """Phase E: delegate to shared utility (removes drift from parser-service)."""
    return sort_bracket_matches(matches)


async def to_pydantic(
    session: AsyncSession, standing: models.Standing, entities: list[str]
) -> schemas.StandingRead:
    """
    Converts a Standing model instance to a Pydantic schema (StandingRead), including related entities.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        standing (models.Standing): The Standing model instance to convert.
        entities (list[str]): A list of related entities to include (e.g., ["team", "group", "tournament", "matches_history"]).

    Returns:
        schemas.StandingRead: The Pydantic schema representing the standing.
    """
    team: schemas.TeamRead | None = None
    stage: schemas.StageRead | None = None
    stage_item: schemas.StageItemRead | None = None
    tournament: schemas.TournamentRead | None = None
    matches_history: list[schemas.EncounterRead] = []

    if "team" in entities:
        team = await team_flows.to_pydantic(
            session, standing.team, utils.prepare_entities(entities, "team")
        )
    if "stage" in entities and standing.stage is not None:
        stage = schemas.StageRead.model_validate(standing.stage, from_attributes=True)
    if "stage_item" in entities and standing.stage_item is not None:
        stage_item = schemas.StageItemRead.model_validate(
            standing.stage_item, from_attributes=True
        )
    if "tournament" in entities:
        tournament = await tournament_flows.to_pydantic(
            session, standing.tournament, []
        )
    if "matches_history" in entities:
        team_matches = await encounter_flows.get_encounters_by_team(
            session, standing.team_id, ["teams", "stage", "stage_item"]
        )
        matches_history = [
            encounter
            for encounter in team_matches
            if encounter.stage_id == standing.stage_id
            and (
                standing.stage_item_id is None
                or encounter.stage_item_id == standing.stage_item_id
            )
            and is_completed_encounter(encounter)
        ]

    source_rule_profile = None
    if standing.stage is not None and isinstance(standing.stage.settings_json, dict):
        ranking_preset = standing.stage.settings_json.get("ranking_preset")
        if isinstance(ranking_preset, str):
            source_rule_profile = ranking_preset

    return schemas.StandingRead(
        **standing.to_dict(),
        team=team,
        stage=stage,
        stage_item=stage_item,
        tournament=tournament,
        ranking_context={
            "stage_type": standing.stage.stage_type.value if standing.stage else None,
            "stage_name": standing.stage.name if standing.stage else None,
            "stage_item_name": standing.stage_item.name if standing.stage_item else None,
        },
        tb_metrics={
            "points": standing.points,
            "match_wins": standing.win,
            "head_to_head": standing.tb,
            "median_buchholz": standing.buchholz,
            "score_differential": standing.win * 2 - standing.lose,
        },
        source_rule_profile=source_rule_profile,
        matches_history=sort_matches(matches_history),
    )


async def get_by_tournament(
    session: AsyncSession, tournament: models.Tournament, entities: list[str]
) -> list[schemas.StandingRead]:
    """
    Retrieves all standings for a specific tournament and converts them to Pydantic schemas.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        tournament (models.Tournament): The Tournament model instance for which to retrieve standings.
        entities (list[str]): A list of related entities to include (e.g., ["team", "group", "tournament", "matches_history"]).

    Returns:
        list[schemas.StandingRead]: A list of Pydantic schemas representing the standings.
    """
    standings = await service.get_by_tournament(session, tournament, entities)
    return [await to_pydantic(session, standing, entities) for standing in standings]
