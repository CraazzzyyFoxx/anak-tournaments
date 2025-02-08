import typing
from datetime import UTC, datetime

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models, schemas
from src.core import utils


def user_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[_AbstractLoad]:
    entities = []
    if "battle_tag" in in_entities:
        entities.append(utils.join_entity(child, models.User.battle_tag))
    if "discord" in in_entities:
        entities.append(utils.join_entity(child, models.User.discord))
    if "twitch" in in_entities:
        entities.append(utils.join_entity(child, models.User.twitch))
    return entities


def join_entities(query: sa.Select, in_entities: list[str]) -> sa.Select:
    if "battle_tag" in in_entities:
        query = query.join(
            models.UserBattleTag, models.User.id == models.UserBattleTag.user_id
        )
    if "discord" in in_entities:
        query = query.join(
            models.UserDiscord, models.User.id == models.UserDiscord.user_id
        )
    if "twitch" in in_entities:
        query = query.join(
            models.UserTwitch, models.User.id == models.UserTwitch.user_id
        )

    return query


async def get(
    session: AsyncSession, user_id: int, entities: list[str]
) -> models.User | None:
    query = (
        sa.select(models.User)
        .options(*user_entities(entities))
        .where(sa.and_(models.User.id == user_id))
    )
    result = await session.execute(query)
    return result.unique().scalar_one_or_none()


async def get_by_battle_tag(
    session: AsyncSession, battle_tag: str, entities: list[str]
) -> models.User | None:
    query = (
        sa.select(models.User)
        .options(*user_entities(entities))
        .join(models.UserBattleTag, models.User.id == models.UserBattleTag.user_id)
        .where(
            sa.and_(
                models.UserBattleTag.battle_tag == battle_tag,
            )
        )
    )
    result = await session.execute(query)
    return result.unique().scalar_one_or_none()


async def find_by_csv(
    session: AsyncSession, data_in: schemas.UserCSV
) -> models.User | None:
    clauses = []
    if data_in.battle_tag:
        clauses.append(models.UserBattleTag.battle_tag == data_in.battle_tag)
        clauses.append(
            sa.func.initcap(models.UserBattleTag.battle_tag) == data_in.battle_tag
        )
    if data_in.discord:
        clauses.append(models.UserDiscord.name == data_in.discord)

    query = (
        sa.select(models.User)
        .join(
            models.UserDiscord,
            models.User.id == models.UserDiscord.user_id,
            isouter=True,
        )
        .join(models.UserBattleTag, models.User.id == models.UserBattleTag.user_id)
        .where(
            sa.or_(
                sa.or_(
                    models.User.name == data_in.battle_tag,
                    models.User.name == data_in.battle_tag.capitalize(),
                    sa.func.initcap(models.User.name) == data_in.battle_tag,
                ),
                sa.or_(*clauses),
            )
        )
    )
    result = await session.scalars(query)
    player = result.unique().first()

    if player:
        return player

    twitch_query = (
        sa.select(models.User)
        .join(models.UserTwitch, models.User.id == models.UserTwitch.user_id)
        .where(
            sa.or_(
                models.UserTwitch.name == data_in.twitch,
                (
                    sa.func.upper(sa.func.left(models.UserTwitch.name, 1)).cast(
                        sa.String
                    )
                    + sa.func.lower(sa.func.substring(models.UserTwitch.name, 2)).cast(
                        sa.String
                    )
                )
                == data_in.twitch.capitalize(),
                sa.func.initcap(models.UserTwitch.name) == data_in.twitch,
                models.UserTwitch.name == data_in.twitch.capitalize(),
                (
                    sa.func.upper(sa.func.left(models.UserTwitch.name, 1)).cast(
                        sa.String
                    )
                    + sa.func.lower(sa.func.substring(models.UserTwitch.name, 2)).cast(
                        sa.String
                    )
                )
                == data_in.battle_tag,
            )
        )
    )
    result_by_twitch = await session.scalars(twitch_query)
    player_by_twitch = result_by_twitch.unique().first()
    if player_by_twitch:
        return player_by_twitch

    if data_in.smurfs:
        smurf_clauses = []
        for smurf in data_in.smurfs:
            smurf_clauses.append(models.UserBattleTag.battle_tag == smurf)
            smurf_clauses.append(
                sa.func.initcap(models.UserBattleTag.battle_tag) == smurf
            )

        smurf_query = (
            sa.select(models.User)
            .join(models.UserBattleTag, models.User.id == models.UserBattleTag.user_id)
            .where(sa.or_(*smurf_clauses))
        )
        result_by_smurf = await session.scalars(smurf_query)
        return result_by_smurf.unique().first()

    return None


