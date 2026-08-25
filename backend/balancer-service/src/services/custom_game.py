from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.player_sub_roles import REGISTRATION_ROLE_CODES
from shared.domain.roster_shape import DEFAULT_ROSTER_SLOTS
from shared.repository import (
    CustomGamePlayerRepository,
    CustomGameRepository,
    HostPlayerRepository,
    WorkspacePlayerRepository,
)
from shared.services.division_grid.access import get_effective_division_grid
from shared.services.workspace_player import WorkspacePlayerService
from src.services.balancer.solver import run_balance as _run_balance

__all__ = ("CustomGameService", "custom_game_service")

_TERMINAL = frozenset({"completed", "cancelled"})
_CONFIG_ONLY = frozenset({"role_mask", "team_count"})
_PLAYER_PATCH_FIELDS = frozenset({"rank_value", "is_active", "roles"})


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


def rank_overrides(roster: Sequence[models.CustomGamePlayer]) -> dict[tuple[int, str], int]:
    """Per-game rank pins: one ``rank_value`` shadows every role of that player."""
    out: dict[tuple[int, str], int] = {}
    for row in roster:
        if row.rank_value is None:
            continue
        for role in REGISTRATION_ROLE_CODES:
            out[(row.workspace_player_id, role)] = row.rank_value
    return out


def _apply_team_index(roster: Sequence[models.CustomGamePlayer], result: Any) -> None:
    by_uuid = {str(row.workspace_player_id): row for row in roster}
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
        players: WorkspacePlayerRepository = WorkspacePlayerRepository(),
        host_players: HostPlayerRepository = HostPlayerRepository(),
        ranks: WorkspacePlayerService | None = None,
        run_balance=_run_balance,
    ) -> None:
        self.games = games
        self.roster = roster
        self.players = players
        self.host_players = host_players
        self.ranks = ranks if ranks is not None else WorkspacePlayerService()
        self.run_balance = run_balance

    async def _load_players(
        self, session: AsyncSession, workspace_id: int, player_ids: Sequence[int]
    ) -> list[models.WorkspacePlayer]:
        ids = _uniq(player_ids)
        if not ids:
            return []
        found = {row.id: row for row in await self.players.bulk_get(session, ids)}
        if any(found.get(item) is None or found[item].workspace_id != workspace_id for item in ids):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace player not found")
        return [found[item] for item in ids]

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
        player_ids: Sequence[int] | None = None,
        config_json: Mapping[str, Any] | None = None,
    ) -> models.CustomGame:
        _require_host(actor_user_id, host_user_id)
        trimmed = name.strip() if isinstance(name, str) else ""
        if not trimmed:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name is required")
        if player_ids is None:
            pool = await self.host_players.list_pool(session, workspace_id, host_user_id)
            ids = [row.workspace_player_id for row in pool]
        else:
            ids = list(player_ids)
        await self._load_players(session, workspace_id, ids)
        game = models.CustomGame(
            workspace_id=workspace_id,
            host_user_id=host_user_id,
            name=trimmed,
            status="draft",
            config_json=dict(config_json) if config_json is not None else None,
        )
        await self.games.create(session, game)
        rows = [
            models.CustomGamePlayer(custom_game_id=game.id, workspace_player_id=item, sort_order=index)
            for index, item in enumerate(_uniq(ids))
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
        player_ids: Sequence[int],
        actor_user_id: int,
    ) -> models.CustomGame:
        """Set pool membership, keeping every surviving row's lineup state.

        Adding or dropping one player must not reset the ranks, bench switches
        and role orders the host already tuned for everybody else, so rows are
        matched by ``workspace_player_id`` instead of rebuilt from scratch.
        """
        game = await self._writable(
            session, workspace_id=workspace_id, custom_game_id=custom_game_id, actor_user_id=actor_user_id
        )
        ids = _uniq(player_ids)
        await self._load_players(session, workspace_id, ids)
        existing = {row.workspace_player_id: row for row in await self.roster.list_for_game(session, game.id)}
        _invalidate_balance(game, existing.values())
        wanted = set(ids)
        for player_id, row in existing.items():
            if player_id not in wanted:
                await self.roster.delete(session, row)
        created: list[models.CustomGamePlayer] = []
        for index, player_id in enumerate(ids):
            row = existing.get(player_id)
            if row is None:
                created.append(
                    models.CustomGamePlayer(
                        custom_game_id=game.id, workspace_player_id=player_id, sort_order=index
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
        workspace_player_id: int,
        patch: Mapping[str, Any],
        actor_user_id: int,
    ) -> models.CustomGame:
        """Patch one roster row: ``rank_value``, ``is_active`` and/or ``roles``.

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
        row = next((item for item in roster if item.workspace_player_id == workspace_player_id), None)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom game player not found")
        if "rank_value" in patch:
            raw = patch["rank_value"]
            row.rank_value = None if raw is None else int(raw)
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
        players = await self._load_players(session, workspace_id, [row.workspace_player_id for row in lineup])
        resolved = await self.ranks.resolve_ranks(
            session,
            players=players,
            roles=list(REGISTRATION_ROLE_CODES),
            overrides=rank_overrides(lineup),
            host_user_id=game.host_user_id,
            grid=await get_effective_division_grid(session, None),
        )
        by_id = {player.id: player for player in players}
        player_nodes: dict[str, Any] = {}
        for row in lineup:
            player = by_id[row.workspace_player_id]
            classes: dict[str, Any] = {}
            # Role order is the priority the host set; an unlisted role is not played.
            for priority, role in enumerate(row.roles_json or REGISTRATION_ROLE_CODES, start=1):
                ranked = resolved.get((player.id, role))
                if ranked is None or ranked.value is None:
                    continue
                classes[role] = {"isActive": True, "rank": ranked.value, "priority": priority}
            if not classes:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="missing_ranked_role")
            player_nodes[str(player.id)] = {
                "identity": {
                    "name": player.display_name or player.battle_tag or f"player-{player.id}",
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
