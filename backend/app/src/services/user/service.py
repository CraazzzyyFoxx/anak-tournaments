import typing

import sqlalchemy as sa
from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models
from src.core import enums, pagination, utils
from src.services.team import service as team_service

home_score_case = sa.case(
    (models.Encounter.home_team_id == models.Team.id, models.Encounter.home_score),
    else_=models.Encounter.away_score,
)
away_score_case = sa.case(
    (models.Encounter.home_team_id == models.Team.id, models.Encounter.away_score),
    else_=models.Encounter.home_score,
)

winrate_sum = sa.func.sum(home_score_case) / (
    sa.func.sum(home_score_case) + sa.func.sum(away_score_case)
)


def user_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[_AbstractLoad]:
    """
    Constructs a list of SQLAlchemy load options for querying related entities of a `User` model.

    Args:
        in_entities: A list of strings representing the names of related entities to load.
        child: An optional SQLAlchemy relationship or join entity to chain the load options.

    Returns:
        A list of SQLAlchemy load options (`_AbstractLoad`) for the specified entities.
    """
    entities = []
    if "battle_tag" in in_entities:
        entities.append(utils.join_entity(child, models.User.battle_tag))
    if "discord" in in_entities:
        entities.append(utils.join_entity(child, models.User.discord))
    if "twitch" in in_entities:
        entities.append(utils.join_entity(child, models.User.twitch))
    return entities


def join_entities(query: sa.Select, in_entities: list[str]) -> sa.Select:
    """
    Joins related entities to a SQLAlchemy query based on the provided entity names.

    Args:
        query: The SQLAlchemy query to modify.
        in_entities: A list of strings representing the names of related entities to join.

    Returns:
        The modified SQLAlchemy query with the specified joins.
    """
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
    """
    Retrieves a `User` model instance by its ID, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `User` model instance if found, otherwise `None`.
    """
    query = (
        sa.select(models.User)
        .options(*user_entities(entities))
        .where(sa.and_(models.User.id == user_id))
    )
    result = await session.execute(query)
    return result.unique().scalar_one_or_none()


async def get_all(
    session: AsyncSession, params: pagination.SearchPaginationParams
) -> tuple[typing.Sequence[models.User], int]:
    """
    Retrieves a paginated list of `User` model instances based on filtering and sorting parameters.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        params: An instance of `SearchPaginationParams` containing pagination, sorting, and filtering parameters.

    Returns:
        A tuple containing:
        1. A sequence of `User` model instances.
        2. The total count of users matching the filtering criteria.
    """
    query = sa.select(models.User).options(*user_entities(params.entities))
    total_query = sa.select(sa.func.count(models.User.id))
    query = join_entities(query, params.entities)
    total_query = join_entities(total_query, params.entities)
    if params.query:
        query = params.apply_search(query, models.User)
        total_query = params.apply_search(total_query, models.User)

    query = params.apply_pagination_sort(query, models.User)

    result = await session.execute(query)
    result_total = await session.execute(total_query)
    return result.unique().scalars().all(), result_total.scalar_one()


async def find_by_battle_tag(
    session: AsyncSession, battle_tag: str, entities: list[str]
) -> models.User | None:
    """
    Retrieves a `User` model instance by its battle tag, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        battle_tag: The battle tag of the user to retrieve.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `User` model instance if found, otherwise `None`.
    """
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
        return await get(session, user.id, entities)

    return None


async def get_overall_statistics(
    session: AsyncSession, user_id: int
) -> tuple[int, int, int]:
    """
    Retrieves overall statistics for a user, including maps won, maps lost, and average closeness.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve statistics for.

    Returns:
        A tuple containing:
        1. The number of maps won.
        2. The number of maps lost.
        3. The average closeness of encounters.
    """
    query = (
        sa.select(
            sa.func.sum(home_score_case).label("won_maps"),
            sa.func.sum(away_score_case).label("lost_maps"),
            sa.func.avg(models.Encounter.closeness).label("closeness"),
        )
        .select_from(models.Player)
        .join(models.Team, models.Team.id == models.Player.team_id)
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == models.Team.id,
                models.Encounter.away_team_id == models.Team.id,
            ),
        )
        .where(
            sa.and_(
                models.Player.is_substitution.is_(False),
                models.Player.user_id == user_id,
            )
        )
        .group_by(models.Player.user_id)
    )

    matches = await session.execute(query)
    return matches.first()


