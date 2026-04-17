import sqlalchemy as sa
from loguru import logger
from shared.division_grid import DEFAULT_GRID
from shared.services.division_grid_resolution import resolve_tournament_division
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import enums, errors, utils
from src.services.challonge import service as challonge_service
from src.services.tournament import flows as tournament_flows
from src.services.tournament import service as tournament_service
from src.services.user import flows as user_flows

from . import service


def resolve_hero_role_from_balancer(role: str) -> enums.HeroClass | None:
    if role is None:
        return None

    if role.lower() == "tank":
        return enums.HeroClass.tank
    if role.lower() == "dps":
        return enums.HeroClass.damage
    if role.lower() == "support":
        return enums.HeroClass.support
    raise errors.ApiHTTPException(
        status_code=400,
        detail=[errors.ApiExc(code="invalid_hero_role", msg=f"{role} is not a valid hero role.")],
    )


async def to_pydantic(
    session: AsyncSession,
    team: models.Team,
    entities: list[str],
) -> schemas.TeamRead:
    tournament: schemas.TournamentRead | None = None
    players_read: list[schemas.PlayerRead] = []
    captain: schemas.UserRead | None = None
    placement: int | None = None

    if "tournament" in entities and team.tournament is not None:
        tournament = await tournament_flows.to_pydantic(session, team.tournament, [])
    if "players" in entities:
        players_entities = utils.prepare_entities(entities, "players")
        players_read = [
            await to_pydantic_player(session, player, players_entities)
            for player in team.players
        ]
    if "captain" in entities and team.captain is not None:
        captain = await user_flows.to_pydantic(
            session, team.captain, utils.prepare_entities(entities, "captain")
        )
    if "placement" in entities and getattr(team, "standings", None):
        placement = team.standings[0].overall_position

    return schemas.TeamRead(
        id=team.id,
        name=team.name,
        avg_sr=team.avg_sr,
        total_sr=team.total_sr,
        tournament_id=team.tournament_id,
        captain_id=team.captain_id,
        tournament=tournament,
        players=players_read,
        captain=captain,
        placement=placement,
    )


async def to_pydantic_player(
    session: AsyncSession,
    player: models.Player,
    entities: list[str],
) -> schemas.PlayerRead:
    user: schemas.UserRead | None = None
    tournament: schemas.TournamentRead | None = None
    team: schemas.TeamRead | None = None

    if "user" in entities and player.user is not None:
        user = await user_flows.to_pydantic(
            session, player.user, utils.prepare_entities(entities, "user")
        )
    if "tournament" in entities and player.tournament is not None:
        tournament = await tournament_flows.to_pydantic(
            session, player.tournament, []
        )
    if "team" in entities and player.team is not None:
        team = await to_pydantic(session, player.team, [])

    division = getattr(player, "division", None)
    if division is None:
        division = resolve_tournament_division(
            player.rank,
            fallback_grid=DEFAULT_GRID,
        )

    return schemas.PlayerRead(
        **player.to_dict(),
        division=division,
        tournament=tournament,
        team=team,
        user=user,
    )



async def get(session: AsyncSession, id: int, entities: list[str]) -> models.Team:
    team = await service.get(session, id, entities)
    if not team:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[errors.ApiExc(code="not_found", msg="Team with id {id} not found.")],
        )
    return team


async def get_by_name_and_tournament(
    session: AsyncSession, tournament_id: int, name: str, entities: list[str]
) -> models.Team:
    team = await service.get_by_name_and_tournament(session, tournament_id, name, entities)
    if not team:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Team with name {name} in tournament {tournament_id} not found.",
                )
            ],
        )
    return team


async def get_by_tournament_challonge_id(
    session: AsyncSession, tournament_id: int, challonge_id: int, entities: list[str]
) -> models.Team:
    team = await service.get_by_tournament_challonge_id(session, tournament_id, challonge_id, entities)
    if not team:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Team with challonge_id {challonge_id} in tournament {tournament_id} not found.",
                )
            ],
        )
    return team


async def get_player_by_user_and_tournament(
    session: AsyncSession, user_id: int, tournament_id: int, entities: list[str]
) -> models.Player:
    player = await service.get_player_by_user_and_tournament(session, user_id, tournament_id, entities)
    if not player:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Player with user [id={user_id}] not found in tournament [number={tournament_id}].",
                )
            ],
        )

    return player


async def get_player_by_team_and_user(
    session: AsyncSession, team_id: int, user_id: int, entities: list[str]
) -> models.Player:
    player = await service.get_player_by_team_and_user(session, team_id, user_id, entities)
    if not player:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Player with user [id={user_id}] not found in team [id={team_id}].",
                )
            ],
        )

    return player


async def create_player(
    session: AsyncSession,
    *,
    name: str,
    sub_role: str | None = None,
    rank: int,
    role: enums.HeroClass,
    user: models.User,
    tournament: models.Tournament,
    team: models.Team,
    is_substitution: bool = False,
    related_player_id: int | None = None,
    is_newcomer: bool = False,
    is_newcomer_role: bool = False,
):
    if await service.get_player_by_team_and_user(session, team.id, user.id, []):
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="player_already_exists",
                    msg=f"Player [id={user.id} name={user.name}] already exists in this tournament [number={tournament.number}].",
                )
            ],
        )
    return await service.create_player(
        session,
        name=name,
        sub_role=sub_role,
        rank=rank,
        role=role,
        user=user,
        tournament=tournament,
        team=team,
        is_substitution=is_substitution,
        related_player_id=related_player_id,
        is_newcomer=is_newcomer,
        is_newcomer_role=is_newcomer_role,
    )


