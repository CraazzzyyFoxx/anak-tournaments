from __future__ import annotations

from collections.abc import Mapping, Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.division_grid import DivisionGrid
from shared.domain.workspace_player import (
    ResolvedRank,
    merge_ranks,
    normalize_battle_tag,
    normalize_battle_tag_key,
    pick_rank,
)
from shared.repository import (
    HostPlayerRankRepository,
    HostPlayerRepository,
    WorkspacePlayerRankRepository,
    WorkspacePlayerRepository,
)
from shared.services.rank_snapshots import fetch_latest_ow_ranks_by_account, normalize_ow_ranks_to_grid

__all__ = ("WorkspacePlayerService", "workspace_player_service")


class WorkspacePlayerService:
    def __init__(
        self,
        *,
        players: WorkspacePlayerRepository = WorkspacePlayerRepository(),
        ranks: WorkspacePlayerRankRepository = WorkspacePlayerRankRepository(),
        host_players: HostPlayerRepository = HostPlayerRepository(),
        host_ranks: HostPlayerRankRepository = HostPlayerRankRepository(),
    ) -> None:
        self.players = players
        self.ranks = ranks
        self.host_players = host_players
        self.host_ranks = host_ranks

    async def upsert(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        battle_tag: str,
        display_name: str | None = None,
    ) -> models.WorkspacePlayer:
        normalized = normalize_battle_tag(battle_tag)
        key = normalize_battle_tag_key(battle_tag)
        if normalized is None or key is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="battle_tag is required")
        existing = await self.players.get_active_by_tag(session, workspace_id, key)
        if existing is not None:
            existing.battle_tag = normalized
            if display_name is not None:
                existing.display_name = display_name
            await session.flush()
            return existing
        row = models.WorkspacePlayer(
            workspace_id=workspace_id,
            battle_tag=normalized,
            battle_tag_normalized=key,
            display_name=display_name,
        )
        try:
            async with session.begin_nested():
                return await self.players.create(session, row)
        except IntegrityError:
            raced = await self.players.get_active_by_tag(session, workspace_id, key)
            if raced is None:
                raise
            return raced

    async def link(
        self,
        session: AsyncSession,
        *,
        workspace_player_id: int,
        player_id: int,
        workspace_member_id: int | None = None,
    ) -> models.WorkspacePlayer:
        row = await self.players.get(session, workspace_player_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace player not found")
        taken = await self.players.get_active_by_player_id(session, row.workspace_id, player_id)
        if taken is not None and taken.id != row.id:
            return await self._merge_link(
                session, survivor_id=taken.id, donor_id=row.id, workspace_member_id=workspace_member_id
            )
        try:
            async with session.begin_nested():
                row.player_id = player_id
                if workspace_member_id is not None:
                    row.workspace_member_id = workspace_member_id
                await session.flush()
        except IntegrityError:
            raced = await self.players.get_active_by_player_id(session, row.workspace_id, player_id)
            if raced is None or raced.id == row.id:
                raise
            return await self._merge_link(
                session, survivor_id=raced.id, donor_id=row.id, workspace_member_id=workspace_member_id
            )
        return row

    async def _merge_link(
        self,
        session: AsyncSession,
        *,
        survivor_id: int,
        donor_id: int,
        workspace_member_id: int | None,
    ) -> models.WorkspacePlayer:
        merged = await self.merge(session, survivor_id=survivor_id, donor_id=donor_id)
        if workspace_member_id is not None:
            merged.workspace_member_id = workspace_member_id
            await session.flush()
        return merged

    async def merge(self, session: AsyncSession, *, survivor_id: int, donor_id: int) -> models.WorkspacePlayer:
        survivor = await self.players.get(session, survivor_id)
        donor = await self.players.get(session, donor_id)
        if survivor is None or donor is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace player not found")
        if survivor.workspace_id != donor.workspace_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot merge workspace players from different workspaces",
            )
        if survivor.id == donor.id:
            return survivor
        survivor_ranks = await self.ranks.list_ranks(session, survivor.id)
        donor_ranks = await self.ranks.list_ranks(session, donor.id)
        plan = merge_ranks(survivor_ranks, donor_ranks)
        by_id = {rank.id: rank for rank in (*survivor_ranks, *donor_ranks) if rank.id is not None}
        for rank_id in plan.delete_ids:
            await self.ranks.delete(session, by_id[rank_id])
        for moved in plan.move:
            if moved.id is None:
                continue
            by_id[moved.id].workspace_player_id = survivor.id
        if plan.move:
            await session.flush()
        await self._merge_host_layer(session, survivor=survivor, donor=donor)
        await self.players.delete(session, donor)
        return survivor

    async def _merge_host_layer(
        self,
        session: AsyncSession,
        *,
        survivor: models.WorkspacePlayer,
        donor: models.WorkspacePlayer,
    ) -> None:
        survivor_hosts = await self.host_players.list_for_player(session, survivor.id)
        donor_hosts = await self.host_players.list_for_player(session, donor.id)
        taken = {row.host_user_id for row in survivor_hosts}
        moved_hosts = False
        for row in donor_hosts:
            if row.host_user_id in taken:
                continue
            row.workspace_player_id = survivor.id
            taken.add(row.host_user_id)
            moved_hosts = True
        if moved_hosts:
            await session.flush()

        survivor_book = await self.host_ranks.list_for_player(session, survivor.id)
        donor_book = await self.host_ranks.list_for_player(session, donor.id)
        s_by: dict[int, list] = {}
        d_by: dict[int, list] = {}
        for row in survivor_book:
            s_by.setdefault(row.host_user_id, []).append(row)
        for row in donor_book:
            d_by.setdefault(row.host_user_id, []).append(row)
        book_by_id = {row.id: row for row in (*survivor_book, *donor_book) if row.id is not None}
        moved_book = False
        for host_id in set(s_by) | set(d_by):
            host_plan = merge_ranks(s_by.get(host_id, []), d_by.get(host_id, []))
            for rank_id in host_plan.delete_ids:
                await self.host_ranks.delete(session, book_by_id[rank_id])
            for moved in host_plan.move:
                if moved.id is None:
                    continue
                book_by_id[moved.id].workspace_player_id = survivor.id
                moved_book = True
        if moved_book:
            await session.flush()

    async def set_ranks(
        self,
        session: AsyncSession,
        *,
        workspace_player_id: int,
        ranks: Mapping[str, int],
        only_empty: bool = False,
    ) -> dict[str, int]:
        """Write canon ranks. ``only_empty`` leaves cells that already have a value."""
        existing = {row.role: row for row in await self.ranks.list_ranks(session, workspace_player_id)}
        for role, value in ranks.items():
            row = existing.get(role)
            if row is None:
                created = models.WorkspacePlayerRank(
                    workspace_player_id=workspace_player_id,
                    role=role,
                    rank_value=value,
                )
                try:
                    async with session.begin_nested():
                        await self.ranks.create(session, created)
                    existing[role] = created
                except IntegrityError:
                    raced = {r.role: r for r in await self.ranks.list_ranks(session, workspace_player_id)}
                    row = raced.get(role)
                    if row is None:
                        raise
                    existing[role] = row
                    if not only_empty:
                        row.rank_value = value
            elif not only_empty:
                row.rank_value = value
        await session.flush()
        return {role: row.rank_value for role, row in existing.items()}

    async def resolve_ranks(
        self,
        session: AsyncSession,
        *,
        players: Sequence[models.WorkspacePlayer],
        roles: Sequence[str],
        overrides: Mapping[tuple[int, str], int] | None = None,
        grid: DivisionGrid | None = None,
        host_user_id: int | None = None,
    ) -> dict[tuple[int, str], ResolvedRank]:
        if not players or not roles:
            return {}
        pins = overrides or {}
        player_ids = [player.id for player in players]
        rows = await self.ranks.list_ranks_for_players(session, player_ids)
        canon = {(row.workspace_player_id, row.role): row.rank_value for row in rows}
        host: dict[tuple[int, str], int] = {}
        if host_user_id is not None:
            host_rows = await self.host_ranks.list_for_host_players(session, host_user_id, player_ids)
            host = {(row.workspace_player_id, row.role): row.rank_value for row in host_rows}

        need_ow: list[int] = []
        seen: set[int] = set()
        for player in players:
            uid = player.player_id
            if uid is None or uid in seen:
                continue
            if any(
                pins.get((player.id, role)) is None
                and host.get((player.id, role)) is None
                and canon.get((player.id, role)) is None
                for role in roles
            ):
                seen.add(uid)
                need_ow.append(uid)

        ow_by_user: dict[int, dict[str, int]] = {}
        if need_ow:
            collapsed = _max_ow_by_user(await fetch_latest_ow_ranks_by_account(session, need_ow))
            ow_by_user = normalize_ow_ranks_to_grid(collapsed, grid) if grid is not None else collapsed

        out: dict[tuple[int, str], ResolvedRank] = {}
        for player in players:
            ow_roles = ow_by_user.get(player.player_id, {}) if player.player_id is not None else {}
            for role in roles:
                key = (player.id, role)
                out[key] = pick_rank(
                    override=pins.get(key),
                    host=host.get(key),
                    canon=canon.get(key),
                    ow=ow_roles.get(role),
                )
        return out

    async def resolve_rank(
        self,
        session: AsyncSession,
        *,
        player: models.WorkspacePlayer,
        role: str,
        overrides: Mapping[tuple[int, str], int] | None = None,
        grid: DivisionGrid | None = None,
        host_user_id: int | None = None,
    ) -> ResolvedRank:
        resolved = await self.resolve_ranks(
            session,
            players=[player],
            roles=[role],
            overrides=overrides,
            grid=grid,
            host_user_id=host_user_id,
        )
        return resolved[(player.id, role)]


def _max_ow_by_user(accounts: dict[int, dict[str, dict[str, int]]]) -> dict[int, dict[str, int]]:
    out: dict[int, dict[str, int]] = {}
    for user_id, by_tag in accounts.items():
        by_role: dict[str, int] = {}
        for ranks in by_tag.values():
            for role, value in ranks.items():
                prev = by_role.get(role)
                if prev is None or value > prev:
                    by_role[role] = value
        if by_role:
            out[user_id] = by_role
    return out


workspace_player_service = WorkspacePlayerService()
