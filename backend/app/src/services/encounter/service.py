import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models, schemas
from src.core import enums, pagination, utils
from src.services.map import service as map_service
from src.services.team import service as team_service
from src.services.tournament import service as tournament_service

hero_jsonb_object = sa.func.jsonb_build_object(
    "id",
    models.Hero.id,
    "created_at",
    models.Hero.created_at,
    "updated_at",
    models.Hero.updated_at,
    "name",
    models.Hero.name,
    "slug",
    models.Hero.slug,
    "image_path",
    models.Hero.image_path,
    "color",
    models.Hero.color,
    "type",
    models.Hero.type,
)


match_jsonb_object = sa.func.jsonb_build_object(
    "id",
    models.Match.id,
    "created_at",
    models.Match.created_at,
    "updated_at",
    models.Match.updated_at,
    "time",
    models.Match.time,
    "home_team_id",
    models.Match.home_team_id,
    "away_team_id",
    models.Match.away_team_id,
    "home_score",
    models.Match.home_score,
    "away_score",
    models.Match.away_score,
    "encounter_id",
    models.Match.encounter_id,
    "map_id",
    models.Match.map_id,
)


def encounter_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[_AbstractLoad]:
    """
    Generates a list of SQLAlchemy loading options for related entities of an encounter.

    Parameters:
        in_entities (list[str]): A list of entity names to load (e.g., ["tournament", "teams"]).
        child (typing.Any | None): Optional child entity for nested loading.

    Returns:
        list[_AbstractLoad]: A list of SQLAlchemy loading options.
    """
    entities = []
    if "tournament" in in_entities:
        tournament_entity = utils.join_entity(child, models.Encounter.tournament)
        entities.append(tournament_entity)
        entities.extend(
            tournament_service.tournament_entities(
                utils.prepare_entities(in_entities, "tournament"), tournament_entity
            )
        )
    if "tournament_group" in in_entities:
        entities.append(utils.join_entity(child, models.Encounter.tournament_group))
    if "group" in in_entities:
        entities.append(utils.join_entity(child, models.Encounter.tournament_group))
    if "teams" in in_entities:
        home_team_entity = utils.join_entity(child, models.Encounter.home_team)
        away_team_entity = utils.join_entity(child, models.Encounter.away_team)
        entities.append(home_team_entity)
        entities.append(away_team_entity)
        entities.extend(
            team_service.team_entities(
                utils.prepare_entities(in_entities, "teams"), home_team_entity
            )
        )
        entities.extend(
            team_service.team_entities(
                utils.prepare_entities(in_entities, "teams"), away_team_entity
            )
        )
    if "matches" in in_entities:
        matches_entity = utils.join_entity(child, models.Encounter.matches)
        entities.append(matches_entity)
        entities.extend(
            match_entities(
                utils.prepare_entities(in_entities, "matches"), matches_entity
            )
        )

    return entities


def match_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[_AbstractLoad]:
    """
    Generates a list of SQLAlchemy loading options for related entities of a match.

    Parameters:
        in_entities (list[str]): A list of entity names to load (e.g., ["teams", "map"]).
        child (typing.Any | None): Optional child entity for nested loading.

    Returns:
        list[_AbstractLoad]: A list of SQLAlchemy loading options.
    """
    entities = []

    if "teams" in in_entities:
        home_team_entity = utils.join_entity(child, models.Match.home_team)
        away_team_entity = utils.join_entity(child, models.Match.away_team)
        entities.append(home_team_entity)
        entities.append(away_team_entity)
        entities.extend(
            team_service.team_entities(
                utils.prepare_entities(in_entities, "teams"), home_team_entity
            )
        )
        entities.extend(
            team_service.team_entities(
                utils.prepare_entities(in_entities, "teams"), away_team_entity
            )
        )
    if "encounter" in in_entities:
        encounter_entity = utils.join_entity(child, models.Match.encounter)
        entities.append(encounter_entity)

        if "encounter.matches" in in_entities:
            in_entities.remove("encounter.matches")

        entities.extend(
            encounter_entities(
                utils.prepare_entities(in_entities, "encounter"), encounter_entity
            )
        )
    if "map" in in_entities:
        map_entity = utils.join_entity(child, models.Match.map)
        entities.append(map_entity)
        entities.extend(
            map_service.map_entities(
                utils.prepare_entities(in_entities, "map"), map_entity
            )
        )
    return entities


