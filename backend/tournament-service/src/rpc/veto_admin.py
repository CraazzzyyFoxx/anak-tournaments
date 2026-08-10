"""Map-veto admin session operations over typed RPC.

Config CRUD (list/upsert/delete) moved to ``pick_ban_admin.py`` -- map veto's
organizer configuration now lives on ``PickBanConfig(kind=map)`` alongside
hero bans, edited through one generic admin surface (the "Pre-game Phase" tab)
instead of a map-only one. This module keeps only the two LIVE-SESSION
operations that have no pick-ban equivalent yet: an admin resetting a stuck
room and an admin acting on behalf of an absent captain. Their RPC
paths/response shapes stay exactly as-is (Decision #12,
docs/plans/2026-08-09-generic-pickban-engine.md) even though the storage
underneath is now ``PickBanSession``/``PickBanEntry`` (kind=map) -- see
``public_rpc.py``'s ``_captain_map_pool*``/``_captain_veto`` adapters for the
same map_id/slot <-> item_id/round translation applied here.

The gateway passes the encounter id as ``data["id"]`` and the JSON body as
``data["payload"]``.

Commit semantics: ``reset_pick_ban_session`` and ``perform_pick_ban_action``
commit internally.
"""

from __future__ import annotations

from typing import Any, Literal

from faststream.rabbit.annotations import RabbitMessage
from pydantic import BaseModel
from sqlalchemy import select

from shared.core import http_status as status
from shared.core.enums import PickBanKind
from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.identity import ensure_workspace_permission
from src import models
from src.core import auth
from src.rpc._helpers import _identity, _payload, _require_id, _run
from src.services.encounter import pick_ban_action as pick_ban_action_service
from src.services.encounter import pick_ban_session as pick_ban_session_service


class AdminVetoAct(BaseModel):
    """Body for the admin act-for-a-side route (POST .../veto-act)."""

    side: Literal["home", "away"]
    map_id: int
    action: Literal["pick", "ban"]


def _map_entry_from_pick_ban(entry: dict) -> dict:
    return {
        "id": entry["id"],
        "map_id": entry["item_id"],
        "slot": entry["round"],
        "order": entry["order"],
        "action_index": entry["action_index"],
        "picked_by": entry["picked_by"],
        "team_id": entry["team_id"],
        "status": entry["status"],
    }


def _map_session_from_pick_ban(pb_session: dict) -> dict:
    return {
        "id": pb_session["id"],
        "status": pb_session["status"],
        "first_side": pb_session["first_side"],
        "seed_source": pb_session["seed_source"],
        "home_seed": pb_session["home_seed"],
        "away_seed": pb_session["away_seed"],
        "turn_timer_seconds": pb_session["turn_timer_seconds"],
        "slot_reserves": pb_session["slot_reserves"],
        "started_at": pb_session["started_at"],
        "current_step_started_at": pb_session["current_step_started_at"],
    }


def _map_state_from_pick_ban(state: dict) -> dict:
    pb_session = state["session"]
    return {
        "session": _map_session_from_pick_ban(pb_session) if pb_session is not None else None,
        "reason": state.get("reason"),
        "sequence": state["sequence"],
        "pool": [_map_entry_from_pick_ban(entry) for entry in state["pool"]],
        "viewer_side": state["viewer_side"],
        "viewer_can_act": state["viewer_can_act"],
        "allowed_actions": state["allowed_actions"],
        "current_step_index": state["current_step_index"],
        "current_step": state["current_step"],
        "expected_action": state["expected_action"],
        "turn_side": state["turn_side"],
        "current_slot": state["current_round"],
        "is_complete": state["is_complete"],
    }


async def _load_encounter(session: Any, encounter_id: int) -> models.Encounter:
    encounter = await session.scalar(select(models.Encounter).where(models.Encounter.id == encounter_id))
    if encounter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")
    return encounter


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.tournament.admin_veto_session_reset")
    async def _admin_veto_session_reset(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            ws_id = await auth.get_encounter_workspace_id(session, encounter_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            encounter = await _load_encounter(session, encounter_id)
            # reset_pick_ban_session commits internally; the response is the
            # same state shape the room polls (viewer_side stays null for
            # admins).
            await pick_ban_session_service.reset_pick_ban_session(session, encounter, PickBanKind.MAP)
            state = await pick_ban_action_service.get_pick_ban_state(
                session, encounter_id, PickBanKind.MAP, viewer_side=None
            )
            return _map_state_from_pick_ban(state)

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.admin_veto_act")
    async def _admin_veto_act(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            ws_id = await auth.get_encounter_workspace_id(session, encounter_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            body = AdminVetoAct.model_validate(_payload(data))
            # Same engine as captain_veto, side supplied explicitly (bypasses
            # captain-side resolution); perform_pick_ban_action commits
            # internally.
            entry = await pick_ban_action_service.perform_pick_ban_action(
                session,
                encounter_id,
                PickBanKind.MAP,
                body.side,
                body.map_id,
                body.action,
            )
            return {
                "id": entry.id,
                "map_id": entry.item_id,
                "status": entry.status,
                "picked_by": entry.picked_by,
            }

        return await _run(logger, op)
