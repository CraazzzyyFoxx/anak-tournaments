import typing
from datetime import UTC, datetime
from statistics import mean

from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import enums, errors, pagination
from src.services.encounter import flows as encounter_flows
from src.services.encounter import service as encounter_service
from src.services.hero import flows as hero_flows
from src.services.statistics import service as statistics_service
from src.services.team import flows as team_flows
from src.services.tournament import flows as tournament_flows
from src.services.team import service as team_service

from . import service

tournament_stats = [
    enums.LogStatsName.HeroDamageDealt,
    enums.LogStatsName.KD,
    enums.LogStatsName.Eliminations,
    enums.LogStatsName.Assists,
    enums.LogStatsName.KDA,
    enums.LogStatsName.DamageDelta,
]


tournament_stats_reverted = [
    enums.LogStatsName.Deaths,
    enums.LogStatsName.Performance,
]


async def to_pydantic(
    session: AsyncSession, user: models.User, entities: list[str]
) -> schemas.UserRead:
    """
    Converts a `User` model instance to a Pydantic `UserRead` schema, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user: The `User` model instance to convert.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `UserRead` schema instance.
    """
    battle_tags = []
    twitch = []
    discord = []

    unresolved = datetime(1, 1, 1, tzinfo=UTC)
    if "battle_tag" in entities:
        battle_tags = [
            schemas.UserBattleTagRead.model_validate(tag, from_attributes=True)
            for tag in user.battle_tag
        ]
    if "twitch" in entities:
        twitch = [
            schemas.UserTwitchRead.model_validate(twitch, from_attributes=True)
            for twitch in sorted(
                user.twitch,
                key=lambda x: unresolved if x.updated_at is None else x.updated_at,
                reverse=True,
            )
        ]
    if "discord" in entities:
        discord = [
            schemas.UserDiscordRead.model_validate(discord, from_attributes=True)
            for discord in sorted(
                user.discord,
                key=lambda x: unresolved if x.updated_at is None else x.updated_at,
                reverse=True,
            )
        ]

    return schemas.UserRead(
        id=user.id,
        name=user.name,
        battle_tag=battle_tags,
        twitch=twitch,
        discord=discord,
    )


async def get(session: AsyncSession, user_id: int, entities: list[str]) -> models.User:
    """
    Retrieves a `User` model instance by its ID, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `User` model instance.

    Raises:
        errors.ApiHTTPException: If the user is not found.
    """
    user = await service.get(session, user_id, entities)
    if not user:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="not_found", msg=f"User with id {user_id} not found."
                )
            ],
        )
    return user


async def get_by_battle_tag(
    session: AsyncSession, battle_tag: str, entities: list[str]
) -> schemas.UserRead:
    """
    Retrieves a `User` model instance by its battle tag and converts it to a `UserRead` schema.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        battle_tag: The battle tag of the user to retrieve.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `UserRead` schema instance.

    Raises:
        errors.ApiHTTPException: If the user is not found.
    """
    user = await service.find_by_battle_tag(session, battle_tag, entities)
    if not user:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"User with battle tag {battle_tag} not found.",
                )
            ],
        )
    return await to_pydantic(session, user, entities)


async def get_all(
    session: AsyncSession, params: pagination.PaginationSortSearchParams
) -> pagination.Paginated[schemas.UserRead]:
    """
    Retrieves a paginated list of `User` model instances and converts them to `UserRead` schemas.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        params: An instance of `SearchPaginationParams` containing pagination and filtering parameters.

    Returns:
        A `Paginated` instance containing `UserRead` schemas.
    """
    users, total = await service.get_all(session, params)
    return pagination.Paginated(
        page=params.page,
        per_page=params.per_page,
        total=total,
        results=[await to_pydantic(session, user, params.entities) for user in users],
    )


async def get_read(
    session: AsyncSession, user_id: int, entities: list[str]
) -> schemas.UserRead:
    """
    Retrieves a `User` model instance by its ID and converts it to a `UserRead` schema.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `UserRead` schema instance.
    """
    user = await get(session, user_id, entities)
    return await to_pydantic(session, user, entities)