def join_encounter_entities(query: sa.Select, in_entities: list[str]) -> sa.Select:
    """
    Joins related entities to an encounter query based on the provided entity list.

    Parameters:
        query (sa.Select): The SQLAlchemy select query.
        in_entities (list[str]): A list of entity names to join (e.g., ["tournament", "group"]).

    Returns:
        sa.Select: The modified query with joins.
    """
    if "tournament" in in_entities:
        query = query.join(
            models.Tournament, models.Encounter.tournament_id == models.Tournament.id
        )
    if "group" in in_entities:
        query = query.join(
            models.TournamentGroup,
            models.Encounter.tournament_group_id == models.TournamentGroup.id,
        )

    return query


async def get_match(
    session: AsyncSession, id: int, entities: list[str]
) -> models.Match | None:
    """
    Retrieves a match by its ID.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the match to retrieve.
        entities (list[str]): A list of related entities to load (e.g., ["teams", "map"]).

    Returns:
        models.Match | None: The Match object if found, otherwise None.
    """
    query = (
        sa.select(models.Match)
        .where(sa.and_(models.Match.id == id))
        .options(*match_entities(entities))
    )
    result = await session.execute(query)
    return result.scalars().first()


async def get_by_user_with_teams(
    session: AsyncSession, user_id: int, entities: list[str]
) -> typing.Sequence[tuple[models.Encounter, models.Match, int, list[dict]]]:
    """
    Retrieves encounters, matches, and related data for a specific user, including performance and hero data.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        user_id (int): The ID of the user.
        entities (list[str]): A list of related entities to load (e.g., ["teams", "map"]).

    Returns:
        typing.Sequence[tuple[models.Encounter, models.Match, int, list[dict]]]: A sequence of tuples containing encounter, match, performance, and hero data.
    """
    performance_cte = (
        sa.select(
            models.MatchStatistics.match_id.label("match_id"),
            models.MatchStatistics.value.label("value"),
        )
        .where(
            sa.and_(
                models.MatchStatistics.match_id == models.Match.id,
                models.MatchStatistics.user_id == user_id,
                models.MatchStatistics.name == enums.LogStatsName.Performance,
                models.MatchStatistics.hero_id.is_(None),
                models.MatchStatistics.round == 0,
            )
        )
        .cte("performance_cte")
    )

    heroes_cte = (
        sa.select(
            models.MatchStatistics.match_id.label("match_id"),
            sa.func.jsonb_agg(hero_jsonb_object).label("value"),
        )
        .select_from(models.MatchStatistics)
        .join(models.Hero, models.MatchStatistics.hero_id == models.Hero.id)
        .where(
            sa.and_(
                models.MatchStatistics.match_id == models.Match.id,
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.user_id == user_id,
                models.MatchStatistics.hero_id.isnot(None),
                models.MatchStatistics.value > 60,
                models.MatchStatistics.round == 0,
            )
        )
        .group_by(models.MatchStatistics.match_id)
        .cte("heroes_cte")
    )

    query = (
        sa.select(
            models.Team,
            models.Encounter,
            models.Match,
            performance_cte.c.value.label("performance"),
            heroes_cte.c.value.label("heroes"),
        )
        .select_from(models.Player)
        .options(*match_entities(entities))
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == models.Player.team_id,
                models.Encounter.away_team_id == models.Player.team_id,
            ),
        )
        .join(models.Team, models.Player.team_id == models.Team.id)
        .join(
            models.Match, models.Encounter.id == models.Match.encounter_id, isouter=True
        )
        .outerjoin(performance_cte, performance_cte.c.match_id == models.Match.id)
        .outerjoin(heroes_cte, heroes_cte.c.match_id == models.Match.id)
        .where(
            sa.and_(
                models.Player.user_id == user_id,
                models.Player.is_substitution.is_(False),
            )
        )
        .order_by(models.Team.id, models.Encounter.id)
    )

    result = await session.execute(query)
    return result.all()  # type: ignore


