from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, Enum, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db, enums
from shared.models.catalog.map import Map
from shared.models.tournament.encounter import Encounter
from shared.models.tournament.stage import Stage
from shared.models.tournament.team import Team
from shared.models.tournament.tournament import Tournament

__all__ = (
    "EncounterMapPool",
    "EncounterVetoSession",
    "MapVetoConfig",
    "MapVetoConfigMap",
    "MapVetoConfigSlot",
    "MapVetoConfigSlotMap",
)


MAP_PICK_SIDE_ENUM = Enum(
    enums.MapPickSide,
    values_callable=lambda e: [x.value for x in e],
    name="mappickside",
    schema="tournament",
    create_type=False,
)

MAP_POOL_ENTRY_STATUS_ENUM = Enum(
    enums.MapPoolEntryStatus,
    values_callable=lambda e: [x.value for x in e],
    name="mappoolentrystatus",
    schema="tournament",
    create_type=False,
)

MAP_VETO_SESSION_STATUS_ENUM = Enum(
    enums.MapVetoSessionStatus,
    values_callable=lambda e: [x.value for x in e],
    name="mapvetosessionstatus",
    schema="tournament",
    create_type=False,
)

VETO_SEED_SOURCE_ENUM = Enum(
    enums.VetoSeedSource,
    values_callable=lambda e: [x.value for x in e],
    name="vetoseedsource",
    schema="tournament",
    create_type=False,
)

FIRST_PICK_RULE_ENUM = Enum(
    enums.FirstPickRule,
    values_callable=lambda e: [x.value for x in e],
    name="firstpickrule",
    schema="tournament",
    create_type=False,
)

MAP_VETO_MODE_ENUM = Enum(
    enums.MapVetoMode,
    values_callable=lambda e: [x.value for x in e],
    name="mapvetomode",
    schema="tournament",
    create_type=False,
)

FIRST_BAN_ROTATION_ENUM = Enum(
    enums.FirstBanRotation,
    values_callable=lambda e: [x.value for x in e],
    name="firstbanrotation",
    schema="tournament",
    create_type=False,
)


class EncounterMapPool(db.TimeStampIntegerMixin):
    __tablename__ = "encounter_map_pool"
    __table_args__ = ({"schema": "tournament"},)

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"), index=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("overwatch.map.id", ondelete="CASCADE"), index=True)
    order: Mapped[int] = mapped_column(Integer(), default=0)
    # Global position of the veto action that touched this entry (bans AND picks),
    # for the room's action timeline. NULL while the map is still available.
    action_index: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    # Play-order number of the config slot this entry belongs to — the slot's
    # ``position`` **value**, copied onto the row at session creation, not a FK
    # to ``map_veto_config_slot.id``. NULL in flat mode.
    slot: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    picked_by: Mapped[enums.MapPickSide | None] = mapped_column(
        MAP_PICK_SIDE_ENUM,
        nullable=True,
    )
    status: Mapped[enums.MapPoolEntryStatus] = mapped_column(
        MAP_POOL_ENTRY_STATUS_ENUM,
        default=enums.MapPoolEntryStatus.AVAILABLE,
        server_default=enums.MapPoolEntryStatus.AVAILABLE.value,
    )
    # Denormalized picking team (mirrors ``picked_by``): PICKED+home ->
    # encounter.home_team_id, PICKED+away -> encounter.away_team_id; NULL for the
    # ``decider`` map, banned and still-available entries. ``picked_by`` stays
    # authoritative for the veto sequence; this is a convenience for report/UI
    # consumers that key off team_id.
    team_id: Mapped[int | None] = mapped_column(ForeignKey(Team.id, ondelete="SET NULL"), nullable=True, index=True)

    encounter: Mapped[Encounter] = relationship()
    map: Mapped[Map] = relationship()
    team: Mapped["Team | None"] = relationship()


