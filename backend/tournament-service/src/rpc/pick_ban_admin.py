"""Generic pick-ban admin methods over typed RPC (``PickBanConfig`` CRUD for
both ``map`` and ``hero`` kinds).

Mirrors ``veto_admin.py``'s FORMER upsert/list/delete shape exactly — same
cascade key ``(tournament_id, stage_id, round)``, now additionally
partitioned by ``kind`` (design: docs/plans/2026-08-09-generic-pickban-engine.md)
— plus a ``kind`` field on every route so one admin surface configures both
map veto and hero bans. Since the map-veto cutover, this IS the sole config
CRUD surface for both kinds; ``veto_admin.py`` keeps only the two
live-session operations (reset/act) that have no pick-ban equivalent.
"""

from __future__ import annotations

from typing import Any, Literal

from faststream.rabbit.annotations import RabbitMessage
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from shared.core import http_status as status
from shared.core.enums import (
    FirstBanRotation,
    FirstPickRule,
    MapVetoMode,
    PickBanKind,
    PickBanNoRepeatScope,
)
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.tournament.pick_ban import (
    PickBanConfig,
    PickBanConfigItem,
    PickBanConfigSlot,
    PickBanConfigSlotItem,
)
from shared.rpc.identity import ensure_workspace_permission
from src import models
from src.core import auth
from src.rpc._helpers import _identity, _payload, _require_id, _run
from src.services.encounter import pick_ban_action as pick_ban_action_service
from src.services.encounter import pick_ban_session as pick_ban_session_service
from src.services.encounter.veto_session import BRACKET_PRESET, CUSTOM_PRESET

_CONFIG_LOAD = (
    selectinload(PickBanConfig.items),
    selectinload(PickBanConfig.slots).selectinload(PickBanConfigSlot.items),
)
_serialize_config = pick_ban_session_service.serialize_pick_ban_config


async def _load_encounter(session: Any, encounter_id: int) -> models.Encounter:
    encounter = await session.scalar(select(models.Encounter).where(models.Encounter.id == encounter_id))
    if encounter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")
    return encounter


class PickBanAdminReset(BaseModel):
    """Body for the admin session-reset route -- which kind's live session to
    drop and re-create (map veto and hero bans reset independently)."""

    kind: PickBanKind


class PickBanAdminAct(BaseModel):
    """Body for the admin act-for-a-side route: perform one step on behalf of
    an absent captain. Generalizes ``veto_admin.AdminVetoAct`` with ``kind``
    and the ``protect`` action the generic engine adds."""

    kind: PickBanKind
    side: Literal["home", "away"]
    item_id: int
    action: Literal["pick", "ban", "protect"]


class PickBanAdminElectOpener(BaseModel):
    """Body for the admin elect-opener route: name who opens the round a
    ``result_loser_choice`` rotation is holding, on behalf of a losing captain
    who is not there to name it themselves."""

    kind: PickBanKind
    first_side: Literal["home", "away"]


class PickBanConfigSlotUpsert(BaseModel):
    """One slot of a slot-mode upsert body. No ``position``: list order IS the
    play order (same rationale as ``veto_admin.VetoConfigSlotUpsert``)."""

    candidates: list[int]
    reserve_item_id: int | None = None


class PickBanConfigUpsert(BaseModel):
    """Body for the generic pick-ban config upsert route."""

    kind: PickBanKind
    stage_id: int | None = None
    round: int | None = None
    mode: MapVetoMode
    first_pick_rule: FirstPickRule = FirstPickRule.HIGHER_SEED
    first_ban_rotation: FirstBanRotation = FirstBanRotation.FIXED
    preset: str | None = Field(default=None, max_length=32)
    turn_timer_seconds: int | None = Field(default=None, ge=1)
    no_repeat_scope: PickBanNoRepeatScope = PickBanNoRepeatScope.NONE
    unique_attribute_per_side_per_round: str | None = Field(default=None, max_length=32)
    allow_protect: bool = False
    sequence: list[str] = Field(default_factory=list)
    item_ids: list[int] = Field(default_factory=list)
    slots: list[PickBanConfigSlotUpsert] = Field(default_factory=list)