async def get_by_user(
    session: AsyncSession, user_id: int, params: pagination.PaginationSortParams
) -> tuple[
    typing.Sequence[tuple[models.Encounter, models.Match, int, list[dict]]], int
]:
    """
    Retrieves paginated encounters, matches, and related data for a specific user.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        user_id (int): The ID of the user.
        params (pagination.PaginationSortParams): Pagination and sorting parameters.

    Returns:
        tuple[typing.Sequence[tuple[models.Encounter, models.Match, int, list[dict]]], int]: A tuple containing:
            - A sequence of tuples containing encounter, match, performance, and hero data.
            - The total count of encounters.
    """
    total_query = (
        sa.select(sa.func.count(models.Encounter.id))
        .join(
            models.Player,
            sa.or_(
                models.Encounter.home_team_id == models.Player.team_id,
                models.Encounter.away_team_id == models.Player.team_id,
            ),
        )
        .where(sa.and_(models.Player.user_id == user_id))
    )

    encounters_query = (
        sa.select(
            models.Encounter,
            models.Player.id.label("player_id"),
        )
        .select_from(models.Player)
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == models.Player.team_id,
                models.Encounter.away_team_id == models.Player.team_id,
            ),
        )
        .where(sa.and_(models.Player.user_id == user_id))
    )

    encounters_query = params.apply_pagination_sort(encounters_query)
    encounters_query = encounters_query.subquery()

    performance_cte = (
        sa.select(
            models.MatchStatistics.match_id,
            models.MatchStatistics.value.label("performance"),
        )
        .where(
            sa.and_(
                models.MatchStatistics.user_id == user_id,
                models.MatchStatistics.name == enums.LogStatsName.Performance,
                models.MatchStatistics.hero_id.is_(None),
                models.MatchStatistics.round == 0,
            )
        )
        .cte("performance_cte")
    )

    heroes_cte = (
        sa.select(
            models.MatchStatistics.match_id,
            sa.func.jsonb_agg(hero_jsonb_object).label("heroes"),
        )
        .join(models.Hero, models.MatchStatistics.hero_id == models.Hero.id)
        .where(
            sa.and_(
                models.MatchStatistics.user_id == user_id,
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.hero_id.isnot(None),
                models.MatchStatistics.value > 60,
                models.MatchStatistics.round == 0,
            )
        )
        .group_by(models.MatchStatistics.match_id)
        .cte("heroes_cte")
    )

    query = (
        sa.select(
            models.Encounter,
            models.Match,
            performance_cte.c.performance,
            heroes_cte.c.heroes,
        )
        .select_from(encounters_query)
        .options(
            *[*match_entities(params.entities), *encounter_entities(params.entities)]
        )
        .join(models.Encounter, encounters_query.c.id == models.Encounter.id)
        .join(
            models.Match, models.Encounter.id == models.Match.encounter_id, isouter=True
        )
        .join(
            performance_cte, performance_cte.c.match_id == models.Match.id, isouter=True
        )
        .join(heroes_cte, heroes_cte.c.match_id == models.Match.id, isouter=True)
    )

    result = await session.execute(query)
    total_result = await session.execute(total_query)
    return result.all(), total_result.scalar_one()  # type: ignore