async def find_by_battle_tag(
    session: AsyncSession, battle_tag: str, entities: list[str]
) -> models.User | None:
    query = (
        sa.select(models.User)
        .options(*user_entities(entities))
        .where(
            sa.or_(
                models.User.name == battle_tag,
                sa.func.initcap(models.User.name) == battle_tag,
            )
        )
    )
    result = await session.scalars(query)
    user = result.unique().first()
    if user:
        return await get(session, user.id, ["battle_tag", "twitch", "discord"])

    battle_tag_query = (
        sa.select(models.User)
        .join(models.UserBattleTag, models.User.id == models.UserBattleTag.user_id)
        .where(
            sa.or_(
                models.UserBattleTag.battle_tag == battle_tag,
                sa.func.initcap(models.UserBattleTag.battle_tag) == battle_tag,
                sa.func.lower(models.UserBattleTag.battle_tag) == battle_tag,
                models.UserBattleTag.name == battle_tag,
                sa.func.initcap(models.UserBattleTag.name) == battle_tag,
                sa.func.lower(models.UserBattleTag.name) == battle_tag,
            )
        )
    )
    result_by_battle_tag = await session.scalars(battle_tag_query)
    user = result_by_battle_tag.unique().first()
    if user:
        return await get(session, user.id, ["battle_tag", "twitch", "discord"])

    return None


async def get_battle_tag(
    session: AsyncSession, battle_tag: str
) -> models.UserBattleTag | None:
    query = sa.select(models.UserBattleTag).where(
        sa.or_(
            models.UserBattleTag.battle_tag == battle_tag,
            sa.func.initcap(models.UserBattleTag.battle_tag) == battle_tag,
        )
    )
    result = await session.execute(query)
    return result.unique().first()


async def get_discord(session: AsyncSession, discord: str) -> models.UserDiscord | None:
    query = sa.select(models.UserDiscord).where(
        sa.and_(models.UserDiscord.name == discord)
    )
    result = await session.execute(query)
    return result.unique().first()


async def get_twitch(session: AsyncSession, twitch: str) -> models.UserTwitch | None:
    query = sa.select(models.UserTwitch).where(
        sa.and_(models.UserTwitch.name == twitch)
    )
    result = await session.execute(query)
    return result.unique().first()


async def create(
    session: AsyncSession,
    *,
    battle_tag: str,
    discord: str | None,
    twitch: str,
) -> models.User:
    player = models.User(name=battle_tag)
    session.add(player)
    await session.commit()
    logger.info(f"Player created [id={player.id} name={battle_tag}]")
    try:
        name, tag = battle_tag.split("#")
        await create_battle_tag(
            session, player, battle_tag=battle_tag, name=name, tag=tag
        )
    except ValueError:
        pass
    if discord:
        await create_discord(session, player, discord=discord)
    if twitch:
        await create_twitch(session, player, twitch=twitch)
    return await get(session, player.id, ["battle_tag", "twitch", "discord"])


async def create_battle_tag(
    session: AsyncSession,
    player: models.User,
    *,
    battle_tag: str,
    name: str,
    tag: str,
) -> models.UserBattleTag:
    player_battle_tag = models.UserBattleTag(
        user_id=player.id,
        battle_tag=battle_tag,
        name=name,
        tag=tag,
    )
    session.add(player_battle_tag)
    await session.commit()
    logger.info(
        f"Battle Tag created [tag={battle_tag}] for player [id={player.id} name={name}]"
    )
    return player_battle_tag


def create_battle_tag_sync(
    session: Session,
    player: models.User,
    *,
    battle_tag: str,
    name: str,
    tag: str,
) -> models.UserBattleTag:
    player_battle_tag = models.UserBattleTag(
        user_id=player.id,
        battle_tag=battle_tag,
        name=name,
        tag=tag,
    )
    session.add(player_battle_tag)
    session.commit()
    logger.info(
        f"Battle Tag created [tag={battle_tag}] for player [id={player.id} name={name}]"
    )
    return player_battle_tag


async def create_discord(
    session: AsyncSession,
    player: models.User,
    *,
    discord: str,
) -> models.UserDiscord:
    player_discord = models.UserDiscord(
        user_id=player.id,
        name=discord,
    )
    session.add(player_discord)
    await session.commit()
    logger.info(
        f"Discord created [discord={discord}] for player [id={player.id} name={player.name}]"
    )
    return player_discord


async def update_discord(
    session: AsyncSession,
    discord: models.UserDiscord,
    *,
    name: str,
) -> models.UserDiscord:
    discord.name = name
    discord.updated_at = datetime.now(UTC)
    await session.commit()
    logger.info(f"Discord updated [id={discord.id} name={name}]")
    return discord


async def create_twitch(
    session: AsyncSession,
    player: models.User,
    *,
    twitch: str,
) -> models.UserTwitch:
    player_twitch = models.UserTwitch(
        user_id=player.id,
        name=twitch,
    )
    session.add(player_twitch)
    await session.commit()
    logger.info(
        f"Twitch created [twitch={twitch}] for player [id={player.id} name={player.name}]"
    )
    return player_twitch


async def update_twitch(
    session: AsyncSession,
    twitch: models.UserTwitch,
    *,
    name: str,
) -> models.UserTwitch:
    twitch.updated_at = datetime.now(UTC)
    twitch.name = name
    await session.commit()
    logger.info(f"Twitch updated [id={twitch.id} name={name}]")
    return twitch


async def update(
    session: AsyncSession,
    user: models.User,
    *,
    name: str,
) -> models.User:
    user.name = name
    await session.commit()
    logger.info(f"Player updated [id={user.id} name={name}]")
    return user