class MapVetoConfig(db.TimeStampIntegerMixin):
    __tablename__ = "map_veto_config"
    __table_args__ = (
        # ``round`` is only meaningful within a stage; a tournament-wide config
        # has both NULL. One config per cascade level (PG16 NULLS NOT DISTINCT
        # so the (tournament, NULL, NULL) default level is also unique).
        CheckConstraint("round IS NULL OR stage_id IS NOT NULL", name="ck_map_veto_config_round_requires_stage"),
        # A slot-mode sequence is derived from the slot structure, so a
        # hand-authored ``custom`` order contradicts the mode. ``mode`` is NOT
        # NULL, so only ``preset`` can leave the expression NULL, and a CHECK
        # passes on NULL — the intended reading: an unset preset is not a custom
        # one.
        CheckConstraint("NOT (mode = 'slots' AND preset = 'custom')", name="ck_map_veto_config_slots_not_custom"),
        Index(
            "uq_map_veto_config_level",
            "tournament_id",
            "stage_id",
            "round",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
        {"schema": "tournament"},
    )

    tournament_id: Mapped[int] = mapped_column(ForeignKey(Tournament.id, ondelete="CASCADE"), index=True)
    stage_id: Mapped[int | None] = mapped_column(ForeignKey(Stage.id, ondelete="CASCADE"), nullable=True)
    # Third cascade level: overrides for a specific bracket round within the stage.
    round: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    # Pool shape: one flat pool for the match, or one pool per slot.
    mode: Mapped[enums.MapVetoMode] = mapped_column(
        MAP_VETO_MODE_ENUM,
        default=enums.MapVetoMode.POOL,
        server_default=enums.MapVetoMode.POOL.value,
    )
    first_pick_rule: Mapped[enums.FirstPickRule] = mapped_column(
        FIRST_PICK_RULE_ENUM,
        default=enums.FirstPickRule.HIGHER_SEED,
        server_default=enums.FirstPickRule.HIGHER_SEED.value,
    )
    # Slot mode only: whether the same side opens every slot's bans or the
    # opener alternates slot to slot.
    first_ban_rotation: Mapped[enums.FirstBanRotation] = mapped_column(
        FIRST_BAN_ROTATION_ENUM,
        default=enums.FirstBanRotation.FIXED,
        server_default=enums.FirstBanRotation.FIXED.value,
    )
    # Per-step timer shown in the room; purely an indicator (never auto-acts).
    turn_timer_seconds: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    # UI label of the sequence template this config was built from (bo1/bo3/bo5/custom).
    preset: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Draft/ban step list of side-agnostic tokens (["ban_first", "ban_second",
    # "pick_first", "pick_second", "decider"]). Resolved to home/away per
    # encounter at session init (EncounterVetoSession.resolved_sequence_json).
    # Template-shaped ordered list of opaque step tokens, not FK ids, so it
    # stays JSON (see dbarch05 rationale). ``map_pool_ids`` (formerly a JSON
    # array of overwatch.map ids with no FK) was normalized into the
    # ``map_veto_config_map`` child table by dbarch05.
    veto_sequence_json: Mapped[list] = mapped_column(JSON, nullable=False)

    tournament: Mapped[Tournament] = relationship()
    stage: Mapped["Stage | None"] = relationship()
    map_pool: Mapped[list["MapVetoConfigMap"]] = relationship(
        back_populates="config",
        order_by="MapVetoConfigMap.sort_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    # Deliberately lazy, like ``map_pool``: every query site that needs slots
    # eager-loads the two-level chain explicitly
    # (``selectinload(slots).selectinload(maps)``), so the loading strategy stays
    # visible at the call site instead of being implied here.
    slots: Mapped[list["MapVetoConfigSlot"]] = relationship(
        back_populates="config",
        order_by="MapVetoConfigSlot.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class MapVetoConfigMap(db.TimeStampIntegerMixin):
    """One map in a :class:`MapVetoConfig`'s pool.

    Normalized replacement for the old ``MapVetoConfig.map_pool_ids`` JSON
    array (a bare list of ``overwatch.map`` ids with no referential integrity).
    ``sort_order`` preserves the array position.
    """

    __tablename__ = "map_veto_config_map"
    __table_args__ = (
        UniqueConstraint("map_veto_config_id", "map_id", name="uq_map_veto_config_map_config_map"),
        {"schema": "tournament"},
    )

    map_veto_config_id: Mapped[int] = mapped_column(ForeignKey(MapVetoConfig.id, ondelete="CASCADE"), index=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("overwatch.map.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="0", default=0)

    config: Mapped[MapVetoConfig] = relationship(back_populates="map_pool")
    map: Mapped[Map] = relationship()


class MapVetoConfigSlot(db.TimeStampIntegerMixin):
    """One slot of a slot-mode :class:`MapVetoConfig`.

    Slots are played in ``position`` order (1..N, N == the match's
    ``best_of``). Teams ban alternately among the slot's candidate maps until
    one survives; that map is played. ``reserve_map_id`` is the regulation's
    stand-in on a draw — labelled in the room, never activated by the platform.
    """

    __tablename__ = "map_veto_config_slot"
    __table_args__ = (
        UniqueConstraint("map_veto_config_id", "position", name="uq_map_veto_config_slot_position"),
        CheckConstraint("position >= 1", name="ck_map_veto_config_slot_position_positive"),
        {"schema": "tournament"},
    )

    map_veto_config_id: Mapped[int] = mapped_column(ForeignKey(MapVetoConfig.id, ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer(), nullable=False)
    reserve_map_id: Mapped[int | None] = mapped_column(
        ForeignKey("overwatch.map.id", ondelete="SET NULL"), nullable=True, index=True
    )

    config: Mapped[MapVetoConfig] = relationship(back_populates="slots")
    reserve_map: Mapped[Map | None] = relationship()
    maps: Mapped[list["MapVetoConfigSlotMap"]] = relationship(
        back_populates="slot",
        order_by="MapVetoConfigSlotMap.sort_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class MapVetoConfigSlotMap(db.TimeStampIntegerMixin):
    """One candidate map of a :class:`MapVetoConfigSlot`.

    A map may appear in several slots of the same config (uniqueness is per
    slot, not per config), which is why slot mode does not reuse
    ``map_veto_config_map``.
    """

    __tablename__ = "map_veto_config_slot_map"
    __table_args__ = (
        UniqueConstraint("map_veto_config_slot_id", "map_id", name="uq_map_veto_config_slot_map"),
        {"schema": "tournament"},
    )

    map_veto_config_slot_id: Mapped[int] = mapped_column(
        ForeignKey(MapVetoConfigSlot.id, ondelete="CASCADE"), index=True
    )
    map_id: Mapped[int] = mapped_column(ForeignKey("overwatch.map.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="0", default=0)

    slot: Mapped[MapVetoConfigSlot] = relationship(back_populates="maps")
    map: Mapped[Map] = relationship()


class EncounterVetoSession(db.TimeStampIntegerMixin):
    """Lifecycle of one encounter's veto room.

    Created (idempotently) once both encounter teams are known. Snapshots the
    seed resolution and the side-resolved step sequence so that later config
    edits or standings recalculations never change a running veto. Resetting a
    veto = delete session + pool rows and re-create.
    """

    __tablename__ = "encounter_veto_session"
    __table_args__ = (
        UniqueConstraint("encounter_id", name="uq_encounter_veto_session_encounter"),
        CheckConstraint("first_side IN ('home', 'away')", name="ck_encounter_veto_session_first_side"),
        {"schema": "tournament"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"), index=True)
    # Informational back-reference; the session carries full snapshots, so the
    # source config may be edited or deleted without affecting a running veto.
    config_id: Mapped[int | None] = mapped_column(ForeignKey(MapVetoConfig.id, ondelete="SET NULL"), nullable=True)
    # Which encounter side acts as "first" in the sequence (seed resolution result).
    first_side: Mapped[enums.MapPickSide] = mapped_column(MAP_PICK_SIDE_ENUM)
    seed_source: Mapped[enums.VetoSeedSource] = mapped_column(VETO_SEED_SOURCE_ENUM)
    home_seed: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    away_seed: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    # Step tokens with first/second already mapped to home/away
    # (e.g. ["ban_home", "ban_away", "pick_home", "pick_away", "decider"]).
    resolved_sequence_json: Mapped[list] = mapped_column(JSON, nullable=False)
    # Snapshot of the config's slot reserves, ``{"<slot position>": map_id}`` —
    # string-keyed because the column is JSON — so the room can label them
    # without re-reading (or being mutated by) the config.
    slot_reserves_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    turn_timer_seconds: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    status: Mapped[enums.MapVetoSessionStatus] = mapped_column(
        MAP_VETO_SESSION_STATUS_ENUM,
        default=enums.MapVetoSessionStatus.ACTIVE,
        server_default=enums.MapVetoSessionStatus.ACTIVE.value,
    )
    started_at: Mapped[datetime | None] = mapped_column(db.DateTime(timezone=True), nullable=True)
    # Reset on every completed step; the room's countdown anchors here.
    current_step_started_at: Mapped[datetime | None] = mapped_column(db.DateTime(timezone=True), nullable=True)

    encounter: Mapped[Encounter] = relationship()
    config: Mapped[MapVetoConfig | None] = relationship()
