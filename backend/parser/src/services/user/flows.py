from sqlalchemy.ext.asyncio import AsyncSession

from src import schemas, models
from src.core import errors


from . import service


async def get(session: AsyncSession, user_id: int, entities: list[str]) -> models.User:
    user = await service.get(session, user_id, entities)
    if not user:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[errors.ApiExc(code="not_found", msg=f"User with id {user_id} not found.")],
        )
    return user


async def get_by_battle_tag(session: AsyncSession, battle_tag: str, entities: list[str]) -> models.User:
    user = await service.find_by_battle_tag(session, battle_tag, entities)
    if not user:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[errors.ApiExc(code="not_found", msg=f"User with battle tag {battle_tag} not found.")],
        )
    return user


async def find_by_battle_tag(session: AsyncSession, battle_tag: str) -> models.User:
    user = await service.find_by_battle_tag(session, battle_tag, [])
    if not user:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[errors.ApiExc(code="not_found", msg=f"User with battle tag {battle_tag} not found.")],
        )
    return user


async def create_or_ignore_battle_tags(session: AsyncSession, player: models.User, in_battle_tags: list[str]) -> None:
    battle_tags = [tag.battle_tag for tag in player.battle_tag]

    maybe_need_add_battle_tags = [tag for tag in in_battle_tags]
    for battle_tag in set(maybe_need_add_battle_tags):
        if battle_tag and battle_tag not in battle_tags and not await service.get_battle_tag(session, battle_tag):
            try:
                name, tag = battle_tag.split("#")
                await service.create_battle_tag(session, player, battle_tag=battle_tag, name=name, tag=tag)
            except ValueError:
                pass


async def create_or_ignore_discords(session: AsyncSession, player: models.User, in_discords: list[str]) -> None:
    discords = [discord.name for discord in player.discord]

    maybe_need_add_discords = [discord for discord in in_discords]
    for discord in set(maybe_need_add_discords):
        if discord and discord not in discords and not await service.get_discord(session, discord):
            await service.create_discord(session, player, discord=discord)


async def create_or_ignore_twitches(session: AsyncSession, player: models.User, in_twitches: list[str]) -> None:
    twitches = [twitch.name for twitch in player.twitch]

    maybe_need_add_twitches = [twitch for twitch in in_twitches]
    for twitch in set(maybe_need_add_twitches):
        if twitch and twitch not in twitches and not await service.get_twitch(session, twitch):
            await service.create_twitch(session, player, twitch=twitch)


async def create(session: AsyncSession, data_in: schemas.UserCSV) -> models.User:
    player_data = await service.find_by_csv(session, data_in)
    if not player_data:
        user = await service.create(
            session,
            battle_tag=data_in.battle_tag,
            discord=data_in.discord,
            twitch=data_in.twitch,
        )
        await create_or_ignore_battle_tags(session, user, [*data_in.smurfs, data_in.battle_tag])
    else:
        user = await get(session, player_data.id, ["battle_tag", "twitch", "discord"])
        await create_or_ignore_battle_tags(session, user, [*data_in.smurfs, data_in.battle_tag])
        await service.update(session, user, name=data_in.battle_tag)

        twitch_names: dict[str, models.UserTwitch] = {twitch.name: twitch for twitch in user.twitch}
        discord_names: dict[str, models.UserDiscord] = {discord.name: discord for discord in user.discord}

        if data_in.twitch:
            if data_in.twitch not in twitch_names.keys():
                await service.create_twitch(session, user, twitch=data_in.twitch)
            else:
                await service.update_twitch(session, twitch_names[data_in.twitch], name=data_in.twitch)
        if data_in.discord:
            if data_in.discord not in discord_names.keys():
                await service.create_discord(session, user, discord=data_in.discord)
            else:
                await service.update_discord(session, discord_names[data_in.discord], name=data_in.discord)

    return await service.get(session, user.id, ["battle_tag", "twitch", "discord"])  # type: ignore