async def get_roles(session: AsyncSession, user_id: int) -> list[schemas.UserRole]:
    """
    Retrieves the roles and statistics for a user across tournaments.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        user_id: The ID of the user to retrieve roles for.

    Returns:
        A list of `UserRole` schemas representing the user's roles and statistics.
    """
    roles = await service.get_roles(session, user_id)
    return [
        schemas.UserRole(
            role=role,
            tournaments=len({division["tournament"] for division in division}),
            maps_won=maps_won,
            maps=maps_won + maps_lost,
            division=sorted(division, key=lambda x: x["tournament"], reverse=True)[0][
                "division"
            ],
        )
        for role, maps_won, maps_lost, division in roles
    ]


async def get_profile(session: AsyncSession, id: int) -> schemas.UserProfile:
    """
    Retrieves a user's profile, including statistics, roles, and tournament history.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        id: The ID of the user to retrieve the profile for.

    Returns:
        A `UserProfile` schema instance.
    """
    user = await get(session, id, [])
    matches = await service.get_overall_statistics(session, user.id)
    matches_won, matches_lose, avg_closeness = 0, 0, 0
    if matches:
        matches_won, matches_lose, avg_closeness = matches
    roles = await get_roles(session, user.id)
    hero_statistics = await hero_flows.get_playtime(
        session,
        schemas.HeroPlaytimePaginationParams(
            user_id=user.id, sort="playtime", order="desc"
        ),
    )

    teams, total_teams = await service.get_teams(
        session,
        user.id,
        params=pagination.PaginationSortParams(
            page=1, per_page=-1, entities=["tournament", "placement"]
        ),
    )

    placements: list[int] = []
    placements_playoff: list[int] = []
    placements_group: list[int] = []
    tournaments: list[schemas.TournamentRead] = []
    tournaments_count: int = 0
    tournaments_won: int = 0

    for team in teams:
        tournaments.append(
            await tournament_flows.to_pydantic(session, team.tournament, [])
        )

        if team.tournament.is_league:
            continue

        placements.append(team.standings[0].overall_position)
        tournaments_count += 1
        if team.standings[0].overall_position == 1:
            tournaments_won += 1
        for standing in team.standings:
            if standing.buchholz is None:
                placements_playoff.append(standing.position)
            else:
                placements_group.append(standing.position)

    return schemas.UserProfile(
        tournaments_count=tournaments_count,
        tournaments_won=tournaments_won,
        maps_total=matches_lose + matches_won,
        maps_won=matches_won,
        avg_placement=round(mean(placements), 2) if placements else None,
        avg_playoff_placement=(
            round(mean(placements_playoff), 2) if placements_playoff else None
        ),
        avg_group_placement=(
            round(mean(placements_group), 2) if placements_group else None
        ),
        avg_closeness=round(avg_closeness, 2) if avg_closeness else 0,
        most_played_hero=(
            hero_statistics.results[0].hero if hero_statistics.results else None
        ),
        roles=roles,
        hero_statistics=hero_statistics.results,
        tournaments=sorted(tournaments, key=lambda x: x.id, reverse=True),
    )


