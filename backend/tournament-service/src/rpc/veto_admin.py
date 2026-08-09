"""Map-veto admin methods over typed RPC.

Mirrors the ``admin_misc`` conventions: rehydrate the gateway-injected
identity, run the workspace "match"/"update" permission check (via the
tournament — directly for config routes, through the encounter for session
routes), validate the body, call the service and return plain dicts. The
gateway passes the primary path id as ``data["id"]`` (RouteSpec IDParam:
tournament_id for config list/upsert, config_id for delete, encounter_id for
session reset/act) and the JSON body as ``data["payload"]``.

Commit semantics: config upsert/delete commit here (plain ORM writes);
``reset_veto_session`` and ``perform_veto_action`` commit internally.
"""

from __future__ import annotations

from typing import Any, Literal

from faststream.rabbit.annotations import RabbitMessage
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from shared.core import http_status as status
from shared.core.enums import FirstBanRotation, MapVetoMode
from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.identity import ensure_workspace_permission
from src import models
from src.core import auth
from src.rpc._helpers import _identity, _payload, _require_id, _run
from src.services.encounter import map_veto as map_veto_service
from src.services.encounter import veto_session as veto_session_service


class VetoConfigSlotUpsert(BaseModel):
    """One slot of a slot-mode upsert body.

    Deliberately carries no ``position``: the list order IS the play order and
    positions are derived from it, so a payload cannot describe a gap, a
    duplicate or a zero that ``uq_map_veto_config_slot_position`` and
    ``ck_map_veto_config_slot_position_positive`` would then have to reject.
    """

    candidates: list[int]
    reserve_map_id: int | None = None


class VetoConfigUpsert(BaseModel):
    """Body for the veto-config upsert route (PUT .../veto-configs)."""

    stage_id: int | None = None
    round: int | None = None
    # Required, no default (design Decision 17). This route replaces the pool
    # wholesale, so a default would let a stale admin tab that predates slot
    # mode save a slot config as flat and drop its slots with no signal.
    mode: MapVetoMode
    # Slot mode only; nothing reads it in flat mode. Optional where ``mode`` is
    # not, because the two failures are not comparable: this default is the
    # column's own server_default, and omitting it changes which side opens each
    # slot's bans -- visible in the editor and undone by another save -- rather
    # than which rows the config keeps.
    first_ban_rotation: FirstBanRotation = FirstBanRotation.FIXED
    preset: str | None = Field(default=None, max_length=32)
    turn_timer_seconds: int | None = Field(default=None, ge=1)
    sequence: list[str]
    map_ids: list[int]
    slots: list[VetoConfigSlotUpsert] = Field(default_factory=list)


class AdminVetoAct(BaseModel):
    """Body for the admin act-for-a-side route (POST .../veto-act)."""

    side: Literal["home", "away"]
    map_id: int
    action: Literal["pick", "ban"]


_serialize_config = map_veto_service.serialize_veto_config


#: Loader chain this module's ``serialize_veto_config`` call sites need.
#: ``slots`` and its ``maps`` are both deliberately lazy relationships, so a
#: miss is a ``MissingGreenlet`` 500 rather than a wrong answer.
_CONFIG_LOAD = (
    selectinload(models.MapVetoConfig.map_pool),
    selectinload(models.MapVetoConfig.slots).selectinload(models.MapVetoConfigSlot.maps),
)


def _reject_other_modes_field(value: list, name: str, *, mode: MapVetoMode) -> None:
    """422 a field that belongs to the pool shape this payload did not pick.

    Ignoring it instead would be the hazard Decision 17 exists to prevent, one
    field over: a stale tab still holding the other shape's data would save with
    that data discarded and nothing to tell the organizer it was lost.

    The message names the empty list rather than saying only "must be empty".
    ``slots`` has a default, so omitting it and sending ``[]`` arrive here
    identically and a client author has no way to tell which spelling this route
    wants; ``map_ids`` and ``sequence`` are required, so for those ``[]`` is
    simply the shortest value that satisfies both this check and the schema.
    """
    if value:
        raise HTTPException(
            status_code=422,
            detail=f"{name} must be empty in {mode.value} mode; send {name}: []",
        )


