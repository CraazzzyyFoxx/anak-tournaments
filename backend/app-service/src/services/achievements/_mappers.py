"""ORM → narrow DTO conversion helpers for achievements/ flows."""

from __future__ import annotations

from shared.repository.stats_reads import MatchReadContext
from src import models, schemas
from src.schemas.base import Score


def to_tournament_link(
    tournament: models.Tournament,
) -> schemas.AchievementTournamentLink:
    return schemas.AchievementTournamentLink(
        id=tournament.id,
        name=tournament.name,
        is_league=tournament.is_league,
    )


def _team_ref(team: models.Team | None) -> schemas.AchievementMatchTeamRef | None:
    if team is None:
        return None
    return schemas.AchievementMatchTeamRef(id=team.id, name=team.name, image_url=team.image_url)


def to_match_link(context: MatchReadContext) -> schemas.AchievementMatchLink:
    return schemas.AchievementMatchLink(
        id=context.match.id,
        encounter_id=context.encounter.id,
        map_id=context.match.map_entity_id,
        score=Score(home=context.home_score, away=context.away_score),
        log_name=context.display_filename,
        time=context.match.duration_s,
        home_team=_team_ref(context.home_team),
        away_team=_team_ref(context.away_team),
    )


def to_entity_read(entity: models.CatalogEntity) -> schemas.CatalogEntityRead:
    """A rule's linked character as the catalog's own entity DTO (never expands ``parent``: a character has none)."""
    return schemas.CatalogEntityRead.from_entity(entity, with_parent=False)
