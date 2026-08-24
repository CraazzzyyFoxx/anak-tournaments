import typing
from dataclasses import dataclass
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import (
    StageItemRepository,
    StageRepository,
    TournamentRepository,
)
from shared.services.tournament.slug import generate_unique_tournament_slug
from src import models
from src.core import enums, utils


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


@dataclass(frozen=True)
class GroupSpec:
    """Plain-value description of one group to create (see ``create_groups``)."""

    name: str
    is_groups: bool
    description: str | None = None
    challonge_id: int | None = None
    challonge_slug: str | None = None


class TournamentService:
    def __init__(
        self,
        *,
        tournament_repo: TournamentRepository = TournamentRepository(),
        stage_repo: StageRepository = StageRepository(),
        stage_item_repo: StageItemRepository = StageItemRepository(),
    ) -> None:
        self.tournament_repo = tournament_repo
        self.stage_repo = stage_repo
        self.stage_item_repo = stage_item_repo

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

    async def create_groups(
        self,
        session: AsyncSession,
        tournament: models.Tournament,
        specs: list[GroupSpec],
    ) -> list[models.Stage]:
        """Create Stage + StageItem rows for each group spec. No TournamentGroup rows."""
        if not specs:
            return []

        next_order = await self.stage_repo.get_next_order(session, tournament.id)

        stages: list[models.Stage] = []
        for offset, spec in enumerate(specs):
            stage_type = enums.StageType.ROUND_ROBIN if spec.is_groups else enums.StageType.DOUBLE_ELIMINATION
            settings = {"challonge_group_id": spec.challonge_id} if spec.challonge_id is not None else None
            stages.append(
                models.Stage(
                    tournament_id=tournament.id,
                    name=spec.name,
                    description=spec.description,
                    stage_type=stage_type,
                    order=next_order + offset,
                    settings_json=settings,
                )
            )
        await self.stage_repo.create_many(session, stages)

        stage_items: list[models.StageItem] = []
        for spec, stage in zip(specs, stages, strict=True):
            stage_item_type = enums.StageItemType.GROUP if spec.is_groups else enums.StageItemType.SINGLE_BRACKET
            stage_items.append(
                models.StageItem(
                    stage_id=stage.id,
                    name=spec.name,
                    type=stage_item_type,
                    order=0,
                )
            )
        await self.stage_item_repo.create_many(session, stage_items)

        await session.commit()
        return stages


tournament_service = TournamentService()
get = tournament_service.get
get_all = tournament_service.get_all
get_by_name_and_league = tournament_service.get_by_name_and_league
create = tournament_service.create
create_groups = tournament_service.create_groups
