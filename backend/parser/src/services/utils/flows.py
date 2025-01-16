from loguru import logger

from sqlalchemy.ext.asyncio import AsyncSession

from src import schemas
from src.services.user import service as user_service
from src.services.user import flows as user_flows
from src.services.team import flows as team_flows

from  . import service

async def merge_users_with_dasha_users(session: AsyncSession, payload: list) -> None:
    users_to_merge = await service.get_users_from_dasha(payload)

    for user_id_mg, user_mg in users_to_merge.items():
        user_csv = schemas.UserCSV(
            battle_tag=user_mg.battle_tag,
            twitch=user_mg.twitch,
            discord=user_mg.discord,
            smurfs=user_mg.battle_tags
        )

        user_searched = await user_service.find_by_csv(session, user_csv)
        user = await user_service.get(session, user_searched.id, ["battle_tag", "discord", "twitch"])

        if user:
            logger.info(f"User with battle tag {user_mg.battle_tag} already exists.")
        else:
            created_user = await user_service.create(
                session,
                battle_tag=user_mg.battle_tag,
                discord=user_mg.discord,
                twitch=user_mg.twitch,
            )
            user = await user_service.get(session, created_user.id, ["battle_tag", "discord", "twitch"])

            logger.info(f"User with battle tag {user_mg.battle_tag} created.")

        await user_flows.create_or_ignore_battle_tags(session, user, user_mg.battle_tags)
        await user_flows.create_or_ignore_discords(session, user, user_mg.discords)
        await user_flows.create_or_ignore_twitches(session, user, user_mg.twitches)

        await session.commit()


async def create_teams_from_dasha(session: AsyncSession) -> None:
    teams_raw = await service.get_teams_from_dasha([])
    teams = await service.transform_dasha_teams_to_normal(teams_raw)

    for tournament_id, tournament_teams in teams.items():
        await team_flows.bulk_create_from_balancer(session, tournament_id, tournament_teams)

