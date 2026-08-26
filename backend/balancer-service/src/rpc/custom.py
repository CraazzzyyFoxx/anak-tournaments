"""Custom games over typed RPC.

``rpc.balancer.custom.{create,list,get,update_roster,update_player,balance,set_team_names,set_role_mask,set_points_per_win,swap_seats,record_outcome,match_history,close,delete}``.
Writes require ``actor == host``. Reads are any workspace member.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from faststream.rabbit import RabbitMessage

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.player_sub_roles import REGISTRATION_ROLE_CODES
from shared.services.division_grid.access import get_effective_division_grid
from shared.services.member_rank import MIX_ORDER
from src.core import db
from src.rpc import _common as c
from src.services.custom_game import custom_game_service
from src.services.pickup_mix_realtime import emit_pickup_mix_updated

_SF = db.async_session_maker


def _int(data: dict[str, Any], key: str) -> int:
    body = c.payload(data)
    raw = body.get(key, data.get(key))
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} is required") from None


def _opt_int(data: dict[str, Any], key: str) -> int | None:
    body = c.payload(data)
    raw = body.get(key, data.get(key))
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} is required") from None


def _game_id(data: dict[str, Any]) -> int:
    body = c.payload(data)
    raw = body.get("custom_game_id", data.get("custom_game_id", body.get("id", data.get("id"))))
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="custom_game_id is required") from None


def _require_member(user: Any, workspace_id: int) -> None:
    if not user.is_workspace_member(workspace_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a workspace member")


def _require_mix(data: dict[str, Any], user: Any, workspace_id: int, action: str) -> None:
    """Reading a mix is open to any workspace member; hosting one is its own grant.

    ``read`` stops at membership -- a workspace member watching a mix without
    running it needs no ``custom_game`` grant of its own. Write actions still
    go through the permission check: membership stays in front of it because
    ``has_workspace_permission`` also answers True for a *global* admin role or
    a global (``workspace_id IS NULL``) grant, neither of which puts the caller
    inside this workspace -- and mixes are workspace-scoped data.
    """
    _require_member(user, workspace_id)
    if action == "read":
        return
    c.require_workspace_permission(data, user, workspace_id, "custom_game", action)


def _member_ids(data: dict[str, Any]) -> list[int] | None:
    body = c.payload(data)
    raw = body.get(
        "member_ids",
        data.get("member_ids", body.get("workspace_member_ids", data.get("workspace_member_ids"))),
    )
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="member_ids is required")
    try:
        return [int(item) for item in raw]
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="member_ids is required") from None


def _team_names(data: dict[str, Any]) -> dict[str, Any]:
    body = c.payload(data)
    raw = body.get("team_names", data.get("team_names"))
    if not isinstance(raw, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="team_names is required")
    return raw


def _role_mask_body(data: dict[str, Any]) -> dict[str, Any] | None:
    """The mix's own override, or ``None`` to clear it back to inheriting.

    Unlike ``_team_names`` the whole value may legitimately be ``null`` (clear
    the override), so a missing key -- rather than an explicit ``null`` -- is
    what is rejected here.
    """
    body = c.payload(data)
    if "role_mask" in body:
        raw = body["role_mask"]
    elif "role_mask" in data:
        raw = data["role_mask"]
    else:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="role_mask is required")
    if raw is not None and not isinstance(raw, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="role_mask must be a map or null")
    return raw


def _points_per_win_body(data: dict[str, Any]) -> int | None:
    """The host's rank-adjustment-per-win knob, or ``None`` to disable it.

    Mirrors ``_role_mask_body``: the whole value may legitimately be ``null``,
    so a missing key -- not an explicit ``null`` -- is what is rejected.
    """
    body = c.payload(data)
    if "points_per_win" in body:
        raw = body["points_per_win"]
    elif "points_per_win" in data:
        raw = data["points_per_win"]
    else:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="points_per_win is required")
    if raw is not None and (not isinstance(raw, int) or isinstance(raw, bool)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="points_per_win must be an integer or null"
        )
    return raw


def _swap_seats_body(data: dict[str, Any]) -> tuple[int, str, str]:
    body = c.payload(data)
    variant_index = body.get("variant_index", data.get("variant_index"))
    first_uuid = body.get("first_uuid", data.get("first_uuid"))
    second_uuid = body.get("second_uuid", data.get("second_uuid"))
    if not isinstance(variant_index, int) or isinstance(variant_index, bool):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="variant_index is required")
    if not isinstance(first_uuid, str) or not first_uuid or not isinstance(second_uuid, str) or not second_uuid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="first_uuid and second_uuid are required"
        )
    return variant_index, first_uuid, second_uuid


def _player_patch(data: dict[str, Any]) -> dict[str, Any]:
    """Only the keys the caller actually sent, so absent fields stay untouched."""
    body = c.payload(data)
    patch: dict[str, Any] = {}
    for key in ("is_active", "roles", "must_play"):
        if key in body:
            patch[key] = body[key]
        elif key in data:
            patch[key] = data[key]
    return patch


def _dump_row(
    row: Any,
    member: Any | None,
    resolved: dict[tuple[int, str], Any],
    author_ranks: dict[tuple[int, str], int],
) -> dict[str, Any]:
    effective = {
        role: resolved[(row.workspace_member_id, role)]
        for role in REGISTRATION_ROLE_CODES
        if resolved.get((row.workspace_member_id, role)) is not None
        and resolved[(row.workspace_member_id, role)].value is not None
    }
    return {
        "id": row.id,
        "workspace_member_id": row.workspace_member_id,
        "display_name": getattr(member, "display_name", None),
        "battle_tag": getattr(member, "battle_tag", None),
        "team_index": row.team_index,
        "sort_order": row.sort_order,
        "is_active": row.is_active,
        "must_play": row.must_play,
        "roles": row.roles_json,
        # The ranks balance would actually use: host book > workspace canon > OW.
        "ranks": {role: rank.value for role, rank in effective.items()},
        # Which of those three a value came from, so the sheet can say whether it
        # is showing this host's own number or the workspace's.
        "rank_sources": {role: rank.source for role, rank in effective.items()},
        # This host's own layer, separately: the sheet edits it directly, and
        # without it "my rank" would be indistinguishable from an inherited one.
        "author_ranks": {
            role: author_ranks[(row.workspace_member_id, role)]
            for role in REGISTRATION_ROLE_CODES
            if (row.workspace_member_id, role) in author_ranks
        },
    }


def _dump_game(
    game: Any,
    roster: list[Any] | None = None,
    members: dict[int, Any] | None = None,
    resolved: dict[tuple[int, str], Any] | None = None,
    author_ranks: dict[tuple[int, str], int] | None = None,
    host_display_name: str | None = None,
    roster_shape: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": game.id,
        "workspace_id": game.workspace_id,
        "host_user_id": game.host_user_id,
        "host_display_name": host_display_name,
        "name": game.name,
        "status": game.status,
        "config_json": game.config_json,
        "result_json": game.result_json,
        "outcome_json": game.outcome_json,
        "created_at": game.created_at.isoformat() if game.created_at else None,
        "roster_shape": roster_shape,
    }
    if roster is not None:
        by_id = members or {}
        out["players"] = [
            _dump_row(row, by_id.get(row.workspace_member_id), resolved or {}, author_ranks or {})
            for row in roster
        ]
    return out


async def _with_roster(session: Any, game: Any) -> dict[str, Any]:
    """Roster rows carry the member's name, effective ranks and their source.

    Without the name a client only has member ids and has to guess from a
    separately paginated roster query, which is how the lineup used to render
    ``#123`` for anyone off the current page. Without the source and the host's
    own layer, "2600" could equally be this host's number, the workspace canon or
    an Overwatch snapshot, and the sheet could not say which it is about to
    overwrite.
    """
    roster_shape = (
        await custom_game_service.roster_shape(session, workspace_id=game.workspace_id, config_json=game.config_json)
    ).model_dump()
    roster = list(await custom_game_service.roster.list_for_game(session, game.id))
    host_names = await custom_game_service.hosts(session, game.workspace_id, [game.host_user_id])
    host_display_name = host_names.get(game.host_user_id)
    if not roster:
        return _dump_game(game, roster, host_display_name=host_display_name, roster_shape=roster_shape)
    member_ids = [row.workspace_member_id for row in roster]
    members = await custom_game_service.members(session, game.workspace_id, member_ids)
    resolved = await custom_game_service.ranks.resolve(
        session,
        workspace_id=game.workspace_id,
        members={member_id: member.player_id for member_id, member in members.items()},
        roles=list(REGISTRATION_ROLE_CODES),
        order=MIX_ORDER,
        author_user_id=game.host_user_id,
        grid=await get_effective_division_grid(session, None),
    )
    author_ranks = (
        {}
        if game.host_user_id is None
        else await custom_game_service.ranks.list_layer(
            session,
            workspace_id=game.workspace_id,
            member_ids=member_ids,
            author_user_id=game.host_user_id,
        )
    )
    return _dump_game(game, roster, members, resolved, author_ranks, host_display_name, roster_shape)


def _dump_match(match: Any, map_names: dict[int, str]) -> dict[str, Any]:
    winner = 1 if match.home_score > match.away_score else 2 if match.away_score > match.home_score else None
    return {
        "id": match.id,
        "home_team_name": match.home_team.name,
        "away_team_name": match.away_team.name,
        "home_score": match.home_score,
        "away_score": match.away_score,
        "winner": winner,
        "map_id": match.map_id,
        "map_name": map_names.get(match.map_id) if match.map_id is not None else None,
        "recorded_by": match.recorded_by,
        "recorded_at": match.created_at.isoformat() if match.created_at else None,
    }


async def _dump_matches(session: Any, matches: list[Any]) -> list[dict[str, Any]]:
    """Bulk-resolves map names in one query instead of one per row."""
    map_ids = {match.map_id for match in matches if match.map_id is not None}
    map_names: dict[int, str] = {}
    if map_ids:
        rows = await session.execute(sa.select(models.Map.id, models.Map.name).where(models.Map.id.in_(map_ids)))
        map_names = dict(rows.all())
    return [_dump_match(match, map_names) for match in matches]


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.balancer.custom.create")
    async def _create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "create")
            body = c.payload(data)
            name = body.get("name", data.get("name"))
            if not isinstance(name, str):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name is required")
            config_json = body.get("config_json", data.get("config_json"))
            if config_json is not None and not isinstance(config_json, dict):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="config_json is required")
            game = await custom_game_service.create(
                session,
                workspace_id=workspace_id,
                host_user_id=_opt_int(data, "host_user_id") or user.id,
                name=name,
                actor_user_id=user.id,
                # An omitted list opens an empty mix; the host fills it from the
                # roster sheet afterwards. There is no pool to default to.
                member_ids=_member_ids(data) or (),
                config_json=config_json,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="create", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.create", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "read")
            rows = await custom_game_service.list(session, workspace_id=workspace_id)
            host_names = await custom_game_service.hosts(
                session, workspace_id, [row.host_user_id for row in rows]
            )
            return [_dump_game(row, host_display_name=host_names.get(row.host_user_id)) for row in rows]

        return await c.envelope(logger, "custom.list", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.get")
    async def _get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "read")
            game = await custom_game_service.get(session, workspace_id=workspace_id, custom_game_id=_game_id(data))
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.get", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.update_roster")
    async def _update_roster(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "update")
            member_ids = _member_ids(data)
            if member_ids is None:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="member_ids is required")
            game = await custom_game_service.update_roster(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                member_ids=member_ids,
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="roster", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.update_roster", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.update_player")
    async def _update_player(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "update")
            game = await custom_game_service.update_player(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                workspace_member_id=_int(data, "workspace_member_id"),
                patch=_player_patch(data),
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="roster", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.update_player", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.balance")
    async def _balance(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "update")
            game = await custom_game_service.balance(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="balance", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.balance", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.set_team_names")
    async def _set_team_names(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "update")
            game = await custom_game_service.set_team_names(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                team_names=_team_names(data),
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="team_names", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.set_team_names", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.set_role_mask")
    async def _set_role_mask(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "update")
            game = await custom_game_service.set_role_mask(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                role_mask=_role_mask_body(data),
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="role_mask", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.set_role_mask", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.set_points_per_win")
    async def _set_points_per_win(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "update")
            game = await custom_game_service.set_points_per_win(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                points_per_win=_points_per_win_body(data),
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="points_per_win", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.set_points_per_win", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.swap_seats")
    async def _swap_seats(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "update")
            variant_index, first_uuid, second_uuid = _swap_seats_body(data)
            game = await custom_game_service.swap_seats(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                variant_index=variant_index,
                first_uuid=first_uuid,
                second_uuid=second_uuid,
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="teams", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.swap_seats", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.record_outcome")
    async def _record_outcome(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "update")
            body = c.payload(data)
            outcome = body.get("outcome_json", data.get("outcome_json", body.get("outcome", data.get("outcome"))))
            if not isinstance(outcome, dict):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="outcome_json is required")
            variant_index = body.get("variant_index", data.get("variant_index"))
            if not isinstance(variant_index, int):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="variant_index is required"
                )
            map_id = body.get("map_id", data.get("map_id"))
            if map_id is not None and not isinstance(map_id, int):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="map_id must be an int")
            game = await custom_game_service.record_outcome(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                outcome_json=outcome,
                variant_index=variant_index,
                map_id=map_id,
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="outcome", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.record_outcome", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.match_history")
    async def _match_history(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "read")
            matches = await custom_game_service.list_matches(
                session, workspace_id=workspace_id, custom_game_id=_game_id(data)
            )
            return await _dump_matches(session, matches)

        return await c.envelope(logger, "custom.match_history", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.close")
    async def _close(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "update")
            game = await custom_game_service.close(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="close", actor_user_id=user.id)
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.close", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.delete")
    async def _delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "delete")
            game = await custom_game_service.cancel(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                actor_user_id=user.id,
            )
            await session.commit()
            await emit_pickup_mix_updated(workspace_id, reason="delete", actor_user_id=user.id)
            return _dump_game(game)

        return await c.envelope(logger, "custom.delete", op, session_factory=_SF)
