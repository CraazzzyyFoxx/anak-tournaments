import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.domain.player_sub_roles import normalize_sub_role
from shared.repository import (
    PlayerRepository,
    UserRepository,
    WorkspaceMemberRepository,
    get_or_create_workspace_member,
)
from src import models
from src.core import enums, utils


class TeamService:
    def __init__(
        self,
        *,
        player_repo: PlayerRepository = PlayerRepository(),
        workspace_member_repo: WorkspaceMemberRepository = WorkspaceMemberRepository(),
    ) -> None:
        self.player_repo = player_repo
        self.workspace_member_repo = workspace_member_repo

    async def _resolve_workspace_member_id(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        player_id: int,
    ) -> int:
        """Resolve the ``workspace_member`` anchor for a roster player being created.

        The workspace is derived from the player's tournament (``tournament.workspace_id``);
        the member row is created idempotently if one does not already exist for this
        (workspace, player) pair.
        """
        workspace_id_result = await session.execute(
            sa.select(models.Tournament.workspace_id).where(models.Tournament.id == tournament_id)
        )
        workspace_id = workspace_id_result.scalar_one()
        member = await get_or_create_workspace_member(session, workspace_id=workspace_id, player_id=player_id)
        return member.id

    async def resolve_workspace_member_ids(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        player_ids: set[int],
    ) -> dict[int, int]:
        """Batch counterpart of ``_resolve_workspace_member_id``: resolve (or create)
        the ``workspace_member`` anchors for a whole roster in two statements.

        Delegates to ``WorkspaceMemberRepository.bulk_get_or_create``, which mirrors
        ``get_or_create_workspace_member``'s insert-or-select idempotency
        (``INSERT ... ON CONFLICT DO NOTHING`` on
        ``uq_workspace_member_workspace_player``, then one ``SELECT``), so concurrent
        imports never raise duplicate-key errors. Returns ``player_id -> member.id``.
        """
        return await self.workspace_member_repo.bulk_get_or_create(
            session, workspace_id=workspace_id, player_ids=player_ids
        )

    async def get_by_tournament(
        self, session: AsyncSession, tournament_id: int, entities: list[str]
    ) -> typing.Sequence[models.Team]:
        query = sa.select(models.Team).filter_by(tournament_id=tournament_id).options(*team_entities(entities))
        result = await session.execute(query)
        return result.unique().scalars().all()

    async def get_by_players_by_ids_tournament(
        self,
        session: AsyncSession,
        players_ids: list[int],
        tournament: models.Tournament,
        entities: list[str],
    ) -> models.Team | None:
        query = (
            sa.select(models.Team)
            .join(models.Player, models.Team.id == models.Player.team_id)
            .join(
                models.WorkspaceMember,
                models.WorkspaceMember.id == models.Player.workspace_member_id,
            )
            .options(*team_entities(entities))
            .where(
                sa.and_(
                    models.WorkspaceMember.player_id.in_(players_ids),
                    models.Team.tournament_id == tournament.id,
                    models.Player.is_substitution.is_(False),
                )
            )
            .group_by(models.Team.id)
            .having(sa.func.count(models.Player.id) >= 3)
        )
        result = await session.execute(query)
        return result.unique().scalars().first()

    async def get_player_by_team_and_user(
        self, session: AsyncSession, team_id: int, user_id: int, entities: list[str]
    ) -> models.Player | None:
        query = (
            sa.select(models.Player)
            .options(*player_entities(entities))
            .where(
                sa.and_(
                    models.Player.workspace_member.has(models.WorkspaceMember.player_id == user_id),
                    models.Player.team_id == team_id,
                )
            )
        )
        result = await session.execute(query)
        return result.unique().scalars().first()

    async def get_player_by_user_and_role(
        self, session: AsyncSession, user_id: int, role: enums.HeroClass, entities: list[str]
    ) -> typing.Sequence[models.Player]:
        query = (
            sa.select(models.Player)
            .options(*player_entities(entities))
            .where(
                sa.and_(
                    models.Player.workspace_member.has(models.WorkspaceMember.player_id == user_id),
                    models.Player.role == role,
                )
            )
        )
        result = await session.execute(query)
        return result.unique().scalars().all()

    async def create_player(
        self,
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
    ) -> models.Player:
        workspace_member_id = await _resolve_workspace_member_id(
            session,
            tournament_id=tournament.id,
            player_id=user.id,
        )
        player = models.Player(
            name=name,
            sub_role=normalize_sub_role(sub_role),
            rank=rank,
            role=role,
            tournament_id=tournament.id,
            team_id=team.id,
            is_substitution=is_substitution,
            related_player_id=related_player_id,
            is_newcomer=is_newcomer,
            is_newcomer_role=is_newcomer_role,
            workspace_member_id=workspace_member_id,
        )

        await self.player_repo.create(session, player)
        await session.commit()
        return player


team_service = TeamService()
_resolve_workspace_member_id = team_service._resolve_workspace_member_id
resolve_workspace_member_ids = team_service.resolve_workspace_member_ids
get_by_tournament = team_service.get_by_tournament
get_by_players_by_ids_tournament = team_service.get_by_players_by_ids_tournament
get_player_by_team_and_user = team_service.get_player_by_team_and_user
get_player_by_user_and_role = team_service.get_player_by_user_and_role
create_player = team_service.create_player


def team_entities(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    entities: list[_AbstractLoad] = []

    if "tournament" in in_entities:
        entities.append(utils.join_entity(child, models.Team.tournament))
    if "players" in in_entities:
        players_entities = utils.prepare_entities(in_entities, "players")
        players_entity = utils.join_entity(child, models.Team.players)
        entities.append(players_entity)
        # PlayerRead.user_id is a required field (resolved from
        # workspace_member.player_id, contract step iwrefac07), so
        # workspace_member itself must always be loaded here -- not just when
        # "user"/"workspace_member" is requested. The nested
        # workspace_member.player (+ further user sub-entities) stays gated
        # behind "user" since that's the expensive/optional part.
        workspace_member_entity = utils.join_entity(players_entity, models.Player.workspace_member)
        entities.append(workspace_member_entity)
        if "user" in players_entities:
            user_entity = utils.join_entity(workspace_member_entity, models.WorkspaceMember.player)
            entities.append(user_entity)
            entities.extend(UserRepository.identity_options(utils.prepare_entities(players_entities, "user"), user_entity))
    if "captain" in in_entities:
        captain_entity = utils.join_entity(child, models.Team.captain)
        entities.append(captain_entity)
        entities.extend(UserRepository.identity_options(utils.prepare_entities(in_entities, "captain"), captain_entity))
    if "placement" in in_entities:
        entities.append(utils.join_entity(child, models.Team.standings))

    return entities


def player_entities(entities_in: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    entities = []

    # PlayerRead.user_id is a required field resolved from
    # workspace_member.player_id (contract step iwrefac07), so workspace_member
    # is always loaded here -- the nested .player (full user profile) stays
    # gated behind "user".
    workspace_member_entity = utils.join_entity(child, models.Player.workspace_member)
    entities.append(workspace_member_entity)
    if "user" in entities_in:
        entities.append(utils.join_entity(workspace_member_entity, models.WorkspaceMember.player))
    if "tournament" in entities_in:
        entities.append(utils.join_entity(child, models.Player.tournament))
    if "team" in entities_in:
        team_entity = utils.join_entity(child, models.Player.team)
        entities.append(team_entity)
        entities.extend(team_entities(utils.prepare_entities(entities_in, "team"), team_entity))

    return entities