async def get_teams(
    session: AsyncSession, user_id: int, params: pagination.PaginationParams
) -> tuple[typing.Sequence[models.Team], int]:
    """
    Retrieves a paginated list of teams associated with a user, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve teams for.
        params: An instance of `PaginationParams` containing pagination parameters.

    Returns:
        A tuple containing:
        1. A sequence of `Team` model instances.
        2. The total count of teams associated with the user.
    """
    total_query = (
        sa.select(sa.func.count(models.Team.id))
        .join(models.Player, models.Player.team_id == models.Team.id)
        .where(
            sa.and_(
                models.Player.user_id == user_id,
                models.Player.is_substitution.is_(False),
            )
        )
    )

    query = (
        sa.select(models.Team)
        .options(*team_service.team_entities(params.entities))
        .join(models.Player, models.Player.team_id == models.Team.id)
        .join(models.Tournament, models.Tournament.id == models.Team.tournament_id)
        .where(
            sa.and_(
                models.Player.user_id == user_id,
                models.Player.is_substitution.is_(False),
                models.Tournament.is_finished.is_(True),
            )
        )
    )
    query = params.apply_pagination_sort(query, models.Team)
    result = await session.scalars(query)
    result_total = await session.execute(total_query)
    return result.unique().all(), result_total.scalar_one()


async def get_roles(
    session: AsyncSession, user_id: int
) -> typing.Sequence[tuple[enums.HeroClass, int, int, list[dict]]]:
    """
    Retrieves the roles and statistics for a user across tournaments.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve roles for.

    Returns:
        A sequence of tuples containing:
        1. The role (e.g., tank, damage, support).
        2. The number of maps won.
        3. The number of maps lost.
        4. A list of dictionaries containing tournament and division information.
    """
    query = (
        sa.select(
            models.Player.role,
            sa.func.sum(home_score_case).label("won_maps"),
            sa.func.sum(away_score_case).label("lost_maps"),
            sa.func.jsonb_agg(
                sa.func.jsonb_build_object(
                    "tournament",
                    models.Team.tournament_id,
                    "division",
                    models.Player.div,
                )
            ),
        )
        .join(models.Team, models.Team.id == models.Player.team_id)
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == models.Team.id,
                models.Encounter.away_team_id == models.Team.id,
            ),
        )
        .where(
            sa.and_(
                models.Player.is_substitution.is_(False),
                models.Player.user_id == user_id,
            )
        )
        .group_by(models.Player.role)
    )
    result = await session.execute(query)
    return result.all()  # type: ignore


async def get_tournament_role(
    session: AsyncSession, tournament: models.Tournament, user_id: int
) -> tuple[enums.HeroClass, int]:
    """
    Retrieves the role and division of a user in a specific tournament.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        tournament: The `Tournament` model instance to filter by.
        user_id: The ID of the user to retrieve the role for.

    Returns:
        A tuple containing:
        1. The role of the user in the tournament.
        2. The division of the user in the tournament.
    """
    query = (
        sa.select(models.Player.role, models.Player.div)
        .select_from(models.Player)
        .join(models.Team, models.Team.id == models.Player.team_id)
        .where(
            sa.and_(
                models.Team.tournament_id == tournament.id,
                models.Player.user_id == user_id,
                models.Player.is_substitution.is_(False),
            )
        )
    )
    result_role = await session.execute(query)
    return result_role.one()  # type: ignore


async def get_tournaments_with_stats(
    session: AsyncSession, user_id: int
) -> typing.Sequence[tuple[models.Team, int, int, int]]:
    """
    Retrieves a user's tournament history with statistics, including maps won, maps lost, and average closeness.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve tournament history for.

    Returns:
        A sequence of tuples containing:
        1. A `Team` model instance.
        2. The number of maps won.
        3. The number of maps lost.
        4. The average closeness of encounters.
    """
    query = (
        sa.select(
            models.Team,
            sa.func.sum(home_score_case).label("won_maps"),
            sa.func.sum(away_score_case).label("lost_maps"),
            sa.func.avg(models.Encounter.closeness).label("closeness"),
        )
        .select_from(models.Player)
        .options(
            joinedload(models.Team.players),
            joinedload(models.Team.tournament),
            joinedload(models.Team.tournament).joinedload(models.Tournament.standings),
            joinedload(models.Team.players).joinedload(models.Player.user),
            joinedload(models.Team.standings),
            joinedload(models.Team.standings).joinedload(models.Standing.group),
        )
        .join(models.Team, models.Team.id == models.Player.team_id)
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == models.Team.id,
                models.Encounter.away_team_id == models.Team.id,
            ),
        )
        .join(models.Tournament, models.Tournament.id == models.Team.tournament_id)
        .where(
            sa.and_(
                models.Player.user_id == user_id,
                models.Player.is_substitution.is_(False),
                models.Tournament.is_finished.is_(True),
            )
        )
        .group_by(models.Team.id)
    )
    result = await session.execute(query)
    return result.unique().all()


