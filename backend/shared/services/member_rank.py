"""Read and write a workspace member's ranks, in layers.

One service replaces ``WorkspacePlayerService`` (canon) and ``HostBookService``
(per-host book). The two differed only in which columns keyed the row, so they
are now one write method taking ``author_user_id`` and one resolver taking the
layer order it should honour.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.division_grid import DivisionGrid
from shared.domain.member_rank import RankScope, ResolvedRank, pick_rank
from shared.repository import WorkspaceMemberRepository
from shared.repository.member_rank import MemberRankRepository
from shared.services.rank_snapshots import fetch_latest_ow_ranks_by_account, normalize_ow_ranks_to_grid

__all__ = ("MemberRankService", "member_rank_service")

#: Layer order for a pickup mix: the host's own book, then the workspace, then OW.
MIX_ORDER: tuple[RankScope, ...] = ("author", "workspace", "ow")

#: Layer order for a tournament: the registration's own number (what the
#: organiser set), then the workspace canon, then OW. An empty
#: ``registration_role.rank_value`` therefore *inherits* rather than reading as
#: "unranked" -- which is what it used to do before the resolver was stubbed out.
TOURNAMENT_ORDER: tuple[RankScope, ...] = ("registration", "workspace", "ow")


class MemberRankService:
    def __init__(
        self,
        *,
        ranks: MemberRankRepository = MemberRankRepository(),
        members: WorkspaceMemberRepository = WorkspaceMemberRepository(),
    ) -> None:
        self.ranks = ranks
        self.members = members

    async def member_in_workspace(
        self, session: AsyncSession, *, workspace_id: int, workspace_member_id: int
    ) -> models.WorkspaceMember:
        """Tenancy check for every rank read/write addressed by member id."""
        member = await self.members.get(session, workspace_member_id)
        if member is None or member.workspace_id != workspace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace member not found")
        return member

    async def set_ranks(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        workspace_member_id: int,
        ranks: Mapping[str, int],
        clear: Sequence[str] = (),
        author_user_id: int | None = None,
    ) -> dict[str, int]:
        """Upsert one layer; ``clear`` deletes those roles from it outright.

        Deleting rather than zeroing is what keeps inheritance working: an absent
        row falls through to the next layer, a row holding ``0`` would not. An
        omitted role is left alone, so saving one role never disturbs the others.
        """
        await self.member_in_workspace(session, workspace_id=workspace_id, workspace_member_id=workspace_member_id)
        existing = {
            row.role: row
            for row in await self.ranks.list_layer(
                session,
                workspace_id=workspace_id,
                member_id=workspace_member_id,
                author_user_id=author_user_id,
            )
        }
        for role in clear:
            row = existing.pop(role, None)
            if row is not None:
                await self.ranks.delete(session, row)
        for role, value in ranks.items():
            row = existing.get(role)
            if row is not None:
                row.rank_value = value
                continue
            created = models.MemberRank(
                workspace_id=workspace_id,
                workspace_member_id=workspace_member_id,
                author_user_id=author_user_id,
                role=role,
                rank_value=value,
            )
            try:
                async with session.begin_nested():
                    await self.ranks.create(session, created)
                existing[role] = created
            except IntegrityError:
                # Concurrent writer won the partial unique index; adopt its row.
                raced = {
                    other.role: other
                    for other in await self.ranks.list_layer(
                        session,
                        workspace_id=workspace_id,
                        member_id=workspace_member_id,
                        author_user_id=author_user_id,
                    )
                }
                row = raced.get(role)
                if row is None:
                    raise
                row.rank_value = value
                existing[role] = row
        await session.flush()
        return {role: row.rank_value for role, row in existing.items()}

    async def list_layer(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        member_ids: Sequence[int],
        author_user_id: int | None = None,
    ) -> dict[tuple[int, str], int]:
        """One layer, flattened to ``{(member_id, role): rank}`` for the wire."""
        rows = await self.ranks.list_layers(
            session,
            workspace_id=workspace_id,
            member_ids=member_ids,
            author_user_id=author_user_id,
            include_canon=author_user_id is None,
        )
        return {(row.workspace_member_id, row.role): row.rank_value for row in rows}

    async def resolve(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        members: Mapping[int, int | None],
        roles: Sequence[str],
        order: Sequence[RankScope],
        author_user_id: int | None = None,
        registration_ranks: Mapping[tuple[int, str], int] | None = None,
        grid: DivisionGrid | None = None,
    ) -> dict[tuple[int, str], ResolvedRank]:
        """Effective rank per ``(workspace_member_id, role)``.

        ``members`` maps a member id to its ``players.user`` id (``None`` when the
        member has no player rows to carry an Overwatch snapshot). ``order`` names
        the layers to consult, strongest first; a layer not named is not queried,
        so a tournament never pays for the author book and a mix never pays for
        the registration join.
        """
        if not members or not roles:
            return {}

        wants_author = "author" in order and author_user_id is not None
        wants_canon = "workspace" in order
        canon: dict[tuple[int, str], int] = {}
        author: dict[tuple[int, str], int] = {}
        if wants_author or wants_canon:
            for row in await self.ranks.list_layers(
                session,
                workspace_id=workspace_id,
                member_ids=list(members),
                author_user_id=author_user_id if wants_author else None,
                include_canon=wants_canon,
            ):
                bucket = canon if row.author_user_id is None else author
                bucket[(row.workspace_member_id, row.role)] = row.rank_value

        stored: dict[RankScope, Mapping[tuple[int, str], int]] = {
            "author": author,
            "registration": registration_ranks or {},
            "workspace": canon,
        }

        ow_by_user: dict[int, dict[str, int]] = {}
        if "ow" in order:
            # Pay for the snapshot join only where a cheaper layer left a hole.
            cheaper = [scope for scope in order if scope != "ow"]
            need = {
                player_id
                for member_id, player_id in members.items()
                if player_id is not None
                and any(
                    all(stored[scope].get((member_id, role)) is None for scope in cheaper) for role in roles
                )
            }
            if need:
                collapsed = _max_ow_by_user(await fetch_latest_ow_ranks_by_account(session, sorted(need)))
                ow_by_user = normalize_ow_ranks_to_grid(collapsed, grid) if grid is not None else collapsed

        out: dict[tuple[int, str], ResolvedRank] = {}
        for member_id, player_id in members.items():
            ow_roles = ow_by_user.get(player_id, {}) if player_id is not None else {}
            for role in roles:
                key = (member_id, role)
                out[key] = pick_rank(
                    [
                        (scope, ow_roles.get(role) if scope == "ow" else stored[scope].get(key))
                        for scope in order
                    ]
                )
        return out


def _max_ow_by_user(accounts: dict[int, dict[str, dict[str, int]]]) -> dict[int, dict[str, int]]:
    """Collapse per-account snapshots to the best rank per role, per user."""
    out: dict[int, dict[str, int]] = {}
    for user_id, by_tag in accounts.items():
        by_role: dict[str, int] = {}
        for ranks in by_tag.values():
            for role, value in ranks.items():
                previous = by_role.get(role)
                if previous is None or value > previous:
                    by_role[role] = value
        if by_role:
            out[user_id] = by_role
    return out


member_rank_service = MemberRankService()