async def get_tournaments(
    session: AsyncSession, id: int
) -> list[schemas.UserTournament]:
    """
    Retrieves a user's tournament history, including statistics and encounters.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        id: The ID of the user to retrieve tournament history for.

    Returns:
        A list of `UserTournament` schemas representing the user's tournament history.
    """
    user = await get(session, id, [])
    output: list[schemas.UserTournament] = []
    tournaments = await service.get_tournaments_with_stats(session, user.id)
    tournaments_ids = [tournament[0].tournament_id for tournament in tournaments]
    encounters: dict[int, list[schemas.EncounterReadWithUserStats]] = {}
    encounters_cache: dict[int, dict[int, models.Encounter]] = {}
    matches_cache: dict[int, dict[int, list[schemas.MatchReadWithUserStats]]] = {}
    matches = await encounter_service.get_by_user_with_teams(session, user.id, ["map"])
    placements = await team_service.get_team_count_by_tournament_bulk(
        session, tournaments_ids
    )

    for team, encounter, match, performance, heroes in matches:
        encounters.setdefault(team.id, [])
        encounters_cache.setdefault(team.id, {})
        matches_cache.setdefault(team.id, {})
        encounters_cache[team.id].setdefault(encounter.id, encounter)
        matches_cache[team.id].setdefault(encounter.id, [])

        if match:
            match_read_ = await encounter_flows.to_pydantic_match(
                session, match, ["map"]
            )
            match_read = schemas.MatchReadWithUserStats(
                **match_read_.model_dump(),
                performance=performance,
                heroes=heroes if heroes else [],
            )
            matches_cache[team.id][encounter.id].append(match_read)

    for team_id, encounter_dict in encounters_cache.items():
        for encounter_id, encounter in encounter_dict.items():
            encounter_read_ = await encounter_flows.to_pydantic(session, encounter, [])
            encounter_read = schemas.EncounterReadWithUserStats(
                **encounter_read_.model_dump(exclude={"matches"}),
                matches=matches_cache.get(team_id, {}).get(encounter_id, []),
            )
            encounters[team_id].append(encounter_read)

    for team, wins, losses, avg_closeness in tournaments:
        user_role: enums.HeroClass = None  # type: ignore
        user_division: int = None  # type: ignore
        won: int = 0
        lost: int = 0
        draw: int = 0
        placement: int | None = (
            team.standings[0].overall_position if team.standings else None
        )

        for player in team.players:
            if player.user_id == user.id:
                user_role = player.role
                user_division = player.div
                break

        for standing in team.standings:
            won += standing.win
            lost += standing.lose
            draw += standing.draw

        tournament = schemas.UserTournament(
            id=team.tournament.id,
            number=team.tournament.number,
            name=team.tournament.name,
            is_league=team.tournament.is_league,
            team_id=team.id,
            team=team.name,
            players=[
                await team_flows.to_pydantic_player(session, player, [])
                for player in team.players
            ],
            closeness=round(avg_closeness, 2) if avg_closeness else 0,
            maps_won=wins,
            maps_lost=losses,
            placement=placement,
            role=user_role,
            division=user_division,
            count_teams=placements[team.tournament_id],
            won=won,
            lost=lost,
            draw=draw,
            encounters=encounters[team.id],
        )
        output.append(tournament)

    output = sorted(output, key=lambda x: x.id, reverse=True)
    return output


async def get_tournament_with_stats(
    session: AsyncSession, id: int, tournament_id: int
) -> schemas.UserTournamentWithStats | None:
    """
    Retrieves detailed statistics for a user in a specific tournament.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        id: The ID of the user to retrieve statistics for.
        tournament_id: The ID of the tournament to retrieve statistics for.

    Returns:
        A `UserTournamentWithStats` schema instance if found, otherwise `None`.
    """
    user = await get(session, id, [])
    player = await team_flows.get_player_by_user_and_tournament(
        session, user.id, tournament_id, ["team", "team.tournament", "team.placement"]
    )
    team = player.team
    statistics = await service.get_tournament_stats_overall(
        session, team.tournament, user.id
    )
    last_playoff_placement: float | None = None
    last_group_placement: float | None = None
    stats: dict[
        enums.LogStatsName | typing.Literal["winrate"], schemas.UserTournamentStat
    ] = {}
    winrate = await statistics_service.get_tournament_winrate(
        session, team.tournament, user.id
    )

    if winrate:
        stats["winrate"] = schemas.UserTournamentStat(
            value=winrate[1], rank=winrate[2], total=winrate[3]
        )
    else:
        stats["winrate"] = schemas.UserTournamentStat(value=0, rank=0, total=0)

    for values in await statistics_service.get_tournament_avg_match_stat_for_user_bulk(
        session,
        team.tournament,
        user.id,
        [*tournament_stats, *tournament_stats_reverted],
    ):
        if not values:
            continue
        stat, user_id, value, rank_desc, rank_asc, total = values

        rank = rank_desc if stat in tournament_stats else rank_asc

        stats[stat] = schemas.UserTournamentStat(value=value, rank=rank, total=total)

    for placement in team.standings:
        if placement.buchholz is None:
            last_playoff_placement = placement.position
        else:
            last_group_placement = placement.position

    return schemas.UserTournamentWithStats(
        id=team.tournament.id,
        number=team.tournament.number,
        name=team.tournament.name,
        division=player.div,
        closeness=round(statistics[2], 2) if statistics[2] else 0,
        role=player.role,
        maps=statistics[0] + statistics[1] if statistics[0] else 0,
        maps_won=statistics[0] if statistics[0] else 0,
        playtime=round(statistics[3], 2) if statistics[3] else 0,
        group_placement=last_group_placement,
        playoff_placement=last_playoff_placement,
        stats=stats,
    )


