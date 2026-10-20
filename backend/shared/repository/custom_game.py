from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from shared import models
from shared.core.enums import MixStatus
from shared.core.errors import BaseAPIException
from shared.repository.base import BaseRepository
from shared.repository.roles import CatalogRoleRepository


class CustomGameRepository(BaseRepository[models.CustomGame]):
    def __init__(self) -> None:
        super().__init__(models.CustomGame)

    async def list_for_workspace(
        self, session: AsyncSession, workspace_id: int, discipline: str | None = None
    ) -> Sequence[models.CustomGame]:
        """Every mix of the workspace, newest first; one game's when ``discipline`` is given."""
        query = self.select().where(self.model.workspace_id == workspace_id)
        if discipline is not None:
            query = query.where(self.model.discipline == discipline)
        result = await session.scalars(query.order_by(self.model.id.desc()))
        return result.all()

    async def list_open_runnable(
        self, session: AsyncSession, workspace_id: int, *, user_id: int | None
    ) -> Sequence[sa.Row[tuple[int, str, int]]]:
        """``(id, name, lobby_count)`` of the open mixes ``user_id`` hosts or co-hosts, newest first.

        ``user_id=None`` drops the host filter: every open mix of the workspace.
        """
        query = (
            sa.select(models.CustomGame.id, models.CustomGame.name, models.CustomGame.lobby_count)
            .where(
                models.CustomGame.workspace_id == workspace_id,
                models.CustomGame.status.in_((MixStatus.DRAFT, MixStatus.BALANCED)),
            )
            .order_by(models.CustomGame.id.desc())
            .limit(25)  # Discord shows at most 25 autocomplete choices
        )
        if user_id is not None:
            co_hosted = sa.select(models.CustomGameCoHost.custom_game_id).where(
                models.CustomGameCoHost.user_id == user_id
            )
            query = query.where(sa.or_(models.CustomGame.host_user_id == user_id, models.CustomGame.id.in_(co_hosted)))
        return (await session.execute(query)).all()


class CustomGamePlayerRepository(BaseRepository[models.CustomGamePlayer]):
    def __init__(self) -> None:
        super().__init__(models.CustomGamePlayer)

    async def list_for_game(self, session: AsyncSession, custom_game_id: int) -> Sequence[models.CustomGamePlayer]:
        result = await session.scalars(
            self.select()
            .where(self.model.custom_game_id == custom_game_id)
            .order_by(self.model.sort_order, self.model.id)
        )
        return result.all()

    async def delete_for_game(self, session: AsyncSession, custom_game_id: int) -> None:
        for row in await self.list_for_game(session, custom_game_id):
            await self.delete(session, row)


class CustomGameCoHostRepository:
    async def user_ids_for_game(self, session: AsyncSession, custom_game_id: int) -> list[int]:
        result = await session.scalars(
            sa.select(models.CustomGameCoHost.user_id).where(models.CustomGameCoHost.custom_game_id == custom_game_id)
        )
        return list(result.all())

    async def add(self, session: AsyncSession, custom_game_id: int, user_id: int) -> None:
        session.add(models.CustomGameCoHost(custom_game_id=custom_game_id, user_id=user_id))
        await session.flush()

    async def remove(self, session: AsyncSession, custom_game_id: int, user_id: int) -> None:
        await session.execute(
            sa.delete(models.CustomGameCoHost).where(
                models.CustomGameCoHost.custom_game_id == custom_game_id,
                models.CustomGameCoHost.user_id == user_id,
            )
        )
        await session.flush()


class CustomGamePlayerRoleRepository:
    async def roles_for_players(
        self,
        session: AsyncSession,
        custom_game_player_ids: Sequence[int],
    ) -> dict[int, list[str]]:
        if not custom_game_player_ids:
            return {}
        result = await session.scalars(
            sa.select(models.CustomGamePlayerRole)
            .where(models.CustomGamePlayerRole.custom_game_player_id.in_(custom_game_player_ids))
            .order_by(
                models.CustomGamePlayerRole.custom_game_player_id,
                models.CustomGamePlayerRole.priority,
            )
        )
        grouped: dict[int, list[str]] = {}
        for row in result.all():
            grouped.setdefault(row.custom_game_player_id, []).append(row.role)
        return grouped

    async def replace_for_player(
        self,
        session: AsyncSession,
        custom_game_player_id: int,
        roles: Sequence[str],
        *,
        discipline: str,
    ) -> None:
        rows = await CatalogRoleRepository().rated_rows(session, discipline=discipline, workspace_id=None)
        for code in roles:
            if code not in rows or rows[code].parent_role_id is not None:
                raise BaseAPIException(status_code=422, detail=f"unknown_role: {code!r}")
        await session.execute(
            sa.delete(models.CustomGamePlayerRole).where(
                models.CustomGamePlayerRole.custom_game_player_id == custom_game_player_id
            )
        )
        session.add_all(
            [
                models.CustomGamePlayerRole(
                    custom_game_player_id=custom_game_player_id,
                    dimension_id=rows[role].dimension_id,
                    role_id=rows[role].id,
                    catalog_role=rows[role],
                    priority=priority,
                )
                for priority, role in enumerate(roles, start=1)
            ]
        )
        await session.flush()


