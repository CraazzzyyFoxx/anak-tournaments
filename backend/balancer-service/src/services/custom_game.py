from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.player_sub_roles import REGISTRATION_ROLE_CODES
from shared.domain.roster_shape import resolve_roster_shape
from shared.repository import CustomGamePlayerRepository, CustomGameRepository
from shared.schemas.roster_slots import RosterShapeRead, normalize_roster_slots
from shared.services.division_grid.access import get_effective_division_grid
from shared.services.member_rank import MIX_ORDER, MemberRankService, member_rank_service
from shared.services.roster_shape_access import get_workspace_roster_slots
from shared.services.workspace_roster import RosterMember, hosts_by_user_id, list_roster
from src.services.balancer.solver import run_balance as _run_balance

__all__ = ("CustomGameService", "custom_game_service")

_TERMINAL = frozenset({"completed", "cancelled"})
_CONFIG_ONLY = frozenset({"role_mask", "team_count", "team_names"})
#: Plenty for any pickup mix (2-3 teams in practice); guards against a
#: malformed payload turning into an unbounded dict.
_MAX_TEAMS = 8
_MAX_TEAM_NAME_LEN = 60
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


def _normalize_team_names(raw: Mapping[str, Any]) -> dict[str, str | None]:
    """Validate a host's team-name patch, keyed by 0-based team index.

    Returns the index -> trimmed-name map to write, with ``None`` standing in
    for "clear this team's override back to its computed default" -- an
    explicit empty/whitespace value, distinct from an index the caller simply
    did not mention (which ``set_team_names`` below leaves untouched).
    """
    out: dict[str, str | None] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key.isdigit():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"invalid team index: {key!r}"
            )
        index = int(key)
        if index >= _MAX_TEAMS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"team index out of range: {index}"
            )
        if value is None:
            out[str(index)] = None
            continue
        if not isinstance(value, str):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="team name must be a string")
        trimmed = value.strip()
        if not trimmed:
            out[str(index)] = None
            continue
        if len(trimmed) > _MAX_TEAM_NAME_LEN:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"team name too long (max {_MAX_TEAM_NAME_LEN} chars)",
            )
        out[str(index)] = trimmed
    return out


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


def _locate_seat(teams: Sequence[Mapping[str, Any]], uuid: str) -> tuple[int, str, int] | None:
    """Team index, role bucket and position of a seat by its player uuid."""
    for team_index, team in enumerate(teams):
        roster = team.get("roster") if isinstance(team, Mapping) else None
        if not isinstance(roster, Mapping):
            continue
        for role, entries in roster.items():
            if not isinstance(entries, list):
                continue
            for position, entry in enumerate(entries):
                if isinstance(entry, Mapping) and str(entry.get("uuid")) == uuid:
                    return team_index, role, position
    return None


def _recompute_variant_stats(variant: dict[str, Any]) -> None:
    """Re-derive the read-only verdict from a manually edited roster.

    Mirrors the solver's own arithmetic for the three metrics that are pure
    functions of the roster (``calculate_team_stats`` / ``calculate_objective_breakdown``
    in ``moo_core``): a team's average is the mean of its seats' ratings, the
    spread is the gap between the strongest and weakest team's *total* rating,
    and the standard deviation is the sample stdev of the teams' averages.

    ``composite_score`` is deliberately NOT one of these: it is a knee-score
    normalised against the whole Pareto archive the solver searched for that
    run, meaningless for a single hand-edited arrangement with no archive to
    normalise against -- so it is cleared rather than faked.
    """
    teams = variant.get("teams")
    if not isinstance(teams, list):
        return
    team_totals: list[float] = []
    team_means: list[float] = []
    off_role_count = 0
    for team in teams:
        if not isinstance(team, dict):
            continue
        roster = team.get("roster")
        ratings: list[float] = []
        if isinstance(roster, Mapping):
            for role, entries in roster.items():
                if not isinstance(entries, list):
                    continue
                for entry in entries:
                    if not isinstance(entry, Mapping):
                        continue
                    rating = entry.get("assigned_rating")
                    if isinstance(rating, int | float):
                        ratings.append(float(rating))
                    preferences = entry.get("role_preferences") or []
                    is_flex = entry.get("is_flex") is True
                    if not is_flex and preferences and preferences[0] != role:
                        off_role_count += 1
        total = sum(ratings)
        team["average_mmr"] = (total / len(ratings)) if ratings else None
        team_totals.append(total)
        if ratings:
            team_means.append(total / len(ratings))

    statistics = dict(variant.get("statistics") or {})
    statistics["composite_score"] = None
    if len(team_means) >= 2:
        mean = sum(team_means) / len(team_means)
        variance = sum((value - mean) ** 2 for value in team_means) / (len(team_means) - 1)
        statistics["mmr_std_dev"] = variance**0.5
    else:
        statistics["mmr_std_dev"] = 0.0
    statistics["max_total_rating_gap"] = (
        (max(team_totals) - min(team_totals)) if len(team_totals) >= 2 else 0.0
    )
    statistics["off_role_count"] = off_role_count
    variant["statistics"] = statistics


