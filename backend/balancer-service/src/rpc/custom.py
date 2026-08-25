"""Custom games over typed RPC.

``rpc.balancer.custom.{create,list,get,update_roster,update_player,balance,record_outcome,delete}``.
Writes require ``actor == host``. Reads are any workspace member.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

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
    """Membership alone no longer opens mixes; hosting a mix is its own grant.

    Membership stays in front of the permission check because
    ``has_workspace_permission`` also answers True for a *global* admin role or
    a global (``workspace_id IS NULL``) grant, neither of which puts the caller
    inside this workspace -- and mixes are workspace-scoped data.
    """
    _require_member(user, workspace_id)
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


def _player_patch(data: dict[str, Any]) -> dict[str, Any]:
    """Only the keys the caller actually sent, so absent fields stay untouched."""
    body = c.payload(data)
    patch: dict[str, Any] = {}
    for key in ("is_active", "roles"):
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
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": game.id,
        "workspace_id": game.workspace_id,
        "host_user_id": game.host_user_id,
        "name": game.name,
        "status": game.status,
        "config_json": game.config_json,
        "result_json": game.result_json,
        "outcome_json": game.outcome_json,
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
    roster = list(await custom_game_service.roster.list_for_game(session, game.id))
    if not roster:
        return _dump_game(game, roster)
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
    return _dump_game(game, roster, members, resolved, author_ranks)


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
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.create", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_mix(data, user, workspace_id, "read")
            rows = await custom_game_service.list(session, workspace_id=workspace_id)
            return [_dump_game(row) for row in rows]

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
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.balance", op, session_factory=_SF)

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
            game = await custom_game_service.record_outcome(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                outcome_json=outcome,
                actor_user_id=user.id,
            )
            await session.commit()
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.record_outcome", op, session_factory=_SF)

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
            return _dump_game(game)

        return await c.envelope(logger, "custom.delete", op, session_factory=_SF)