def _reject_other_modes_field(value: list[Any], name: str, *, mode: MapVetoMode) -> None:
    """422 a field that belongs to the pool shape this payload did not pick."""
    if value:
        other = "slots" if mode == MapVetoMode.POOL else "item_ids/sequence"
        raise HTTPException(
            status_code=422,
            detail=f"{name} must be empty in {mode.value} mode (got {other} instead)",
        )


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.tournament.admin_pick_ban_config_list")
    async def _admin_pick_ban_config_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _require_id(data)
            ws_id = await auth.get_tournament_workspace_id(session, tournament_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            result = await session.execute(
                select(PickBanConfig)
                .where(PickBanConfig.tournament_id == tournament_id)
                .options(*_CONFIG_LOAD)
                .order_by(
                    PickBanConfig.kind.asc(),
                    PickBanConfig.stage_id.asc().nulls_first(),
                    PickBanConfig.round.asc().nulls_first(),
                    PickBanConfig.id.asc(),
                )
            )
            return {"configs": [_serialize_config(config) for config in result.scalars().all()]}

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.admin_pick_ban_config_upsert")
    async def _admin_pick_ban_config_upsert(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _require_id(data)
            ws_id = await auth.get_tournament_workspace_id(session, tournament_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            body = PickBanConfigUpsert.model_validate(_payload(data))

            if body.mode == MapVetoMode.SLOTS:
                _reject_other_modes_field(body.item_ids, "item_ids", mode=body.mode)
                _reject_other_modes_field(body.sequence, "sequence", mode=body.mode)
                if body.preset == CUSTOM_PRESET:
                    # ``ck_pick_ban_config_slots_not_custom`` would refuse this
                    # row, and an IntegrityError surfaces as an opaque 500 (same
                    # reasoning veto_admin.py's legacy upsert had). A slot
                    # config's sequence is derived from its slots, so there is
                    # no hand-authored order for ``custom`` to name.
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            "preset 'custom' is not valid in slots mode; the slots derive the sequence, "
                            f"so send preset: '{BRACKET_PRESET}' or null"
                        ),
                    )
                pick_ban_session_service.validate_pick_ban_slot_config(
                    [slot.candidates for slot in body.slots],
                    reserves=[slot.reserve_item_id for slot in body.slots],
                )
            else:
                _reject_other_modes_field(body.slots, "slots", mode=body.mode)
                pick_ban_session_service.validate_pick_ban_config(body.sequence, body.item_ids, kind=body.kind)
            if body.round is not None and body.stage_id is None:
                raise HTTPException(status_code=422, detail="round requires stage_id")
            if body.stage_id is not None:
                stage_tournament_id = await session.scalar(
                    select(models.Stage.tournament_id).where(models.Stage.id == body.stage_id)
                )
                if stage_tournament_id is None:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stage not found")
                if stage_tournament_id != tournament_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Stage does not belong to this tournament",
                    )

            # Upsert key = (tournament_id, kind, stage_id, round) — same cascade
            # level as veto_admin, additionally partitioned by kind.
            existing_query = (
                select(PickBanConfig)
                .where(PickBanConfig.tournament_id == tournament_id, PickBanConfig.kind == body.kind)
                .options(*_CONFIG_LOAD)
            )
            existing_query = existing_query.where(
                PickBanConfig.stage_id.is_(None) if body.stage_id is None else PickBanConfig.stage_id == body.stage_id
            )
            existing_query = existing_query.where(
                PickBanConfig.round.is_(None) if body.round is None else PickBanConfig.round == body.round
            )
            config = await session.scalar(existing_query)

            if config is None:
                config = PickBanConfig(
                    tournament_id=tournament_id,
                    kind=body.kind,
                    stage_id=body.stage_id,
                    round=body.round,
                    mode=body.mode,
                    first_pick_rule=body.first_pick_rule,
                    first_ban_rotation=body.first_ban_rotation,
                    preset=body.preset,
                    turn_timer_seconds=body.turn_timer_seconds,
                    no_repeat_scope=body.no_repeat_scope,
                    unique_attribute_per_side_per_round=body.unique_attribute_per_side_per_round,
                    allow_protect=body.allow_protect,
                    sequence_json=body.sequence,
                )
                session.add(config)
            else:
                config.mode = body.mode
                config.first_pick_rule = body.first_pick_rule
                config.first_ban_rotation = body.first_ban_rotation
                config.preset = body.preset
                config.turn_timer_seconds = body.turn_timer_seconds
                config.no_repeat_scope = body.no_repeat_scope
                config.unique_attribute_per_side_per_round = body.unique_attribute_per_side_per_round
                config.allow_protect = body.allow_protect
                config.sequence_json = body.sequence
            # Wholesale replace, cleared+flushed first — same ordering rationale
            # as veto_admin's upsert (SQLAlchemy would otherwise emit the new
            # children's INSERTs before the old ones' DELETEs and trip the
            # plain UNIQUE constraints on position/item_id).
            config.items = []
            config.slots = []
            await session.flush()

            config.items = [
                PickBanConfigItem(item_id=item_id, sort_order=idx) for idx, item_id in enumerate(body.item_ids)
            ]
            config.slots = [
                PickBanConfigSlot(
                    position=index + 1,
                    reserve_item_id=slot.reserve_item_id,
                    items=[
                        PickBanConfigSlotItem(item_id=item_id, sort_order=order)
                        for order, item_id in enumerate(slot.candidates)
                    ],
                )
                for index, slot in enumerate(body.slots)
            ]
            await session.commit()
            await session.refresh(config, ["items"])
            return _serialize_config(config)

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.admin_pick_ban_config_delete")
    async def _admin_pick_ban_config_delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            config_id = _require_id(data)
            config = await session.scalar(select(PickBanConfig).where(PickBanConfig.id == config_id))
            if config is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pick-ban config not found")
            ws_id = await auth.get_tournament_workspace_id(session, config.tournament_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            await session.delete(config)
            await session.commit()
            return {"deleted": True}

        return await _run(logger, op)

    # ── live-session admin overrides (map + hero) ───────────────────────────
    # Generalizes veto_admin.py's two live-session operations (reset + act
    # for an absent captain), which had no pick-ban equivalent before the
    # room unification. Both kinds share these two routes via a ``kind``
    # body field instead of two kind-hardcoded handlers.

    @broker.subscriber("rpc.tournament.admin_pick_ban_session_reset")
    async def _admin_pick_ban_session_reset(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            ws_id = await auth.get_encounter_workspace_id(session, encounter_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            body = PickBanAdminReset.model_validate(_payload(data))
            encounter = await _load_encounter(session, encounter_id)
            # reset_pick_ban_session commits internally; the response is the
            # same state shape the room polls (viewer_side stays null for
            # admins).
            await pick_ban_session_service.reset_pick_ban_session(session, encounter, body.kind)
            return await pick_ban_action_service.get_pick_ban_state(session, encounter_id, body.kind, viewer_side=None)

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.admin_pick_ban_act")
    async def _admin_pick_ban_act(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            ws_id = await auth.get_encounter_workspace_id(session, encounter_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            body = PickBanAdminAct.model_validate(_payload(data))
            # Same engine as the captain act route, side supplied explicitly
            # (bypasses captain-side resolution); commits internally.
            entry = await pick_ban_action_service.perform_pick_ban_action(
                session,
                encounter_id,
                body.kind,
                body.side,
                body.item_id,
                body.action,
            )
            return pick_ban_action_service.serialize_pick_ban_entry(entry)

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.admin_pick_ban_elect_opener")
    async def _admin_pick_ban_elect_opener(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            ws_id = await auth.get_encounter_workspace_id(session, encounter_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            body = PickBanAdminElectOpener.model_validate(_payload(data))
            pick_ban = await pick_ban_session_service.get_pick_ban_session(session, encounter_id, body.kind)
            if pick_ban is None:
                raise HTTPException(status_code=400, detail="No round is awaiting an opener choice")
            # `acting_side=None` IS the override: the losing captain's exclusive
            # right to choose does not apply to an organizer unsticking a room
            # they are not playing in. Commits inside `advance_to_next_round`;
            # the response is the state shape the room polls.
            await pick_ban_session_service.elect_round_opener(
                session, pick_ban, first_side=body.first_side, acting_side=None
            )
            return await pick_ban_action_service.get_pick_ban_state(session, encounter_id, body.kind, viewer_side=None)

        return await _run(logger, op)
