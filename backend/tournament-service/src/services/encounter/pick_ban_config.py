"""``PickBanConfig`` CRUD for both kinds (map veto and hero bans).

The organizer-facing half of the pick-ban domain: the list/get/upsert/delete of
the config rows that :mod:`pick_ban_session` later cascade-resolves onto an
encounter. It lived in ``rpc/pick_ban_admin.py`` and ``rpc/reads.py`` as raw SQL
in the transport layer -- the upsert's ``session.add``/relationship replacement
and the reads' ordered listing -- which put a domain rule (what "the config in
scope" means, and in what order the cascade reads) in a layer that owns none.

The cascade RESOLUTION (which of these configs applies to a given encounter)
is the session's question, not this module's, and stays in
``pick_ban_session.resolve_config_at_level``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession
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
from shared.repository import PickBanConfigRepository, StageRepository

# A config is only ever useful with its pool in hand (`items` in flat mode,
# `slots.items` in slot mode), and both are plain lazy relationships: touching
# either on a config that was loaded without them raises `MissingGreenlet`
# under async SQLAlchemy. Every load of a config that will be read goes
# through here -- including `pick_ban_session`'s, which imports this tuple
# rather than keeping a third hand-maintained copy of it.
CONFIG_POOL_LOAD = (
    selectinload(PickBanConfig.items),
    selectinload(PickBanConfig.slots).selectinload(PickBanConfigSlot.items),
)


@dataclass(frozen=True)
class SlotSpec:
    """One slot of a slot-mode upsert, as plain data.

    A value type rather than the transport's pydantic body model: the service
    must not import from ``rpc/``, and the two callers of the upsert (the admin
    route today, a config copier tomorrow) agree on "candidates + optional
    reserve" and nothing else. ``position`` is absent on purpose -- list order
    IS the position, assigned 1-based by :meth:`PickBanConfigService.upsert_config`.
    """

    candidates: list[int] = field(default_factory=list)
    reserve_item_id: int | None = None


class PickBanConfigService:
    def __init__(
        self,
        *,
        config_repo: PickBanConfigRepository = PickBanConfigRepository(),
        stage_repo: StageRepository = StageRepository(),
    ) -> None:
        self.config_repo = config_repo
        self.stage_repo = stage_repo

    async def list_configs(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        kind: PickBanKind | None = None,
    ) -> Sequence[PickBanConfig]:
        """Every config in a tournament, cascade order, pool eagerly loaded.

        ``kind=None`` lists both kinds (the admin editor's view); a kind narrows
        it to one (the public map-config read).

        Ordered here rather than in the repository: the ordering IS the cascade
        the resolver applies -- most general first, ``NULL`` stage before a
        stage, ``NULL`` round before a round -- so it is a domain rule, not a
        CRUD default. Leading with ``kind`` groups the two rulebooks in the
        admin view and is a no-op once ``kind`` is given.
        """
        query = self.config_repo.select().where(PickBanConfig.tournament_id == tournament_id)
        if kind is not None:
            query = query.where(PickBanConfig.kind == kind)
        query = query.options(*CONFIG_POOL_LOAD).order_by(
            PickBanConfig.kind.asc(),
            PickBanConfig.stage_id.asc().nulls_first(),
            PickBanConfig.round.asc().nulls_first(),
            PickBanConfig.id.asc(),
        )
        result = await session.execute(query)
        return result.unique().scalars().all()

    async def get_config(self, session: AsyncSession, config_id: int) -> PickBanConfig:
        """One config by id, or 404. The pool is NOT loaded: the only caller
        needs the row's ``tournament_id`` to gate on and then deletes it."""
        config = await self.config_repo.get(session, config_id)
        if config is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pick-ban config not found")
        return config

    async def upsert_config(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        kind: PickBanKind,
        stage_id: int | None = None,
        round: int | None = None,
        mode: MapVetoMode,
        first_pick_rule: FirstPickRule,
        first_ban_rotation: FirstBanRotation,
        preset: str | None = None,
        turn_timer_seconds: int | None = None,
        no_repeat_scope: PickBanNoRepeatScope,
        unique_attribute_per_side_per_round: str | None = None,
        allow_protect: bool = False,
        sequence: list[str],
        item_ids: list[int],
        slots: Sequence[SlotSpec] = (),
    ) -> PickBanConfig:
        """Create or update the config at the ``(tournament, kind, stage, round)``
        cascade level, replacing its pool wholesale.

        Does NOT commit: the caller owns the unit of work (and, for the admin
        route, the ``refresh`` + serialization that follows it). Body-shape
        validation is the caller's too -- ``pick_ban_session.validate_pick_ban_config``
        / ``validate_pick_ban_slot_config`` -- because it depends only on the
        payload, never on the database.
        """
        if stage_id is not None:
            stage_tournament_id = await self.stage_repo.get_tournament_id(session, stage_id)
            if stage_tournament_id is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stage not found")
            if stage_tournament_id != tournament_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Stage does not belong to this tournament",
                )

        # Upsert key = (tournament_id, kind, stage_id, round) — same cascade
        # level as veto_admin, additionally partitioned by kind.
        config = await self.config_repo.find_for_stage_round(
            session,
            tournament_id=tournament_id,
            kind=kind,
            stage_id=stage_id,
            round=round,
            options=CONFIG_POOL_LOAD,
        )

        if config is None:
            config = PickBanConfig(
                tournament_id=tournament_id,
                kind=kind,
                stage_id=stage_id,
                round=round,
                mode=mode,
                first_pick_rule=first_pick_rule,
                first_ban_rotation=first_ban_rotation,
                preset=preset,
                turn_timer_seconds=turn_timer_seconds,
                no_repeat_scope=no_repeat_scope,
                unique_attribute_per_side_per_round=unique_attribute_per_side_per_round,
                allow_protect=allow_protect,
                sequence_json=sequence,
                # Set while pending: initializes both collections locally, so the
                # replacement below assigns onto loaded collections. Without them
                # `create`'s flush makes the row persistent with `items`/`slots`
                # unloaded and the assignment lazy-loads -> `MissingGreenlet`.
                items=[],
                slots=[],
            )
            await self.config_repo.create(session, config)
        else:
            config.mode = mode
            config.first_pick_rule = first_pick_rule
            config.first_ban_rotation = first_ban_rotation
            config.preset = preset
            config.turn_timer_seconds = turn_timer_seconds
            config.no_repeat_scope = no_repeat_scope
            config.unique_attribute_per_side_per_round = unique_attribute_per_side_per_round
            config.allow_protect = allow_protect
            config.sequence_json = sequence
            # Wholesale replace, cleared+flushed first — same ordering rationale
            # as veto_admin's upsert (SQLAlchemy would otherwise emit the new
            # children's INSERTs before the old ones' DELETEs and trip the
            # plain UNIQUE constraints on position/item_id). The clear rides the
            # `delete-orphan` cascade on both relationships, so it stays ORM-level
            # rather than becoming a statement delete the loaded collection would
            # then disagree with.
            config.items = []
            config.slots = []
            await session.flush()

        config.items = [PickBanConfigItem(item_id=item_id, sort_order=idx) for idx, item_id in enumerate(item_ids)]
        config.slots = [
            PickBanConfigSlot(
                position=index + 1,
                reserve_item_id=slot.reserve_item_id,
                items=[
                    PickBanConfigSlotItem(item_id=item_id, sort_order=order)
                    for order, item_id in enumerate(slot.candidates)
                ],
            )
            for index, slot in enumerate(slots)
        ]
        return config

    async def delete_config(self, session: AsyncSession, config_id: int) -> None:
        """Delete one config, or 404. Its items/slots go with it through the
        same ``delete-orphan`` cascade the upsert's replacement rides."""
        config = await self.get_config(session, config_id)
        await self.config_repo.delete(session, config)


pick_ban_config_service = PickBanConfigService()

__all__ = ("CONFIG_POOL_LOAD", "PickBanConfigService", "SlotSpec", "pick_ban_config_service")