async def get_encounter(
    session: AsyncSession, id: int, entities: list[str]
) -> models.Encounter | None:
    """
    Retrieves an encounter by its ID.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the encounter to retrieve.
        entities (list[str]): A list of related entities to load (e.g., ["tournament", "teams"]).

    Returns:
        models.Encounter | None: The Encounter object if found, otherwise None.
    """
    query = (
        sa.select(models.Encounter)
        .options(*encounter_entities(entities))
        .where(sa.and_(models.Encounter.id == id))
    )
    result = await session.execute(query)
    return result.scalars().first()


async def get_all_encounters(
    session: AsyncSession, params: schemas.EncounterSearchParams
) -> tuple[typing.Sequence[models.Encounter], int]:
    """
    Retrieves a paginated list of encounters based on search parameters.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (schemas.EncounterSearchParams): Search, pagination, and sorting parameters.

    Returns:
        tuple[typing.Sequence[models.Encounter], int]: A tuple containing:
            - A sequence of Encounter objects.
            - The total count of encounters.
    """
    query = sa.select(models.Encounter).options(*encounter_entities(params.entities))
    total_query = sa.select(sa.func.count(models.Encounter.id))
    query = join_encounter_entities(query, params.entities)
    total_query = join_encounter_entities(total_query, params.entities)
    if params.query:
        query = params.apply_search(query, models.Encounter)
        total_query = params.apply_search(total_query, models.Encounter)

    if params.tournament_id:
        query = query.where(models.Encounter.tournament_id == params.tournament_id)
        total_query = total_query.where(
            models.Encounter.tournament_id == params.tournament_id
        )

    query = params.apply_pagination_sort(query)

    result = await session.execute(query)
    result_total = await session.execute(total_query)
    return result.unique().scalars().all(), result_total.scalar_one()


async def get_match_stats_for_user(
    session: AsyncSession, match_id: int, user_id: int
) -> tuple[dict[int, dict[enums.LogStatsName, int]], dict[int, list[dict]]]:
    """
    Retrieves match statistics and hero data for a specific user.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        match_id (int): The ID of the match.
        user_id (int): The ID of the user.

    Returns:
        tuple[dict[int, dict[enums.LogStatsName, int]], dict[int, list[dict]]]: A tuple containing:
            - A dictionary of round-based statistics.
            - A dictionary of round-based hero data.
    """
    query = (
        sa.select(
            models.MatchStatistics.round,
            models.MatchStatistics.name,
            sa.func.sum(models.MatchStatistics.value)
            .cast(sa.Numeric(10, 2))
            .label("value"),
        )
        .where(
            sa.and_(
                models.MatchStatistics.match_id == match_id,
                models.MatchStatistics.user_id == user_id,
                models.MatchStatistics.hero_id.is_(None),
            )
        )
        .group_by(models.MatchStatistics.name, models.MatchStatistics.round)
    )

    heroes_round = (
        sa.select(models.MatchStatistics.round, sa.func.jsonb_agg(hero_jsonb_object))
        .select_from(models.MatchStatistics)
        .join(models.Hero, models.MatchStatistics.hero_id == models.Hero.id)
        .where(
            sa.and_(
                models.MatchStatistics.match_id == match_id,
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.user_id == user_id,
                models.MatchStatistics.hero_id.isnot(None),
                models.MatchStatistics.value > 60,
            )
        )
        .group_by(models.MatchStatistics.round)
    )

    stats_result = await session.execute(query)
    heroes_result = await session.execute(heroes_round)

    stats_out: dict[int, dict[enums.LogStatsName, int]] = {}
    heroes_out: dict[int, list[dict]] = {}

    for match_round, name, value in stats_result.all():
        stats_out.setdefault(match_round, {})[name] = value

    for match_round, value in heroes_result.all():
        heroes_out[match_round] = value

    return stats_out, heroes_out