class CustomGameTeamNameRepository:
    async def mapping_for_game(self, session: AsyncSession, custom_game_id: int) -> dict[int, str]:
        result = await session.execute(
            sa.select(models.CustomGameTeamName.team_index, models.CustomGameTeamName.name).where(
                models.CustomGameTeamName.custom_game_id == custom_game_id
            )
        )
        return dict(result.all())

    async def mapping_for_games(
        self, session: AsyncSession, custom_game_ids: Sequence[int]
    ) -> dict[int, dict[int, str]]:
        """``custom_game_id -> {team_index: name}`` for a whole mix list in one query.

        A mix with no custom names is absent from the result.
        """
        if not custom_game_ids:
            return {}
        result = await session.execute(
            sa.select(
                models.CustomGameTeamName.custom_game_id,
                models.CustomGameTeamName.team_index,
                models.CustomGameTeamName.name,
            ).where(models.CustomGameTeamName.custom_game_id.in_(custom_game_ids))
        )
        grouped: dict[int, dict[int, str]] = {}
        for custom_game_id, team_index, name in result.all():
            grouped.setdefault(custom_game_id, {})[team_index] = name
        return grouped

    async def set(
        self,
        session: AsyncSession,
        custom_game_id: int,
        team_index: int,
        name: str | None,
    ) -> None:
        current = await session.get(models.CustomGameTeamName, (custom_game_id, team_index))
        if name is None:
            if current is not None:
                await session.delete(current)
        elif current is None:
            session.add(
                models.CustomGameTeamName(
                    custom_game_id=custom_game_id,
                    team_index=team_index,
                    name=name,
                )
            )
        else:
            current.name = name
        await session.flush()


class CustomGameLobbyRepository:
    """The per-lobby half of a mix, keyed by ``(custom_game_id, lobby_index)``.

    Not a ``BaseRepository``: the row has a composite primary key and no ``id``
    column, which every generic lookup there is written against.
    """

    #: Leaves the solver document in the database. It is the one heavy column a
    #: lobby has -- an entry per balance option, megabytes once balanced -- and
    #: only the detail read and the writes that edit it look at it. ``raiseload``
    #: turns a stray read into an error instead of an implicit async lazy load.
    WITHOUT_BALANCE_RESULT = (defer(models.CustomGameLobby.balance_result_json, raiseload=True),)

    async def list_for_game(self, session: AsyncSession, custom_game_id: int) -> Sequence[models.CustomGameLobby]:
        """Both lobbies of one mix in board order, documents loaded."""
        result = await session.scalars(
            sa.select(models.CustomGameLobby)
            .where(models.CustomGameLobby.custom_game_id == custom_game_id)
            .order_by(models.CustomGameLobby.lobby_index)
        )
        return result.all()

    async def list_for_games(
        self, session: AsyncSession, custom_game_ids: Sequence[int]
    ) -> dict[int, list[models.CustomGameLobby]]:
        """``custom_game_id -> [lobby, ...]`` for a whole mix list in one query,
        without the solver documents -- no list row renders one."""
        if not custom_game_ids:
            return {}
        result = await session.scalars(
            sa.select(models.CustomGameLobby)
            .where(models.CustomGameLobby.custom_game_id.in_(custom_game_ids))
            .options(*self.WITHOUT_BALANCE_RESULT)
            .order_by(models.CustomGameLobby.custom_game_id, models.CustomGameLobby.lobby_index)
        )
        grouped: dict[int, list[models.CustomGameLobby]] = {}
        for row in result.all():
            grouped.setdefault(row.custom_game_id, []).append(row)
        return grouped

    async def get(self, session: AsyncSession, custom_game_id: int, lobby_index: int) -> models.CustomGameLobby | None:
        return await session.get(models.CustomGameLobby, (custom_game_id, lobby_index))

    async def create(self, session: AsyncSession, lobby: models.CustomGameLobby) -> models.CustomGameLobby:
        session.add(lobby)
        await session.flush()
        return lobby

    async def delete(self, session: AsyncSession, lobby: models.CustomGameLobby) -> None:
        await session.delete(lobby)
        await session.flush()