async def get_heroes(
    session: AsyncSession, id: int, params: pagination.PaginationParams
) -> pagination.Paginated[schemas.HeroWithUserStats]:
    """
    Retrieves a user's hero statistics, including performance and comparisons with other users.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        id: The ID of the user to retrieve hero statistics for.
        params:  An instance of `PaginationParams` containing pagination parameters (e.g., page, per_page).

    Returns:
        A list of `HeroWithUserStats` schemas representing the user's hero statistics.
    """
    user = await get(session, id, [])
    user_stats = await service.get_statistics_by_heroes(session, user.id)
    all_stats = await service.get_statistics_by_heroes_all_values(session)
    payload: list[schemas.HeroWithUserStats] = []

    cache: dict[int, dict[enums.LogStatsName, schemas.HeroStat]] = {}
    cache_hero: dict[int, schemas.HeroRead] = {}

    for name, hero, value, value_best, value_avg_10, best_meta in user_stats:
        if hero.id not in cache_hero:
            cache_hero[hero.id] = await hero_flows.to_pydantic(session, hero, [])
        if hero.id not in cache:
            cache[hero.id] = {}
        cache[hero.id][name] = schemas.HeroStat(
            name=name,
            overall=round(value, 2),
            best=schemas.HeroStatBest(
                encounter_id=best_meta["encounter_id"],
                map_name=best_meta["map_name"],
                value=round(value_best, 2),
                map_image_path=best_meta["map_image_path"],
                tournament_name=best_meta["tournament_name"],
                player_name=user.name,
            ),
            avg_10=round(value_avg_10, 2),
            best_all=None,
            avg_10_all=0,
        )

    for name, hero_id, value_best, value_avg_10, best_meta in all_stats:
        if hero_id in cache:
            cache[hero_id][name].best_all = schemas.HeroStatBest(
                encounter_id=best_meta["encounter_id"],
                map_name=best_meta["map_name"],
                value=round(value_best, 2),
                map_image_path=best_meta["map_image_path"],
                tournament_name=best_meta["tournament_name"],
                player_name=best_meta["username"],
            )
            cache[hero_id][name].avg_10_all = round(value_avg_10, 2)

    for hero_id, stats in cache.items():
        payload.append(
            schemas.HeroWithUserStats(
                hero=cache_hero[hero_id],
                stats=list(stats.values()),
            )
        )

    return pagination.Paginated(
        page=params.page,
        per_page=params.per_page,
        total=len(payload),
        results=payload[
            params.per_page * (params.page - 1) : params.per_page * params.page
        ],
    )


async def get_best_teammates(
    session: AsyncSession, id: int, params: pagination.PaginationSortParams
) -> pagination.Paginated[schemas.UserBestTeammate]:
    """
    Retrieves a paginated list of a user's best teammates, including win rate, tournaments played together,
    and performance statistics.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        id: The ID of the user to retrieve best teammates for.
        params: An instance of `PaginationParams` containing pagination parameters (e.g., page, per_page).

    Returns:
        A `Paginated` instance containing `UserBestTeammate` schemas, representing the user's best teammates.
    """
    user = await get(session, id, [])
    teammates, total = await service.get_best_teammates(session, user.id, params)
    return pagination.Paginated(
        page=params.page,
        per_page=params.per_page,
        total=total,
        results=[
            schemas.UserBestTeammate(
                user=await to_pydantic(session, teammate, []),
                winrate=round(winrate, 2),
                tournaments=tournaments,
                stats={
                    enums.LogStatsName.Performance: (
                        round(performance, 2) if performance else 0
                    ),
                    enums.LogStatsName.KDA: round(kda, 2) if kda else 0,
                },
            )
            for teammate, winrate, tournaments, performance, kda in teammates
        ],
    )