async def _load_encounter(session: Any, encounter_id: int) -> models.Encounter:
    encounter = await session.scalar(select(models.Encounter).where(models.Encounter.id == encounter_id))
    if encounter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")
    return encounter


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.tournament.admin_veto_config_list")
    async def _admin_veto_config_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _require_id(data)
            ws_id = await auth.get_tournament_workspace_id(session, tournament_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            result = await session.execute(
                select(models.MapVetoConfig)
                .where(models.MapVetoConfig.tournament_id == tournament_id)
                .options(*_CONFIG_LOAD)
                .order_by(
                    models.MapVetoConfig.stage_id.asc().nulls_first(),
                    models.MapVetoConfig.round.asc().nulls_first(),
                    models.MapVetoConfig.id.asc(),
                )
            )
            return {"configs": [_serialize_config(config) for config in result.scalars().all()]}

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.admin_veto_config_upsert")
    async def _admin_veto_config_upsert(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _require_id(data)
            ws_id = await auth.get_tournament_workspace_id(session, tournament_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            body = VetoConfigUpsert.model_validate(_payload(data))

            if body.mode == MapVetoMode.SLOTS:
                _reject_other_modes_field(body.map_ids, "map_ids", mode=body.mode)
                _reject_other_modes_field(body.sequence, "sequence", mode=body.mode)
                if body.preset == veto_session_service.CUSTOM_PRESET:
                    # ``ck_map_veto_config_slots_not_custom`` would refuse this
                    # row, and an IntegrityError surfaces as an opaque 500. The
                    # combination is contradictory anyway: a slot config's
                    # sequence is derived from its slots, so there is no
                    # hand-authored order for ``custom`` to name.
                    raise HTTPException(
                        status_code=422,
                        detail="preset 'custom' is not valid in slots mode; the slots derive the sequence",
                    )
                veto_session_service.validate_slot_config(
                    [slot.candidates for slot in body.slots],
                    reserves=[slot.reserve_map_id for slot in body.slots],
                )
            else:
                _reject_other_modes_field(body.slots, "slots", mode=body.mode)
                veto_session_service.validate_veto_config(body.sequence, body.map_ids)
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

            # Upsert key = (tournament_id, stage_id, round): replace fields +
            # pool of the existing cascade-level row, else insert a new one.
            existing_query = (
                select(models.MapVetoConfig)
                .where(models.MapVetoConfig.tournament_id == tournament_id)
                .options(*_CONFIG_LOAD)
            )
            if body.stage_id is None:
                existing_query = existing_query.where(models.MapVetoConfig.stage_id.is_(None))
            else:
                existing_query = existing_query.where(models.MapVetoConfig.stage_id == body.stage_id)
            if body.round is None:
                existing_query = existing_query.where(models.MapVetoConfig.round.is_(None))
            else:
                existing_query = existing_query.where(models.MapVetoConfig.round == body.round)
            config = await session.scalar(existing_query)

            if config is None:
                config = models.MapVetoConfig(
                    tournament_id=tournament_id,
                    stage_id=body.stage_id,
                    round=body.round,
                    mode=body.mode,
                    first_ban_rotation=body.first_ban_rotation,
                    preset=body.preset,
                    turn_timer_seconds=body.turn_timer_seconds,
                    veto_sequence_json=body.sequence,
                )
                session.add(config)
            else:
                config.mode = body.mode
                config.first_ban_rotation = body.first_ban_rotation
                config.preset = body.preset
                config.turn_timer_seconds = body.turn_timer_seconds
                config.veto_sequence_json = body.sequence
            # Both shapes are replaced on every upsert, whichever mode won. The
            # guards above force the losing one's payload to be empty, so these
            # two assignments are also what clears the other mode's rows on a
            # conversion -- in this transaction, via the delete-orphan cascade.
            #
            # Wholesale, not reconciled: nothing outside a slot's own children
            # references its id (``encounter_map_pool.slot`` carries the
            # ``position`` VALUE and ``EncounterVetoSession`` snapshots the
            # reserves), so recreating the rows costs new ids and nothing else.
            config.map_pool = [
                models.MapVetoConfigMap(map_id=map_id, sort_order=idx) for idx, map_id in enumerate(body.map_ids)
            ]
            config.slots = [
                models.MapVetoConfigSlot(
                    # 1-based and contiguous, in payload order:
                    # ``validate_slot_config`` reports these as ordinals,
                    # ``slot_reserves`` keys its snapshot by them, and a 0 would
                    # violate ``ck_map_veto_config_slot_position_positive``.
                    position=index + 1,
                    reserve_map_id=slot.reserve_map_id,
                    # Payload order is the candidate order the room shows and the
                    # order pool rows are stamped in; ``sort_order`` is what
                    # carries it back out through ``MapVetoConfigSlot.maps``.
                    maps=[
                        models.MapVetoConfigSlotMap(map_id=map_id, sort_order=order)
                        for order, map_id in enumerate(slot.candidates)
                    ],
                )
                for index, slot in enumerate(body.slots)
            ]
            await session.commit()
            await session.refresh(config, ["map_pool"])
            return _serialize_config(config)

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.admin_veto_config_delete")
    async def _admin_veto_config_delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            config_id = _require_id(data)
            config = await session.scalar(select(models.MapVetoConfig).where(models.MapVetoConfig.id == config_id))
            if config is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Veto config not found")
            ws_id = await auth.get_tournament_workspace_id(session, config.tournament_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            await session.delete(config)
            await session.commit()
            return {"deleted": True}

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.admin_veto_session_reset")
    async def _admin_veto_session_reset(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            ws_id = await auth.get_encounter_workspace_id(session, encounter_id)
            ensure_workspace_permission(user, ws_id, "match", "update")
            encounter = await _load_encounter(session, encounter_id)
            # reset_veto_session commits internally; the response is the same
            # state shape the room polls (viewer_side stays null for admins).
            await veto_session_service.reset_veto_session(session, encounter)
            return await map_veto_service.get_map_pool_state(session, encounter_id, viewer_side=None)

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
            # captain-side resolution); perform_veto_action commits internally.
            entry = await map_veto_service.perform_veto_action(
                session,
                encounter_id,
                body.side,
                body.map_id,
                body.action,
            )
            return {
                "id": entry.id,
                "map_id": entry.map_id,
                "status": entry.status,
                "picked_by": entry.picked_by,
            }

        return await _run(logger, op)