async def get_by_team(
    session: AsyncSession, team_id: int, entities: list[str]
) -> typing.Sequence[models.Encounter]:
    """
    Retrieves all encounters involving a specific team.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        team_id (int): The ID of the team.
        entities (list[str]): A list of related entities to load (e.g., ["tournament", "teams"]).

    Returns:
        typing.Sequence[models.Encounter]: A sequence of Encounter objects involving the specified team.
    """
    query = (
        sa.select(models.Encounter)
        .options(*encounter_entities(entities))
        .where(
            sa.or_(
                models.Encounter.home_team_id == team_id,
                models.Encounter.away_team_id == team_id,
            )
        )
    )
    query = join_encounter_entities(query, entities)
    result = await session.execute(query)
    return result.scalars().all()


async def get_by_team_group(
    session: AsyncSession, team_id: int, group_id: int, entities: list[str]
) -> typing.Sequence[models.Encounter]:
    """
    Retrieves all encounters involving a specific team within a specific tournament group.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        team_id (int): The ID of the team.
        group_id (int): The ID of the tournament group.
        entities (list[str]): A list of related entities to load (e.g., ["tournament", "teams"]).

    Returns:
        typing.Sequence[models.Encounter]: A sequence of Encounter objects involving the specified team and group.
    """
    query = (
        sa.select(models.Encounter)
        .options(*encounter_entities(entities))
        .where(
            sa.and_(
                sa.or_(
                    models.Encounter.home_team_id == team_id,
                    models.Encounter.away_team_id == team_id,
                ),
                models.Encounter.tournament_group_id == group_id,
            )
        )
    )
    query = join_encounter_entities(query, entities)
    result = await session.execute(query)
    return result.scalars().all()


async def get_all_matches(
    session: AsyncSession, params: schemas.MatchSearchParams
) -> tuple[typing.Sequence[models.Match], int]:
    """
    Retrieves a paginated list of matches based on search parameters.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (schemas.MatchSearchParams): Search, pagination, and sorting parameters.

    Returns:
        tuple[typing.Sequence[models.Match], int]: A tuple containing:
            - A sequence of Match objects.
            - The total count of matches.
    """
    query = sa.select(models.Match).options(*match_entities(params.entities))
    total_query = sa.select(sa.func.count(models.Match.id))
    if params.query:
        query = params.apply_search(query, models.Match)
        total_query = params.apply_search(total_query, models.Match)

    encounter_joined: bool = False

    if params.tournament_id:
        encounter_joined = True
        query = query.join(
            models.Encounter, models.Match.encounter_id == models.Encounter.id
        ).where(sa.and_(models.Encounter.tournament_id == params.tournament_id))
        total_query = total_query.join(
            models.Encounter, models.Match.encounter_id == models.Encounter.id
        ).where(sa.and_(models.Encounter.tournament_id == params.tournament_id))

    if params.home_team_id:
        if not encounter_joined:
            query = query.join(
                models.Encounter, models.Match.encounter_id == models.Encounter.id
            )
            total_query = total_query.join(
                models.Encounter, models.Match.encounter_id == models.Encounter.id
            )

        query = query.where(sa.and_(models.Match.home_team_id == params.home_team_id))
        total_query = total_query.where(
            sa.and_(models.Match.home_team_id == params.home_team_id)
        )

    if params.away_team_id:
        if not encounter_joined:
            query = query.join(
                models.Encounter, models.Match.encounter_id == models.Encounter.id
            )
            total_query = total_query.join(
                models.Encounter, models.Match.encounter_id == models.Encounter.id
            )

        query = query.where(sa.and_(models.Match.away_team_id == params.away_team_id))
        total_query = total_query.where(
            sa.and_(models.Match.away_team_id == params.away_team_id)
        )

    query = params.apply_pagination_sort(query, models.Match)

    result = await session.execute(query)
    result_total = await session.execute(total_query)
    return result.unique().scalars().all(), result_total.scalar_one()