async def create(
    session: AsyncSession,
    *,
    name: str,
    balancer_name: str,
    avg_sr: float,
    total_sr: int,
    tournament: models.Tournament,
    captain: models.User,
) -> models.Team:
    if await service.get_by_name_and_tournament(session, tournament.id, name, []):
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="already_exists",
                    msg=f"Team with name {name} already exists in tournament "
                    f"[id={tournament.id}, number={tournament.number}].",
                )
            ],
        )

    return await service.create(
        session,
        name=name,
        balancer_name=balancer_name,
        avg_sr=avg_sr,
        total_sr=total_sr,
        tournament=tournament,
        captain=captain,
    )


async def bulk_create_from_balancer(
    session: AsyncSession, tournament_id: int, payload: list[schemas.BalancerTeam]
) -> None:
    tournament = await tournament_flows.get(session, tournament_id, [])
    for team_data in payload:
        try:
            name = team_data.name.split("#")[0]
        except ValueError:
            name = team_data.name

        captain = await user_flows.find_by_battle_tag(session, team_data.name)
        team = await service.get_by_name_and_tournament(session, tournament.id, name, [])
        if not team:
            team = await create(
                session,
                name=name,
                balancer_name=team_data.name,
                avg_sr=team_data.avg_sr,
                total_sr=team_data.total_sr,
                tournament=tournament,
                captain=captain,
            )
        else:
            logger.info(f"Team {name} already exists in tournament {tournament.name}. Skipping...")

        for player in team_data.members:
            logger.info(f"Trying to add player {player.name} to team {team.name} in tournament {tournament.name}")
            user = await user_flows.find_by_battle_tag(session, player.name)
            player_db = await service.get_player_by_user_and_tournament(session, user.id, tournament.id, [])
            if player_db:
                logger.info(
                    f"Player {player.name} already exists in team [name={team.name} tournament={tournament.name}]."
                )
                continue

            is_newcomer = not bool(await service.get_player_by_user(session, user.id, []))
            role = resolve_hero_role_from_balancer(player.role)
            is_newcomer_role = not bool(await service.get_player_by_user_and_role(session, user.id, role, []))

            await create_player(
                session,
                name=player.name,
                sub_role=player.sub_role,
                rank=player.rank,
                role=role,
                user=user,
                tournament=tournament,
                team=team,
                is_newcomer=is_newcomer,
                is_newcomer_role=is_newcomer_role,
            )
            logger.info(f"Player {player.name} added to team {team.name} in tournament {tournament.id}")

    return None


def format_team_name(name: str, mapper: dict[str, str] | None) -> str:
    new_name = name.split("#")[0]
    if mapper:
        new_name = mapper.get(name, name)

    if "#" in new_name:
        new_name = new_name.split("#")[0]

    if "Team" in new_name:
        new_name = new_name.replace("Team", "").strip()

    return new_name


async def _create_from_challonge_participant(
    session: AsyncSession,
    tournament: models.Tournament,
    group_id: int | None,
    participant: schemas.ChallongeParticipant,
    is_playoff: bool,
    name_mapper: dict[str, str],
) -> models.ChallongeTeam | None:
    name = format_team_name(participant.name, name_mapper)

    challonge_id = participant.id

    if is_playoff and participant.group_player_ids:
        challonge_id = participant.group_player_ids[0]

    team = await service.get_by_name_and_tournament(session, tournament.id, name, [])
    if not team:
        name = format_team_name(participant.name, None)
        team = await service.get_by_name_and_tournament(session, tournament.id, name, [])
    if not team:
        logger.warning(
            f"Challonge participant '{participant.name}' (formatted: '{name}') "
            f"not found in tournament {tournament.id}, skipping"
        )
        return None

    query = sa.select(models.ChallongeTeam).where(
        sa.and_(
            models.ChallongeTeam.challonge_id == challonge_id,
            models.ChallongeTeam.group_id == group_id,
            models.ChallongeTeam.team_id == team.id,
        )
    )

    result = await session.execute(query)
    challonge_team = result.scalar_one_or_none()

    if challonge_team:
        return challonge_team

    challonge_team = models.ChallongeTeam(
        challonge_id=challonge_id,
        team_id=team.id,
        group_id=group_id,
        tournament_id=tournament.id,
    )
    return challonge_team


async def bulk_create_for_tournament_from_challonge(
    session: AsyncSession, tournament_id: int, name_mapper: dict[str, str]
) -> None:
    tournament = await tournament_flows.get(session, tournament_id, ["groups"])
    logger.info(f"Creating teams for tournament {tournament.name} from challonge")

    if not tournament.challonge_id:
        for group in tournament.groups:
            participants = await challonge_service.fetch_participants(group.challonge_id)
            for participant in participants:
                challonge_team = await _create_from_challonge_participant(
                    session,
                    tournament,
                    group.id,
                    participant,
                    not group.is_groups,
                    name_mapper,
                )
                if challonge_team:
                    session.add(challonge_team)
    else:
        participants = await challonge_service.fetch_participants(tournament.challonge_id)
        for group in tournament.groups:
            for participant in participants:
                challonge_team = await _create_from_challonge_participant(
                    session,
                    tournament,
                    group.id,
                    participant,
                    not group.is_groups,
                    name_mapper,
                )
                if challonge_team:
                    session.add(challonge_team)

    await session.commit()
    logger.info(f"Teams for tournament {tournament.name} created successfully")


async def bulk_create_from_challonge(session: AsyncSession, name_mapper: dict[str, str]) -> None:
    for tournament in await tournament_service.get_all(session):
        await bulk_create_for_tournament_from_challonge(session, tournament.id, name_mapper)