class CustomGameService:
    def __init__(
        self,
        *,
        games: CustomGameRepository = CustomGameRepository(),
        roster: CustomGamePlayerRepository = CustomGamePlayerRepository(),
        ranks: MemberRankService | None = None,
        load_roster=list_roster,
        load_hosts=hosts_by_user_id,
        run_balance=_run_balance,
    ) -> None:
        self.games = games
        self.roster = roster
        self.ranks = ranks if ranks is not None else member_rank_service
        self.load_roster = load_roster
        self.load_hosts = load_hosts
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

    async def hosts(
        self, session: AsyncSession, workspace_id: int, host_user_ids: Sequence[int]
    ) -> dict[int, str | None]:
        """Display name for each mix's host, keyed by ``host_user_id``.

        Unlike ``members`` this never 404s: a host who has left the workspace
        has no label, and the list falls back to the raw id rather than hiding
        the whole mix.
        """
        ids = _uniq(host_user_ids)
        if not ids:
            return {}
        return await self.load_hosts(session, workspace_id=workspace_id, user_ids=ids)

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

    async def _seed_host_ranks(
        self, session: AsyncSession, game: models.CustomGame, members: Mapping[int, RosterMember]
    ) -> None:
        """Materialise the host's own rank for everyone just added to the mix.

        A mix resolves against the host's book (``MIX_ORDER``), so an inherited
        number is one nobody in this mix owns: correcting it read as a per-game
        edit and was silently a workspace-wide one, and the sheet could offer no
        Clear because there was nothing of the host's to clear. Copying in the
        value the mix would have used anyway makes the layer explicit at the
        moment of joining -- from then on every rank in a lineup is the host's,
        editable and clearable, and the canon is a seed rather than a live
        dependency.

        Only holes are filled. An existing author rank is never overwritten, so
        re-adding somebody cannot undo a correction, and a role nobody has a
        number for anywhere stays unranked rather than being invented.
        """
        if game.host_user_id is None or not members:
            return
        resolved = await self.ranks.resolve(
            session,
            workspace_id=game.workspace_id,
            members={member_id: member.player_id for member_id, member in members.items()},
            roles=list(REGISTRATION_ROLE_CODES),
            order=MIX_ORDER,
            author_user_id=game.host_user_id,
            grid=await get_effective_division_grid(session, None),
        )
        for member_id in members:
            seed: dict[str, int] = {}
            for role in REGISTRATION_ROLE_CODES:
                rank = resolved.get((member_id, role))
                if rank is None or rank.value is None or rank.source == "author":
                    continue
                seed[role] = rank.value
            if not seed:
                continue
            await self.ranks.set_ranks(
                session,
                workspace_id=game.workspace_id,
                workspace_member_id=member_id,
                ranks=seed,
                author_user_id=game.host_user_id,
            )

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
        members = await self.members(session, workspace_id, ids)
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
        await self._seed_host_ranks(session, game, members)
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
        members = await self.members(session, workspace_id, ids)
        existing = {row.workspace_member_id: row for row in await self.roster.list_for_game(session, game.id)}
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
            await self._seed_host_ranks(
                session,
                game,
                {row.workspace_member_id: members[row.workspace_member_id] for row in created},
            )
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
        await session.flush()
        return game

    async def roster_shape(
        self, session: AsyncSession, *, workspace_id: int, config_json: Mapping[str, Any] | None
    ) -> RosterShapeRead:
        """The mix's resolved roster shape, projected the same way a tournament's is.

        Own override (``config_json['role_mask']``) -> workspace default ->
        built-in Overwatch 5v5, via the same :func:`resolve_roster_shape` a
        tournament resolves against -- so a workspace-wide roster preset reaches
        every mix run in it too, not only tournament team formation.
        """
        role_mask = (config_json or {}).get("role_mask")
        workspace_slots = await get_workspace_roster_slots(session, workspace_id)
        shape = resolve_roster_shape(role_mask, workspace_slots)
        source = "tournament" if role_mask else "workspace" if workspace_slots else "default"
        return RosterShapeRead.from_shape(shape, source=source)

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
        role_mask = (await self.roster_shape(session, workspace_id=workspace_id, config_json=config)).slots
        config_overrides = {key: value for key, value in config.items() if key not in _CONFIG_ONLY}
        try:
            result = await self.run_balance(
                {"players": player_nodes},
                config_overrides or None,
                _noop_progress,
                role_mask,
            )
        except ValueError as exc:
            # The solver raises plain ``ValueError`` for input problems it can
            # diagnose (uneven player count, short role coverage, ...). Left
            # uncaught it reaches the generic RPC handler, which cannot tell it
            # apart from a real bug and reports "internal error" -- hiding the
            # actual, actionable reason from the host.
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        game.result_json = result
        _apply_team_index(roster, result)
        game.status = "balanced"
        await session.flush()
        return game

    async def set_team_names(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        team_names: Mapping[str, Any],
        actor_user_id: int,
    ) -> models.CustomGame:
        """Patch the host's team-name overrides, one team at a time.

        Keyed by 0-based team index (the same position ``TeamColumn``/
        ``PickupResultControls`` render by) rather than by the solver's
        per-run ``team.id`` or captain, so a rename survives paging between
        balance options and re-running the solver -- both reshuffle rosters
        and captains but never the on-screen column order.

        Patch semantics, like ``update_player``: an index the caller does not
        mention is left exactly as it was, so renaming one team's column does
        not require resending every other team's current name. An index
        mentioned with an empty value clears back to the computed default.
        """
        game = await self._writable(
            session, workspace_id=workspace_id, custom_game_id=custom_game_id, actor_user_id=actor_user_id
        )
        patch = _normalize_team_names(team_names)
        config = dict(game.config_json or {})
        merged = dict(config.get("team_names") or {})
        for index, value in patch.items():
            if value is None:
                merged.pop(index, None)
            else:
                merged[index] = value
        if merged:
            config["team_names"] = merged
        else:
            config.pop("team_names", None)
        game.config_json = config or None
        await session.flush()
        return game

    async def set_role_mask(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        role_mask: Mapping[str, int] | None,
        actor_user_id: int,
    ) -> models.CustomGame:
        """Patch the mix's own roster-shape override, or clear it back to inheriting.

        Mirrors ``Tournament.roster_slots_json``: ``None`` clears the override, and
        ``balance``/``roster_shape`` then fall back through ``resolve_roster_shape``
        to the workspace default, then the built-in Overwatch 5v5 shape.
        """
        game = await self._writable(
            session, workspace_id=workspace_id, custom_game_id=custom_game_id, actor_user_id=actor_user_id
        )
        try:
            normalized = normalize_roster_slots(role_mask)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        config = dict(game.config_json or {})
        if normalized is None:
            config.pop("role_mask", None)
        else:
            config["role_mask"] = normalized
        game.config_json = config or None
        await session.flush()
        return game

    async def swap_seats(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        variant_index: int,
        first_uuid: str,
        second_uuid: str,
        actor_user_id: int,
    ) -> models.CustomGame:
        """Swap two seated players between teams, same role only.

        A same-role swap can never break a team's role quota (1 tank / 2 dps /
        2 support stays exactly that on both sides), so it needs no eligibility
        check beyond "both seats exist and share a role" -- unlike a free move,
        which would need to know every role a player is *ranked* for, not just
        the one this balance happened to seat them in.

        Edits whichever balance option is on screen (``variant_index``), not
        only the first: a host who paged to option 2 and likes it otherwise is
        adjusting that one, not silently rewriting option 1.
        """
        game = await self._writable(
            session, workspace_id=workspace_id, custom_game_id=custom_game_id, actor_user_id=actor_user_id
        )
        result = copy.deepcopy(game.result_json) if isinstance(game.result_json, dict) else None
        variants = result.get("variants") if isinstance(result, dict) else None
        if not isinstance(variants, list) or not (0 <= variant_index < len(variants)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balance option not found")
        variant = variants[variant_index]
        teams = variant.get("teams") if isinstance(variant, dict) else None
        if not isinstance(teams, list):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balance option not found")

        first = _locate_seat(teams, first_uuid)
        second = _locate_seat(teams, second_uuid)
        if first is None or second is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not seated in this option")
        first_team, first_role, first_pos = first
        second_team, second_role, second_pos = second
        if first_role != second_role:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Can only swap two seats in the same role",
            )
        if first_team == second_team:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Both seats are already on the same team",
            )

        first_bucket = teams[first_team]["roster"][first_role]
        second_bucket = teams[second_team]["roster"][second_role]
        first_bucket[first_pos], second_bucket[second_pos] = second_bucket[second_pos], first_bucket[first_pos]
        _recompute_variant_stats(variant)

        game.result_json = result
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
