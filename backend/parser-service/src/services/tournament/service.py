import typing
from dataclasses import dataclass
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import (
    StageItemRepository,
    StageRepository,
    TournamentGroupRepository,
    TournamentRepository,
)
from shared.services.tournament_slug import generate_unique_tournament_slug
from src import models
from src.core import enums, utils


def tournament_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[sa.orm.strategy_options._AbstractLoad]:
    entities = []
    if "groups" in in_entities:
        entities.append(utils.join_entity(child, models.Tournament.groups))
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
        tournament_group_repo: TournamentGroupRepository = TournamentGroupRepository(),
    ) -> None:
        self.tournament_repo = tournament_repo
        self.stage_repo = stage_repo
        self.stage_item_repo = stage_item_repo
        self.tournament_group_repo = tournament_group_repo

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
    ) -> list[models.TournamentGroup]:
        """Create legacy TournamentGroups AND their corresponding Stage/StageItems.

        Ensures every new group is immediately part of the new stage model so that
        encounters attached to these groups render correctly on the public bracket
        view (which filters by stage_id/stage_item_id).

        Batched counterpart of ``create_group``: one max-order SELECT, two batched
        creates and a single commit for the whole set instead of one SELECT + commit
        per group. Stage orders are assigned sequentially in ``specs`` order, exactly
        as repeated ``create_group`` calls would have done.
        """
        if not specs:
            return []

        # 1. Determine stage order: highest existing stage order in this tournament + 1
        next_order = await self.stage_repo.get_next_order(session, tournament.id)

        stages: list[models.Stage] = []
        for offset, spec in enumerate(specs):
            stage_type = enums.StageType.ROUND_ROBIN if spec.is_groups else enums.StageType.DOUBLE_ELIMINATION
            # The deprecated stage.challonge_id/slug columns are no longer written
            # (the stage↔Challonge link is derived from challonge_source). The group's
            # own challonge_id/slug below is KEPT: it stores Challonge's per-group
            # match.group_id used to route matches to the local group and has no
            # challonge_source equivalent.
            stages.append(
                models.Stage(
                    tournament_id=tournament.id,
                    name=spec.name,
                    description=spec.description,
                    stage_type=stage_type,
                    order=next_order + offset,
                )
            )
        await self.stage_repo.create_many(session, stages)

        stage_items: list[models.StageItem] = []
        groups: list[models.TournamentGroup] = []
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
            groups.append(
                models.TournamentGroup(
                    tournament=tournament,
                    name=spec.name,
                    description=spec.description,
                    is_groups=spec.is_groups,
                    challonge_id=spec.challonge_id,
                    challonge_slug=spec.challonge_slug,
                    stage_id=stage.id,
                )
            )
        await self.stage_item_repo.create_many(session, stage_items)
        await self.tournament_group_repo.create_many(session, groups)

        await session.commit()
        return groups


tournament_service = TournamentService()
get = tournament_service.get
get_all = tournament_service.get_all
get_by_name_and_league = tournament_service.get_by_name_and_league
create = tournament_service.create
create_groups = tournament_service.create_groups
