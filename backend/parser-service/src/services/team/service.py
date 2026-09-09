import typing

from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.player_sub_roles import normalize_sub_role
from shared.repository import (
    PlayerRepository,
    TeamRepository,
    WorkspaceMemberRepository,
    resolve_workspace_member_id,
)
from src import models
from src.core import enums


class TeamService:
    def __init__(
        self,
        *,
        player_repo: PlayerRepository = PlayerRepository(),
        team_repo: TeamRepository = TeamRepository(),
        workspace_member_repo: WorkspaceMemberRepository = WorkspaceMemberRepository(),
    ) -> None:
        self.player_repo = player_repo
        self.team_repo = team_repo
        self.workspace_member_repo = workspace_member_repo

    async def _resolve_workspace_member_id(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        player_id: int,
    ) -> int:
        """Resolve the ``workspace_member`` anchor for a roster player being created.

        Delegates to the shared core (workspace from tournament, then an
        idempotent get-or-create) that ``tournament-service``'s admin player CRUD
        derives this identically from; only the not-found error differs per
        service, which is why it stays here rather than in the shared helper.
        """
        member_id = await resolve_workspace_member_id(session, tournament_id=tournament_id, player_id=player_id)
        if member_id is None:
            raise ValueError(f"Tournament {tournament_id} not found")
        return member_id

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
        return await self.team_repo.list_by_tournament(
            session, tournament_id, options=TeamRepository.team_entities(entities)
        )

    async def get_by_players_by_ids_tournament(
        self,
        session: AsyncSession,
        players_ids: list[int],
        tournament: models.Tournament,
        entities: list[str],
    ) -> models.Team | None:
        return await self.team_repo.get_by_player_ids(
            session, players_ids, tournament.id, options=TeamRepository.team_entities(entities)
        )

    async def get_player_by_team_and_user(
        self, session: AsyncSession, team_id: int, user_id: int, entities: list[str]
    ) -> models.Player | None:
        return await self.player_repo.get_by_team_and_user(
            session, team_id=team_id, user_id=user_id, options=PlayerRepository.player_entities(entities)
        )

    async def get_player_by_user_and_role(
        self, session: AsyncSession, user_id: int, role: enums.HeroClass, entities: list[str]
    ) -> typing.Sequence[models.Player]:
        return await self.player_repo.list_by_user_and_role(
            session, user_id=user_id, role=role, options=PlayerRepository.player_entities(entities)
        )

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
