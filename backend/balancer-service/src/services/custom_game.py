from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.player_sub_roles import REGISTRATION_ROLE_CODES
from shared.domain.roster_shape import DEFAULT_ROSTER_SLOTS
from shared.repository import CustomGamePlayerRepository, CustomGameRepository
from shared.services.division_grid.access import get_effective_division_grid
from shared.services.member_rank import MIX_ORDER, MemberRankService, member_rank_service
from shared.services.workspace_roster import RosterMember, list_roster
from src.services.balancer.solver import run_balance as _run_balance

__all__ = ("CustomGameService", "custom_game_service")

_TERMINAL = frozenset({"completed", "cancelled"})
_CONFIG_ONLY = frozenset({"role_mask", "team_count"})
#: A roster row owns only its lineup state. A rank correction goes into the
#: host's own layer of ``member_rank``, so it outlives the game it was made in.
_PLAYER_PATCH_FIELDS = frozenset({"is_active", "roles"})


def _require_host(actor_user_id: int, host_user_id: int | None) -> None:
    if host_user_id is None or actor_user_id != host_user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the host can write this pool")


def _noop_progress(*_args: Any, **_kwargs: Any) -> None:
    return None


def _uniq(ids: Sequence[int]) -> list[int]:
    seen: set[int] = set()
    out: list[int] = []
    for item in ids:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _normalize_roles(raw: Any) -> list[str] | None:
    """Ordered, de-duplicated registration role codes; ``None`` means "all ranked"."""
    if raw is None:
        return None
    if not isinstance(raw, (list, tuple)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="roles must be a list")
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        code = str(item).strip().lower()
        if code not in REGISTRATION_ROLE_CODES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"unknown role {code}")
        if code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


def _invalidate_balance(game: models.CustomGame, roster: Sequence[models.CustomGamePlayer]) -> None:
    """Any lineup edit makes a stored balance stale, so drop it and its team map."""
    if game.status != "balanced":
        return
    game.status = "draft"
    game.result_json = None
    for row in roster:
        row.team_index = None


def _apply_team_index(roster: Sequence[models.CustomGamePlayer], result: Any) -> None:
    by_uuid = {str(row.workspace_member_id): row for row in roster}
    for row in roster:
        row.team_index = None
    payload = result
    if isinstance(result, dict):
        variants = result.get("variants")
        if isinstance(variants, list) and variants:
            payload = variants[0]
    teams = payload.get("teams") if isinstance(payload, dict) else None
    if not isinstance(teams, list):
        return
    for index, team in enumerate(teams):
        if not isinstance(team, dict):
            continue
        slots = team.get("roster")
        groups: list[Any]
        if isinstance(slots, dict):
            groups = list(slots.values())
        elif isinstance(slots, list):
            groups = [slots]
        else:
            continue
        for group in groups:
            if not isinstance(group, list):
                continue
            for player in group:
                if not isinstance(player, dict):
                    continue
                uuid = player.get("uuid")
                row = by_uuid.get(str(uuid)) if uuid is not None else None
                if row is not None:
                    row.team_index = index