async def get_tournament_stats_overall(
    session: AsyncSession, tournament: models.Tournament, user_id: int
) -> tuple[int, int, int, float]:
    """
    Retrieves overall statistics for a user in a specific tournament, including maps won, maps lost, closeness, and playtime.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        tournament: The `Tournament` model instance to filter by.
        user_id: The ID of the user to retrieve statistics for.

    Returns:
        A tuple containing:
        1. The number of maps won.
        2. The number of maps lost.
        3. The average closeness of encounters.
        4. The total playtime in seconds.
    """
    playtime_query = (
        sa.select(sa.func.sum(models.MatchStatistics.value))
        .select_from(models.Player)
        .join(models.Team, models.Team.id == models.Player.team_id)
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == models.Team.id,
                models.Encounter.away_team_id == models.Team.id,
            ),
        )
        .join(models.Match, models.Match.encounter_id == models.Encounter.id)
        .join(
            models.MatchStatistics,
            models.MatchStatistics.match_id == models.Match.id,
        )
        .where(
            sa.and_(
                models.Player.user_id == user_id,
                models.Player.is_substitution.is_(False),
                models.Team.tournament_id == tournament.id,
                models.MatchStatistics.user_id == models.Player.user_id,
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.hero_id.is_(None),
            )
        )
    )

    query_overall = (
        sa.select(
            sa.func.sum(home_score_case).label("won_maps"),
            sa.func.sum(away_score_case).label("lost_maps"),
            sa.func.avg(models.Encounter.closeness).label("closeness"),
        )
        .select_from(models.Player)
        .join(models.Team, models.Team.id == models.Player.team_id)
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == models.Team.id,
                models.Encounter.away_team_id == models.Team.id,
            ),
        )
        .where(
            sa.and_(
                models.Player.user_id == user_id,
                models.Player.is_substitution.is_(False),
                models.Team.tournament_id == tournament.id,
            )
        )
    )
    result = await session.execute(query_overall)
    result_playtime = await session.execute(playtime_query)
    maps = result.unique().first()
    playtime = result_playtime.unique().first()

    won_maps, lost_maps, closeness = 0, 0, 0
    if maps:
        won_maps, lost_maps, closeness = maps

    return won_maps, lost_maps, closeness, playtime[0]


async def get_statistics_by_heroes(
    session: AsyncSession, user_id: int, params: pagination.PaginationParams
) -> tuple[enums.LogStatsName, models.Hero, float, float, float, dict]:
    """
    Retrieves a user's hero statistics, including total value, max value, average value, and best performance metadata.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve hero statistics for.

    Returns:
        A sequence of tuples containing:
        1. The statistic name (e.g., HeroDamageDealt, Eliminations).
        2. The `Hero` model instance.
        3. The total value of the statistic.
        4. The maximum value of the statistic.
        5. The average value of the statistic (per 10 minutes).
        6. A dictionary containing metadata about the best performance (e.g., encounter ID, map name, tournament name).
    """
    user_match = (
        sa.select(
            models.MatchStatistics.hero_id,
            models.MatchStatistics.name,
            models.Match.encounter_id,
            models.Map.name.label("map_name"),
            models.Map.image_path.label("map_image_path"),
            models.Tournament.name.label("tournament_name"),
            models.MatchStatistics.value,
            sa.func.row_number()
            .over(
                partition_by=[
                    models.MatchStatistics.hero_id,
                    models.MatchStatistics.name,
                ],
                order_by=models.MatchStatistics.value.desc(),
            )
            .label("row_num"),
        )
        .join(models.Match, models.MatchStatistics.match_id == models.Match.id)
        .join(models.Map, models.Map.id == models.Match.map_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
        .where(
            sa.and_(
                models.MatchStatistics.user_id == user_id,
                models.MatchStatistics.round == 0,
                models.MatchStatistics.hero_id.isnot(None),
            )
        )
        .order_by(models.MatchStatistics.hero_id, models.MatchStatistics.value.desc(), models.MatchStatistics.name,)
        .cte("user_match_encounter")
    )

    user_query = (
        sa.select(
            models.MatchStatistics.name,
            models.Hero,
            sa.func.sum(models.MatchStatistics.value).label("total_value"),
            sa.func.max(models.MatchStatistics.value).label("max_value"),
            (
                sa.func.sum(models.MatchStatistics.value)
                / sa.func.sum(models.Match.time)
                * 600
            ).label("avg"),
            sa.func.jsonb_build_object(
                "encounter_id",
                user_match.c.encounter_id,
                "map_name",
                user_match.c.map_name,
                "map_image_path",
                user_match.c.map_image_path,
                "tournament_name",
                user_match.c.tournament_name,
            ),
        )
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Hero, models.Hero.id == models.MatchStatistics.hero_id)
        .outerjoin(
            user_match,
            sa.and_(
                user_match.c.hero_id == models.MatchStatistics.hero_id,
                user_match.c.name == models.MatchStatistics.name,
                user_match.c.row_num == 1,
            )
        )
        .where(
            sa.and_(
                models.MatchStatistics.user_id == user_id,
                models.MatchStatistics.round == 0,
            )
        )
        .group_by(
            models.MatchStatistics.name,
            models.Hero.id,
            models.MatchStatistics.hero_id,
            user_match.c.encounter_id,
            user_match.c.map_name,
            user_match.c.map_image_path,
            user_match.c.tournament_name,
        )
    )
    # user_query = params.apply_sort(user_query, models.Hero)

    result = await session.execute(user_query)

    return result.all()


