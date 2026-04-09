import typing
from datetime import datetime, date

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import utils


def tournament_entities(
        in_entities: list[str], child: typing.Any | None = None
) -> list[sa.orm.strategy_options._AbstractLoad]:
    entities = []
    if "groups" in in_entities:
        entities.append(utils.join_entity(child, models.Tournament.groups))
    return entities


async def get(session: AsyncSession, id: int, entities: list[str]) -> models.Tournament | None:
    query = (
        sa.select(models.Tournament).where(sa.and_(models.Tournament.id == id)).options(*tournament_entities(entities))
    )
    result = await session.execute(query)
    return result.unique().scalars().first()


async def get_all(
    session: AsyncSession,
    is_league: bool | None = None,
    is_finished: bool | None = None,
    entities: list[str] | None = None,
    workspace_id: int | None = None,
) -> typing.Sequence[models.Tournament]:
    query = (
        sa.select(models.Tournament)
        .options(*tournament_entities(entities or []))
        .order_by(models.Tournament.id.asc())
    )

    if is_league is not None:
        query = query.where(models.Tournament.is_league.is_(is_league))
    if is_finished is not None:
        query = query.where(models.Tournament.is_finished.is_(is_finished))
    if workspace_id is not None:
        query = query.where(models.Tournament.workspace_id == workspace_id)

    result = await session.execute(query)
    return result.unique().scalars().all()


async def get_by_number(session: AsyncSession, number: int, entities: list[str]) -> models.Tournament | None:
    query = (
        sa.select(models.Tournament)
        .where(sa.and_(models.Tournament.number == number))
        .options(*tournament_entities(entities))
    )
    result = await session.execute(query)
    return result.unique().scalars().first()


async def get_by_number_and_league(
    session: AsyncSession, number: int, is_league: bool, entities: list[str]
) -> models.Tournament | None:
    query = (
        sa.select(models.Tournament)
        .where(
            sa.and_(
                models.Tournament.number == number,
                models.Tournament.is_league == is_league,
            )
        )
        .options(*tournament_entities(entities))
    )
    result = await session.execute(query)
    return result.unique().scalars().first()


async def get_by_name(session: AsyncSession, name: str, entities: list[str]) -> models.Tournament | None:
    query = (
        sa.select(models.Tournament)
        .where(sa.and_(models.Tournament.name == name))
        .options(*tournament_entities(entities))
    )
    result = await session.execute(query)
    return result.unique().scalars().first()


async def create(
    session: AsyncSession,
    *,
    number: int,
    is_league: bool,
    name: str,
    description: str | None = None,
    challonge_id: int | None = None,
    challonge_slug: str | None = None,
    start_date: datetime | date | None = None,
    end_date: datetime | date | None = None,
) -> models.Tournament:
    tournament = models.Tournament(
        number=number,
        is_league=is_league,
        name=name,
        description=description,
        challonge_id=challonge_id,
        challonge_slug=challonge_slug,
        start_date=start_date,
        end_date=end_date
    )
    session.add(tournament)
    await session.commit()
    return tournament


async def create_group(
    session: AsyncSession,
    tournament: models.Tournament,
    *,
    name: str,
    description: str | None = None,
    is_groups: bool = False,
    challonge_id: int | None = None,
    challonge_slug: str | None = None,
) -> models.TournamentGroup:
    group = models.TournamentGroup(
        tournament=tournament,
        name=name,
        description=description,
        is_groups=is_groups,
        challonge_id=challonge_id,
        challonge_slug=challonge_slug,
    )
    session.add(group)
    await session.commit()
    return group