class CustomGameService:
    def __init__(
        self,
        *,
        games: CustomGameRepository = CustomGameRepository(),
        roster: CustomGamePlayerRepository = CustomGamePlayerRepository(),
        ranks: MemberRankService | None = None,
        load_roster=list_roster,
        run_balance=_run_balance,
    ) -> None:
        self.games = games
        self.roster = roster
        self.ranks = ranks if ranks is not None else member_rank_service
        self.load_roster = load_roster
        self.run_balance = run_balance

    async def members(
        self, session: AsyncSession, workspace_id: int, member_ids: Sequence[int]
    ) -> dict[int, RosterMember]:
        """Named roster rows for a lineup -- and the tenancy check on the way in.

        ``list_roster`` already filters by ``workspace_id``, so an id absent from
        the result either does not exist or belongs to another workspace. Both are
        the same 404 on purpose: telling them apart would leak the membership of a
        workspace the caller is not in.
        """
        ids = _uniq(member_ids)
        if not ids:
            return {}
        found = await self.load_roster(session, workspace_id=workspace_id, member_ids=ids)
        if len(found) != len(ids):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace member not found")
        return found

    async def get(self, session: AsyncSession, *, workspace_id: int, custom_game_id: int) -> models.CustomGame:
        game = await self.games.get(session, custom_game_id)
        if game is None or game.workspace_id != workspace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom game not found")
        return game

    async def list(self, session: AsyncSession, *, workspace_id: int) -> list[models.CustomGame]:
        return list(await self.games.list_for_workspace(session, workspace_id))

    async def _writable(
        self, session: AsyncSession, *, workspace_id: int, custom_game_id: int, actor_user_id: int
    ) -> models.CustomGame:
        game = await self.get(session, workspace_id=workspace_id, custom_game_id=custom_game_id)
        _require_host(actor_user_id, game.host_user_id)
        if game.status in _TERMINAL:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Game is {game.status}")
        return game

    async def create(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        host_user_id: int,
        name: str,
        actor_user_id: int,
        member_ids: Sequence[int] = (),
        config_json: Mapping[str, Any] | None = None,
    ) -> models.CustomGame:
        _require_host(actor_user_id, host_user_id)
        trimmed = name.strip() if isinstance(name, str) else ""
        if not trimmed:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name is required")
        ids = _uniq(member_ids)
        await self.members(session, workspace_id, ids)
        game = models.CustomGame(
            workspace_id=workspace_id,
            host_user_id=host_user_id,
            name=trimmed,
            status="draft",
            config_json=dict(config_json) if config_json is not None else None,
        )
        await self.games.create(session, game)
        rows = [
            models.CustomGamePlayer(custom_game_id=game.id, workspace_member_id=item, sort_order=index)
            for index, item in enumerate(ids)
        ]
        if rows:
            await self.roster.create_many(session, rows)
        return game

    async def update_roster(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        member_ids: Sequence[int],
        actor_user_id: int,
    ) -> models.CustomGame:
        """Set pool membership, keeping every surviving row's lineup state.

        Adding or dropping one player must not reset the bench switches and role
        orders the host already tuned for everybody else, so rows are matched by
        ``workspace_member_id`` instead of rebuilt from scratch.
        """
        game = await self._writable(
            session, workspace_id=workspace_id, custom_game_id=custom_game_id, actor_user_id=actor_user_id
        )
        ids = _uniq(member_ids)
        await self.members(session, workspace_id, ids)
        existing = {row.workspace_member_id: row for row in await self.roster.list_for_game(session, game.id)}
        _invalidate_balance(game, existing.values())
        wanted = set(ids)
        for member_id, row in existing.items():
            if member_id not in wanted:
                await self.roster.delete(session, row)
        created: list[models.CustomGamePlayer] = []
        for index, member_id in enumerate(ids):
            row = existing.get(member_id)
            if row is None:
                created.append(
                    models.CustomGamePlayer(
                        custom_game_id=game.id, workspace_member_id=member_id, sort_order=index
                    )
                )
            else:
                row.sort_order = index
        if created:
            await self.roster.create_many(session, created)
        await session.flush()
        return game

    async def update_player(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        workspace_member_id: int,
        patch: Mapping[str, Any],
        actor_user_id: int,
    ) -> models.CustomGame:
        """Patch one roster row: ``is_active`` and/or ``roles``.

        A patch, not a replace: an absent key is left alone, so the bench switch
        and the role order are independently settable from separate controls.
        """
        unknown = sorted(set(patch) - _PLAYER_PATCH_FIELDS)
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"unknown fields {unknown}"
            )
        game = await self._writable(
            session, workspace_id=workspace_id, custom_game_id=custom_game_id, actor_user_id=actor_user_id
        )
        roster = list(await self.roster.list_for_game(session, game.id))
        row = next((item for item in roster if item.workspace_member_id == workspace_member_id), None)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom game player not found")
        if "is_active" in patch:
            row.is_active = bool(patch["is_active"])
        if "roles" in patch:
            row.roles_json = _normalize_roles(patch["roles"])
        _invalidate_balance(game, roster)
        await session.flush()
        return game

    async def balance(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        actor_user_id: int,
    ) -> models.CustomGame:
        game = await self._writable(
            session, workspace_id=workspace_id, custom_game_id=custom_game_id, actor_user_id=actor_user_id
        )
        roster = list(await self.roster.list_for_game(session, game.id))
        lineup = [row for row in roster if row.is_active]
        if not lineup:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="empty_lineup")
        members = await self.members(session, workspace_id, [row.workspace_member_id for row in lineup])
        resolved = await self.ranks.resolve(
            session,
            workspace_id=workspace_id,
            members={member_id: member.player_id for member_id, member in members.items()},
            roles=list(REGISTRATION_ROLE_CODES),
            # ``MIX_ORDER`` puts the host's own book above the workspace canon: a
            # mix balances on this host's read of these players, not the official one.
            order=MIX_ORDER,
            author_user_id=game.host_user_id,
            grid=await get_effective_division_grid(session, None),
        )
        player_nodes: dict[str, Any] = {}
        for row in lineup:
            member = members[row.workspace_member_id]
            classes: dict[str, Any] = {}
            # Role order is the priority the host set; an unlisted role is not played.
            for priority, role in enumerate(row.roles_json or REGISTRATION_ROLE_CODES, start=1):
                ranked = resolved.get((member.member_id, role))
                if ranked is None or ranked.value is None:
                    continue
                classes[role] = {"isActive": True, "rank": ranked.value, "priority": priority}
            if not classes:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="missing_ranked_role")
            player_nodes[str(member.member_id)] = {
                "identity": {
                    "name": member.display_name or member.battle_tag or f"player-{member.member_id}",
                    "isFullFlex": False,
                },
                "stats": {"classes": classes},
            }
        config = game.config_json or {}
        role_mask = config.get("role_mask") or dict(DEFAULT_ROSTER_SLOTS)
        config_overrides = {key: value for key, value in config.items() if key not in _CONFIG_ONLY}
        result = await self.run_balance(
            {"players": player_nodes},
            config_overrides or None,
            _noop_progress,
            role_mask,
        )
        game.result_json = result
        _apply_team_index(roster, result)
        game.status = "balanced"
        await session.flush()
        return game

    async def record_outcome(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        outcome_json: Mapping[str, Any],
        actor_user_id: int,
    ) -> models.CustomGame:
        game = await self._writable(
            session, workspace_id=workspace_id, custom_game_id=custom_game_id, actor_user_id=actor_user_id
        )
        game.status = "completed"
        game.outcome_json = dict(outcome_json)
        await session.flush()
        return game

    async def cancel(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        actor_user_id: int,
    ) -> models.CustomGame:
        game = await self._writable(
            session, workspace_id=workspace_id, custom_game_id=custom_game_id, actor_user_id=actor_user_id
        )
        game.status = "cancelled"
        await session.flush()
        return game


custom_game_service = CustomGameService()