@cache(ttl="1d", key="get_statistics_by_heroes_all_values", prefix="backend:")
async def get_statistics_by_heroes_all_values(
    session: AsyncSession,
) -> typing.Sequence[tuple[enums.LogStatsName, int, float, float, dict]]:
    """
    Retrieves the best statistics for all heroes across all users, including max value, average value, and metadata.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        A sequence of tuples containing:
        1. The statistic name (e.g., HeroDamageDealt, Eliminations).
        2. The hero ID.
        3. The maximum value of the statistic.
        4. The average value of the statistic (per 10 minutes).
        5. A dictionary containing metadata about the best performance (e.g., encounter ID, map name, tournament name, username).
    """
    all_max_encounter_filtered = (
        sa.select(
            models.MatchStatistics.hero_id,
            models.MatchStatistics.name,
            models.Match.encounter_id,
            models.Map.name.label("map_name"),
            models.Map.image_path.label("map_image_path"),
            models.Tournament.name.label("tournament_name"),
            models.User.name.label("username"),
            models.MatchStatistics.value,
            sa.func.row_number()
            .over(
                partition_by=[
                    models.MatchStatistics.hero_id,
                    models.MatchStatistics.name,
                ],
                order_by=models.MatchStatistics.value.desc(),
            )
            .label("row_num"),
        )
        .join(models.Match, models.MatchStatistics.match_id == models.Match.id)
        .join(models.Map, models.Map.id == models.Match.map_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
        .join(models.User, models.User.id == models.MatchStatistics.user_id)
        .where(
            sa.and_(models.MatchStatistics.round == 0, models.MatchStatistics.value > 0, models.MatchStatistics.hero_id.isnot(None))
        )
        .order_by(
            models.MatchStatistics.hero_id,
            models.MatchStatistics.name,
            models.MatchStatistics.value.desc(),
            models.Encounter.tournament_id.desc(),
        )
        .cte("all_match_encounter")
    )

    all_query = (
        sa.select(
            models.MatchStatistics.name,
            models.Hero.id,
            sa.func.max(models.MatchStatistics.value).label("max_value"),
            (
                sa.func.sum(models.MatchStatistics.value)
                / sa.func.sum(models.Match.time)
                * 600
            ).label("avg"),
            sa.func.jsonb_build_object(
                "encounter_id",
                all_max_encounter_filtered.c.encounter_id,
                "map_name",
                all_max_encounter_filtered.c.map_name,
                "map_image_path",
                all_max_encounter_filtered.c.map_image_path,
                "tournament_name",
                all_max_encounter_filtered.c.tournament_name,
                "username",
                all_max_encounter_filtered.c.username,
            ),
        )
        .join(models.Match, sa.and_(models.Match.id == models.MatchStatistics.match_id))
        .join(models.Hero, models.Hero.id == models.MatchStatistics.hero_id)
        .outerjoin(
            all_max_encounter_filtered,
            sa.and_(
                all_max_encounter_filtered.c.hero_id == models.MatchStatistics.hero_id,
                all_max_encounter_filtered.c.name == models.MatchStatistics.name,
                all_max_encounter_filtered.c.row_num == 1,
            ),
        )
        .where(
            sa.and_(models.MatchStatistics.round == 0, models.MatchStatistics.value > 0)
        )
        .group_by(
            models.MatchStatistics.name,
            models.Hero.id,
            models.MatchStatistics.hero_id,
            all_max_encounter_filtered.c.encounter_id,
            all_max_encounter_filtered.c.map_name,
            all_max_encounter_filtered.c.map_image_path,
            all_max_encounter_filtered.c.tournament_name,
            all_max_encounter_filtered.c.username,
        )
        .order_by(models.Hero.id)
    )
    result_all = await session.execute(all_query)
    return result_all.all()


async def get_best_teammates(
    session: AsyncSession, user_id: int, params: pagination.PaginationParams
) -> tuple[
    typing.Sequence[tuple[models.User, int, int, float, int, float, float]], int
]:
    """
    Retrieves a user's best teammates, including win rate, tournaments played together, and performance statistics.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve best teammates for.
        params: An instance of `PaginationParams` containing pagination parameters.

    Returns:
        A tuple containing:
        1. A sequence of tuples containing:
            - A `User` model instance representing the teammate.
            - The win rate with the user.
            - The number of tournaments played together.
            - The average performance statistic.
            - The average KDA statistic.
        2. The total count of best teammates.
    """
    OuterPlayer = sa.orm.aliased(models.Player)

    home_score_case = sa.case(
        (
            models.Encounter.home_team_id == OuterPlayer.team_id,
            models.Encounter.home_score,
        ),
        else_=models.Encounter.away_score,
    )
    away_score_case = sa.case(
        (
            models.Encounter.home_team_id == OuterPlayer.team_id,
            models.Encounter.away_score,
        ),
        else_=models.Encounter.home_score,
    )

    winrate_sum = sa.func.sum(home_score_case) / (
        sa.func.sum(home_score_case) + sa.func.sum(away_score_case)
    )

    count_subquery = (
        sa.select(models.User.id.label("user_id"))
        .select_from(models.Player)
        .join(OuterPlayer, OuterPlayer.team_id == models.Player.team_id)
        .join(models.User, models.User.id == OuterPlayer.user_id)
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == OuterPlayer.team_id,
                models.Encounter.away_team_id == OuterPlayer.team_id,
            ),
        )
        .where(
            sa.and_(
                models.Player.user_id == user_id,
                models.Player.is_substitution.is_(False),
                OuterPlayer.is_substitution.is_(False),
                models.User.id != user_id,
            )
        )
        .group_by(models.User.id)
        .having(sa.func.count(sa.distinct(models.Encounter.tournament_id)) > 1)
        .subquery("filtered_users")
    )

    count_query = sa.select(sa.func.count(sa.distinct(count_subquery.c.user_id)))

    query = (
        sa.select(
            models.User,
            winrate_sum.label("winrate"),
            sa.func.count(sa.distinct(OuterPlayer.tournament_id)).label("tournaments"),
            sa.func.avg(
                sa.case(
                    (
                        models.MatchStatistics.name == enums.LogStatsName.Performance,
                        models.MatchStatistics.value,
                    ),
                    else_=None,
                )
            ).label("performance"),
            sa.func.avg(
                sa.case(
                    (
                        models.MatchStatistics.name == enums.LogStatsName.KDA,
                        models.MatchStatistics.value,
                    ),
                    else_=None,
                )
            ).label("kda"),
        )
        .select_from(models.Player)
        .join(OuterPlayer, OuterPlayer.team_id == models.Player.team_id)
        .join(models.User, models.User.id == OuterPlayer.user_id)
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == OuterPlayer.team_id,
                models.Encounter.away_team_id == OuterPlayer.team_id,
            ),
        )
        .outerjoin(
            models.MatchStatistics,
            sa.and_(
                models.MatchStatistics.team_id == OuterPlayer.team_id,
                models.MatchStatistics.user_id == OuterPlayer.user_id,
                models.MatchStatistics.round == 0,
                models.MatchStatistics.hero_id.is_(None),
                models.MatchStatistics.name.in_(
                    [enums.LogStatsName.Performance, enums.LogStatsName.KDA]
                ),
            ),
        )
        .where(
            sa.and_(
                models.Player.user_id == user_id,
                models.Player.is_substitution.is_(False),
                OuterPlayer.is_substitution.is_(False),
                OuterPlayer.user_id != user_id,
            )
        )
        .group_by(models.User.id)
        .having(sa.func.count(sa.distinct(OuterPlayer.tournament_id)) > 1)
    )

    query = params.apply_pagination_sort(query)
    result = await session.execute(query)
    count_result = await session.execute(count_query)
    return result.all(), count_result.scalar_one()
