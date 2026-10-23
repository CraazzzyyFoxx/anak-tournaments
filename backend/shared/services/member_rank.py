"""Read and write a workspace member's ranks, in layers.

Workspace canon (``author_user_id`` ``None``) and a host's per-host book
(``author_user_id`` set) differ only in which columns key the row: one write
method takes ``author_user_id`` and one resolver takes the layer order it should
honour.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.disciplines import discipline as discipline_spec
from shared.division_grid import DivisionGrid, normalize_native_ranks_to_grid
from shared.domain.member_rank import RankScope, ResolvedRank, pick_rank
from shared.repository import CatalogRoleRepository, WorkspaceMemberRepository
from shared.repository.member_rank import MemberRankRepository

__all__ = ("MemberRankService", "member_rank_service")

#: Layer order for a pickup mix: the host's own book, then the workspace, then the game's native ladder.
MIX_ORDER: tuple[RankScope, ...] = ("author", "workspace", "native")

#: Layer order for a tournament: the registration's own number (what the
#: organiser set), then the workspace canon, then the game's native ladder. An empty
#: ``registration_role.rank_value`` therefore *inherits* rather than reading as
#: "unranked".
TOURNAMENT_ORDER: tuple[RankScope, ...] = ("registration", "workspace", "native")


class MemberRankService:
    def __init__(
        self,
        *,
        ranks: MemberRankRepository = MemberRankRepository(),
        members: WorkspaceMemberRepository = WorkspaceMemberRepository(),
        roles: CatalogRoleRepository = CatalogRoleRepository(),
    ) -> None:
        self.ranks = ranks
        self.members = members
        self.roles = roles

    async def _dimension_id(self, session: AsyncSession, discipline: str) -> int:
        """The discipline's rated dimension: the axis every rank is held on."""
        dimension_id = await self.roles.rated_dimension_id(session, discipline=discipline)
        if dimension_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"discipline_has_no_ranks: {discipline!r}"
            )
        return dimension_id

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
        discipline: str,
        workspace_member_id: int,
        ranks: Mapping[str, int],
        clear: Sequence[str] = (),
        author_user_id: int | None = None,
    ) -> dict[str, int]:
        """Upsert one layer; ``clear`` deletes those roles from it outright.

        Deleting rather than zeroing is what keeps inheritance working: an absent
        row falls through to the next layer, a row holding ``0`` would not. An
        omitted role is left alone, so saving one role never disturbs the others.
        A code outside the discipline's rated module roles -- ``flex`` included -- is refused.
        """
        await self.member_in_workspace(session, workspace_id=workspace_id, workspace_member_id=workspace_member_id)
        catalog = await self.roles.rated_rows(session, discipline=discipline, workspace_id=None)
        unknown = sorted({*ranks, *clear} - set(catalog))
        if unknown or not catalog:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"unknown_role: {unknown or discipline}"
            )
        dimension_id = next(iter(catalog.values())).dimension_id
        existing = {
            row.role: row
            for row in await self.ranks.list_layer(
                session,
                workspace_id=workspace_id,
                dimension_id=dimension_id,
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
                catalog_role=catalog[role],
                dimension_id=dimension_id,
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
                        dimension_id=dimension_id,
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
        discipline: str,
        member_ids: Sequence[int],
        author_user_id: int | None = None,
    ) -> dict[tuple[int, str], int]:
        """One layer, flattened to ``{(member_id, role): rank}`` for the wire."""
        rows = await self.ranks.list_layers(
            session,
            workspace_id=workspace_id,
            dimension_id=await self._dimension_id(session, discipline),
            member_ids=member_ids,
            author_user_id=author_user_id,
            include_canon=author_user_id is None,
        )
        return {(row.workspace_member_id, row.role): row.rank_value for row in rows}

    async def list_layer_rows(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        discipline: str,
        member_ids: Sequence[int],
        author_user_id: int | None = None,
    ) -> Sequence[models.MemberRank]:
        """Canon + one author's own layer, raw rows, in one round trip.

        The same fetch ``resolve`` makes internally. A caller that also needs the
        author-only rows un-mixed with canon (to show the host's own book
        verbatim) feeds the result back into ``resolve(layers=...)`` so the query
        runs once.
        """
        return await self.ranks.list_layers(
            session,
            workspace_id=workspace_id,
            dimension_id=await self._dimension_id(session, discipline),
            member_ids=member_ids,
            author_user_id=author_user_id,
            include_canon=True,
        )

    async def list_authors(self, session: AsyncSession, *, workspace_id: int) -> Sequence[tuple[int, int]]:
        """Every account that has personally rank-corrected someone in this
        workspace, busiest first -- see ``MemberRankRepository.list_authors``.
        """
        return await self.ranks.list_authors(session, workspace_id=workspace_id)

    async def resolve(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        discipline: str,
        members: Mapping[int, int | None],
        roles: Sequence[str],
        order: Sequence[RankScope],
        author_user_id: int | None = None,
        registration_ranks: Mapping[tuple[int, str], int] | None = None,
        grid: DivisionGrid | None = None,
        layers: Sequence[models.MemberRank] | None = None,
    ) -> dict[tuple[int, str], ResolvedRank]:
        """Effective rank per ``(workspace_member_id, role)``.

        ``members`` maps a member id to its ``players.user`` id (``None`` when the
        member has no player to carry a native rank). ``order`` names
        the layers to consult, strongest first; a layer not named is not queried,
        so a tournament never pays for the author book and a mix never pays for
        the registration join.

        ``layers``, when given, is the canon+author row set a caller already
        fetched via ``list_layer_rows`` -- skips this method's own identical
        query instead of running it twice in the same request.
        """
        if not members or not roles:
            return {}

        wants_author = "author" in order and author_user_id is not None
        wants_canon = "workspace" in order
        canon: dict[tuple[int, str], int] = {}
        author: dict[tuple[int, str], int] = {}
        if wants_author or wants_canon:
            rows = (
                layers
                if layers is not None
                else await self.ranks.list_layers(
                    session,
                    workspace_id=workspace_id,
                    dimension_id=await self._dimension_id(session, discipline),
                    member_ids=list(members),
                    author_user_id=author_user_id if wants_author else None,
                    include_canon=wants_canon,
                )
            )
            for row in rows:
                bucket = canon if row.author_user_id is None else author
                bucket[(row.workspace_member_id, row.role)] = row.rank_value

        stored: dict[RankScope, Mapping[tuple[int, str], int]] = {
            "author": author,
            "registration": registration_ranks or {},
            "workspace": canon,
        }

        native_by_user: dict[int, dict[str, int]] = {}
        native = discipline_spec(discipline).native_ranks
        if "native" in order and native is not None:
            # Pay for the native read only where a cheaper layer left a hole.
            cheaper = [scope for scope in order if scope != "native"]
            need = {
                player_id
                for member_id, player_id in members.items()
                if player_id is not None
                and any(all(stored[scope].get((member_id, role)) is None for scope in cheaper) for role in roles)
            }
            if need:
                raw = await native(session, sorted(need))
                native_by_user = normalize_native_ranks_to_grid(raw, grid) if grid is not None else raw

        out: dict[tuple[int, str], ResolvedRank] = {}
        for member_id, player_id in members.items():
            native_roles = native_by_user.get(player_id, {}) if player_id is not None else {}
            for role in roles:
                key = (member_id, role)
                out[key] = pick_rank(
                    [
                        (scope, native_roles.get(role) if scope == "native" else stored[scope].get(key))
                        for scope in order
                    ]
                )
        return out


member_rank_service = MemberRankService()
