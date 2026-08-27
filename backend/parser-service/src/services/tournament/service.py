import typing
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import TournamentRepository
from shared.services.tournament.slug import generate_unique_tournament_slug
from src import models
from src.core import utils


def tournament_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[sa.orm.strategy_options._AbstractLoad]:
    entities = []
    if "stages" in in_entities:
        stage_entity = utils.join_entity(child, models.Tournament.stages)
        stage_items_entity = utils.join_entity(stage_entity, models.Stage.items)
        entities.append(stage_entity)
        entities.append(stage_items_entity)
        entities.append(utils.join_entity(stage_items_entity, models.StageItem.inputs))
    return entities


class TournamentService:
    def __init__(
        self,
        *,
        tournament_repo: TournamentRepository = TournamentRepository(),
    ) -> None:
        self.tournament_repo = tournament_repo

    async def get(self, session: AsyncSession, id: int, entities: list[str]) -> models.Tournament | None:
        return await self.tournament_repo.get(session, id, options=tournament_entities(entities))

    async def get_all(
        self,
        session: AsyncSession,
        is_league: bool | None = None,
        is_finished: bool | None = None,
        entities: list[str] | None = None,
        workspace_id: int | None = None,
    ) -> typing.Sequence[models.Tournament]:
        return await self.tournament_repo.list_filtered(
            session,
            is_league=is_league,
            is_finished=is_finished,
            workspace_id=workspace_id,
            options=tournament_entities(entities or []),
        )

    async def get_by_name_and_league(
        self, session: AsyncSession, workspace_id: int, name: str, is_league: bool, entities: list[str]
    ) -> models.Tournament | None:
        return await self.tournament_repo.get_by(
            session,
            options=tournament_entities(entities),
            workspace_id=workspace_id,
            name=name,
            is_league=is_league,
        )

    async def create(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        is_league: bool,
        name: str,
        description: str | None = None,
        start_date: datetime | date | None = None,
        end_date: datetime | date | None = None,
        division_grid_version_id: int | None = None,
    ) -> models.Tournament:
        # The deprecated tournament.challonge_id/slug columns are no longer written:
        # the tournament↔Challonge link lives in the normalized challonge_source
        # (source_type='tournament') created by the caller (admin link / import).
        tournament = models.Tournament(
            workspace_id=workspace_id,
            is_league=is_league,
            name=name,
            slug=await generate_unique_tournament_slug(session, name, tournament_repo=self.tournament_repo),
            description=description,
            start_date=start_date,
            end_date=end_date,
            division_grid_version_id=division_grid_version_id,
        )
        await self.tournament_repo.create(session, tournament)
        await session.commit()
        return tournament


tournament_service = TournamentService()
get = tournament_service.get
get_all = tournament_service.get_all
get_by_name_and_league = tournament_service.get_by_name_and_league
create = tournament_service.create
