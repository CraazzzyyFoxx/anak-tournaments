import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models


async def get_user_by_battle_name(session: AsyncSession, battle_name: str, verbose: bool = False) -> models.User | None:
    if verbose:
        query = (
            sa.select(models.User)
            .join(models.UserBattleTag, models.User.id == models.UserBattleTag.user_id)
            .where(
                sa.or_(
                    models.UserBattleTag.name == battle_name,
                    sa.func.initcap(models.UserBattleTag.name) == battle_name,
                    sa.func.lower(models.UserBattleTag.name) == battle_name,
                )
            )
        )
    else:
        query = (
            sa.select(models.User)
            .join(models.UserBattleTag, models.User.id == models.UserBattleTag.user_id)
            .where(
                sa.or_(
                    models.UserBattleTag.battle_tag == battle_name,
                    sa.func.initcap(models.UserBattleTag.battle_tag) == battle_name,
                )
            )
        )
    result = await session.scalars(query)
    return result.unique().first()


async def get_user_by_team_and_battle_name(
    session: AsyncSession, team: models.Team, battle_name: str, verbose: bool = False
) -> models.Player | None:
    if verbose:
        query = (
            sa.select(models.Player)
            .select_from(models.User)
            .join(models.UserBattleTag, models.User.id == models.UserBattleTag.user_id)
            .join(models.Player, models.User.id == models.Player.user_id)
            .where(
                sa.and_(
                    models.Player.team_id == team.id,
                    sa.or_(
                        models.UserBattleTag.name == battle_name,
                        sa.func.initcap(models.UserBattleTag.name) == battle_name,
                        sa.func.lower(models.UserBattleTag.name) == battle_name,
                    ),
                )
            )
        )
    else:
        query = (
            sa.select(models.Player)
            .select_from(models.User)
            .join(models.UserBattleTag, models.User.id == models.UserBattleTag.user_id)
            .join(models.Player, models.UserBattleTag.user_id == models.Player.user_id)
            .where(
                sa.and_(
                    models.Player.team_id == team.id,
                    sa.or_(
                        models.UserBattleTag.battle_tag == battle_name,
                        sa.func.initcap(models.UserBattleTag.battle_tag) == battle_name,
                    ),
                )
            )
        )
    result = await session.scalars(query)
    return result.unique().first()
