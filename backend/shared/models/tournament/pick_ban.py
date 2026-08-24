"""Generic pick-ban engine: config, session, pool entries, and the cross-round
exclusion ledger shared by map veto and hero bans.
"""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db, enums
from shared.models.identity.user import User
from shared.models.tournament.encounter import Encounter
from shared.models.tournament.stage import Stage
from shared.models.tournament.team import Team
from shared.models.tournament.tournament import Tournament

__all__ = (
    "EncounterPickBanLedger",
    "EncounterReadiness",
    "PickBanConfig",
    "PickBanConfigItem",
    "PickBanConfigSlot",
    "PickBanConfigSlotItem",
    "PickBanEntry",
    "PickBanSession",
)


PICK_BAN_KIND_ENUM = Enum(
    enums.PickBanKind,
    values_callable=lambda e: [x.value for x in e],
    name="pickbankind",
    schema="tournament",
)

# Reused from the map-veto domain: side/status/rotation carry the same meaning
# generalized over kind, so they get their own PG enum types here rather than
# aliasing the ``map_*``-named ones, which stay owned by the legacy tables
# until the migration drops them (Decision log #9).
PICK_BAN_MODE_ENUM = Enum(
    enums.MapVetoMode,
    values_callable=lambda e: [x.value for x in e],
    name="pickbanmode",
    schema="tournament",
)

PICK_BAN_SIDE_ENUM = Enum(
    enums.MapPickSide,
    values_callable=lambda e: [x.value for x in e],
    name="pickbanside",
    schema="tournament",
)

PICK_BAN_ENTRY_STATUS_ENUM = Enum(
    enums.MapPoolEntryStatus,
    values_callable=lambda e: [x.value for x in e],
    name="pickbanentrystatus",
    schema="tournament",
)

PICK_BAN_SESSION_STATUS_ENUM = Enum(
    enums.MapVetoSessionStatus,
    values_callable=lambda e: [x.value for x in e],
    name="pickbansessionstatus",
    schema="tournament",
)

PICK_BAN_SEED_SOURCE_ENUM = Enum(
    enums.VetoSeedSource,
    values_callable=lambda e: [x.value for x in e],
    name="pickbanseedsource",
    schema="tournament",
)

PICK_BAN_ROTATION_ENUM = Enum(
    enums.FirstBanRotation,
    values_callable=lambda e: [x.value for x in e],
    name="pickbanrotation",
    schema="tournament",
)

PICK_BAN_NO_REPEAT_SCOPE_ENUM = Enum(
    enums.PickBanNoRepeatScope,
    values_callable=lambda e: [x.value for x in e],
    name="pickbannorepeatscope",
    schema="tournament",
)


class PickBanConfig(db.TimeStampIntegerMixin):
    """Organizer config for one pick-ban flow (map veto or hero bans).

    Same ``(tournament_id, stage_id, round)`` cascade as ``MapVetoConfig``, now
    partitioned additionally by ``kind`` — a tournament may run a map config and
    a hero config at the same cascade level side by side.
    """

    __tablename__ = "pick_ban_config"
    __table_args__ = (
        CheckConstraint("round IS NULL OR stage_id IS NOT NULL", name="ck_pick_ban_config_round_requires_stage"),
        CheckConstraint("NOT (mode = 'slots' AND preset = 'custom')", name="ck_pick_ban_config_slots_not_custom"),
        Index(
            "uq_pick_ban_config_level",
            "tournament_id",
            "kind",
            "stage_id",
            "round",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
        {"schema": "tournament"},
    )

    tournament_id: Mapped[int] = mapped_column(ForeignKey(Tournament.id, ondelete="CASCADE"), index=True)
    kind: Mapped[enums.PickBanKind] = mapped_column(PICK_BAN_KIND_ENUM)
    stage_id: Mapped[int | None] = mapped_column(ForeignKey(Stage.id, ondelete="CASCADE"), nullable=True)
    round: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    mode: Mapped[enums.MapVetoMode] = mapped_column(
        PICK_BAN_MODE_ENUM,
        default=enums.MapVetoMode.POOL,
        server_default=enums.MapVetoMode.POOL.value,
    )
    first_pick_rule: Mapped[enums.FirstPickRule] = mapped_column(
        Enum(
            enums.FirstPickRule,
            values_callable=lambda e: [x.value for x in e],
            name="pickbanfirstpickrule",
            schema="tournament",
        ),
        default=enums.FirstPickRule.HIGHER_SEED,
        server_default=enums.FirstPickRule.HIGHER_SEED.value,
    )
    first_ban_rotation: Mapped[enums.FirstBanRotation] = mapped_column(
        PICK_BAN_ROTATION_ENUM,
        default=enums.FirstBanRotation.FIXED,
        server_default=enums.FirstBanRotation.FIXED.value,
    )
    turn_timer_seconds: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    preset: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Side-agnostic step tokens: ban_first/ban_second/pick_first/pick_second/
    # protect_first/protect_second/decider. Same shape as MapVetoConfig's
    # ``veto_sequence_json``, plus the new ``protect_*`` tokens.
    sequence_json: Mapped[list] = mapped_column(JSON, nullable=False)
    # How many rounds (maps of the series) this config's per-round bans repeat
    # for. NULL means "resolve from the encounter's best_of at session time",
    # matching today's flat-mode behavior; slot-mode/per-round configs set it
    # implicitly via their slot count.
    no_repeat_scope: Mapped[enums.PickBanNoRepeatScope] = mapped_column(
        PICK_BAN_NO_REPEAT_SCOPE_ENUM,
        default=enums.PickBanNoRepeatScope.NONE,
        server_default=enums.PickBanNoRepeatScope.NONE.value,
    )
    # Generic attribute-uniqueness rule: reject a ban/protect that shares this
    # attribute's value with another action already taken by the SAME side in
    # the SAME round. NULL disables the check. Only "role" (hero catalog) is
    # implemented today; the column stays a free string so a future kind can
    # name its own attribute without a schema change.
    unique_attribute_per_side_per_round: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Whether this config's rounds run through the "protect" step (see
    # ``sequence_json``'s ``protect_*`` tokens) at all — kept separate from the
    # sequence itself so the admin UI can offer the toggle before the organizer
    # has authored a sequence with protect steps in it.
    allow_protect: Mapped[bool] = mapped_column(Boolean(), default=False, server_default="false")

    tournament: Mapped[Tournament] = relationship()
    stage: Mapped["Stage | None"] = relationship()
    items: Mapped[list["PickBanConfigItem"]] = relationship(
        back_populates="config",
        order_by="PickBanConfigItem.sort_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    slots: Mapped[list["PickBanConfigSlot"]] = relationship(
        back_populates="config",
        order_by="PickBanConfigSlot.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class PickBanConfigItem(db.TimeStampIntegerMixin):
    """One catalog item (map or hero id) in a flat-mode :class:`PickBanConfig` pool."""

    __tablename__ = "pick_ban_config_item"
    __table_args__ = (
        UniqueConstraint("pick_ban_config_id", "item_id", name="uq_pick_ban_config_item"),
        {"schema": "tournament"},
    )

    pick_ban_config_id: Mapped[int] = mapped_column(ForeignKey(PickBanConfig.id, ondelete="CASCADE"), index=True)
    # Soft reference: resolves against ``overwatch.map`` or ``overwatch.hero``
    # depending on the owning config's ``kind`` — no FK, mirroring how
    # ``EncounterMapPool``/entry rows already carry catalog ids without one per
    # kind (a single FK column cannot target two different tables).
    item_id: Mapped[int] = mapped_column(Integer(), index=True)
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="0", default=0)

    config: Mapped[PickBanConfig] = relationship(back_populates="items")


class PickBanConfigSlot(db.TimeStampIntegerMixin):
    """One slot (one map's worth of candidates) of a slot-mode :class:`PickBanConfig`."""

    __tablename__ = "pick_ban_config_slot"
    __table_args__ = (
        UniqueConstraint("pick_ban_config_id", "position", name="uq_pick_ban_config_slot_position"),
        CheckConstraint("position >= 1", name="ck_pick_ban_config_slot_position_positive"),
        {"schema": "tournament"},
    )

    pick_ban_config_id: Mapped[int] = mapped_column(ForeignKey(PickBanConfig.id, ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer(), nullable=False)
    # Reserve item on a draw (map mode only; meaningless but harmless for hero
    # configs, which never populate it).
    reserve_item_id: Mapped[int | None] = mapped_column(Integer(), nullable=True)

    config: Mapped[PickBanConfig] = relationship(back_populates="slots")
    items: Mapped[list["PickBanConfigSlotItem"]] = relationship(
        back_populates="slot",
        order_by="PickBanConfigSlotItem.sort_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class PickBanConfigSlotItem(db.TimeStampIntegerMixin):
    """One candidate item of a :class:`PickBanConfigSlot`."""

    __tablename__ = "pick_ban_config_slot_item"
    __table_args__ = (
        UniqueConstraint("pick_ban_config_slot_id", "item_id", name="uq_pick_ban_config_slot_item"),
        {"schema": "tournament"},
    )

    pick_ban_config_slot_id: Mapped[int] = mapped_column(
        ForeignKey(PickBanConfigSlot.id, ondelete="CASCADE"), index=True
    )
    item_id: Mapped[int] = mapped_column(Integer(), index=True)
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="0", default=0)

    slot: Mapped[PickBanConfigSlot] = relationship(back_populates="items")


class PickBanSession(db.TimeStampIntegerMixin):
    """Lifecycle of one encounter's pick-ban room, for one ``kind``.

    Generalizes ``EncounterVetoSession``. The key behavioral change:
    ``resolved_sequence_json``/its matching :class:`PickBanEntry` rows are not
    necessarily complete at creation. When ``first_ban_rotation`` is
    result-dependent, each map's block is appended only once the *previous*
    map's winner is known (via ``Match``, see the design doc §5.3/§5.5)."""

    __tablename__ = "pick_ban_session"
    __table_args__ = (
        UniqueConstraint("encounter_id", "kind", name="uq_pick_ban_session_encounter_kind"),
        CheckConstraint("first_side IS NULL OR first_side IN ('home', 'away')", name="ck_pick_ban_session_first_side"),
        {"schema": "tournament"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"), index=True)
    kind: Mapped[enums.PickBanKind] = mapped_column(PICK_BAN_KIND_ENUM)
    config_id: Mapped[int | None] = mapped_column(ForeignKey(PickBanConfig.id, ondelete="SET NULL"), nullable=True)
    # Nullable: NULL exactly while a round is `awaiting_choice`
    # (first_ban_rotation=result_loser_choice and nobody has called
    # elect_opener yet for the round currently being appended).
    first_side: Mapped[enums.MapPickSide | None] = mapped_column(PICK_BAN_SIDE_ENUM, nullable=True)
    seed_source: Mapped[enums.VetoSeedSource] = mapped_column(PICK_BAN_SEED_SOURCE_ENUM)
    home_seed: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    away_seed: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    resolved_sequence_json: Mapped[list] = mapped_column(JSON, nullable=False)
    slot_reserves_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    turn_timer_seconds: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    status: Mapped[enums.MapVetoSessionStatus] = mapped_column(
        PICK_BAN_SESSION_STATUS_ENUM,
        default=enums.MapVetoSessionStatus.ACTIVE,
        server_default=enums.MapVetoSessionStatus.ACTIVE.value,
    )
    # True exactly while the session is waiting on an `elect_opener` call for
    # the round it is about to append (result_loser_choice rotation only).
    awaiting_choice: Mapped[bool] = mapped_column(Boolean(), default=False, server_default="false")
    # Who is entitled to call `elect_opener` while `awaiting_choice` is true —
    # the loser of the round that just triggered `RotationNeedsChoice`
    # (`result_loser_choice` is the only rotation that ever sets this). NULL
    # whenever `awaiting_choice` is false. Without it `elect_opener` could not
    # tell the loser's captain from the winner's, and either could dictate the
    # next round's opener.
    pending_loser_side: Mapped[enums.MapPickSide | None] = mapped_column(PICK_BAN_SIDE_ENUM, nullable=True)
    # Undo consent. A captain may ask for the session's last action to be taken
    # back; the OPPONENT's matching call applies it (both sides agree, which is
    # what keeps a mistake from becoming a re-pick nobody consented to). The
    # request names the ``PickBanEntry.action_index`` it was made against, so an
    # action landing in between cannot be undone by a consent meant for a
    # different one -- a new action clears the request outright
    # (``pick_ban_action.apply_pick_ban_action``). Both NULL = no request open.
    undo_requested_by: Mapped[enums.MapPickSide | None] = mapped_column(PICK_BAN_SIDE_ENUM, nullable=True)
    undo_target_index: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(db.DateTime(timezone=True), nullable=True)
    current_step_started_at: Mapped[datetime | None] = mapped_column(db.DateTime(timezone=True), nullable=True)

    encounter: Mapped[Encounter] = relationship()
    config: Mapped[PickBanConfig | None] = relationship()


class PickBanEntry(db.TimeStampIntegerMixin):
    """One catalog item's state within a :class:`PickBanSession`.

    Generalizes ``EncounterMapPool``. ``item_id`` resolves against the map or
    hero catalog per the owning session's ``kind``.
    """

    __tablename__ = "pick_ban_entry"
    __table_args__ = (
        # One committed step, one entry. ``action_index`` IS the position in the
        # session's resolved sequence that produced this entry, so two rows
        # claiming the same position means one step was resolved twice -- the
        # shape a lost race leaves behind (see
        # ``pick_ban_session.get_pick_ban_session``). Locking is what prevents
        # it; this is the backstop that turns a slipped-through duplicate into a
        # failed write instead of a silently lopsided ban phase. Partial,
        # because an AVAILABLE candidate (and an undone action) carries no
        # position at all and there are many of those per session.
        Index(
            "uq_pick_ban_entry_session_action_index",
            "session_id",
            "action_index",
            unique=True,
            postgresql_where=text("action_index IS NOT NULL"),
        ),
        {"schema": "tournament"},
    )

    session_id: Mapped[int] = mapped_column(ForeignKey(PickBanSession.id, ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(Integer(), index=True)
    order: Mapped[int] = mapped_column(Integer(), default=0)
    action_index: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    # Which map-of-the-series this entry belongs to. For map-kind entries this
    # IS the slot/round number (1-based); for hero-kind entries it is the same
    # round number of the map whose hero-ban phase this entry is part of — the
    # two kinds' sessions stay in lockstep by round number, which is how the
    # ledger correlates "map N's hero bans" across a series.
    round: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    picked_by: Mapped[enums.MapPickSide | None] = mapped_column(PICK_BAN_SIDE_ENUM, nullable=True)
    status: Mapped[enums.MapPoolEntryStatus] = mapped_column(
        PICK_BAN_ENTRY_STATUS_ENUM,
        default=enums.MapPoolEntryStatus.AVAILABLE,
        server_default=enums.MapPoolEntryStatus.AVAILABLE.value,
    )
    team_id: Mapped[int | None] = mapped_column(ForeignKey(Team.id, ondelete="SET NULL"), nullable=True, index=True)
    # Set together with status=PROTECTED: which side protected it. The entry is
    # then out of ban range for the rest of the round (``is_entry_bannable``) --
    # that immunity IS the action. Nothing else about it is remembered: a
    # protect never enters ``EncounterPickBanLedger`` (entries are per-round
    # rows, so protection is round-local) and it does not spend that side's
    # ban budget under ``unique_attribute_per_side_per_round`` -- bans and
    # protects never restrict each other.
    protected_by: Mapped[enums.MapPickSide | None] = mapped_column(PICK_BAN_SIDE_ENUM, nullable=True)

    session: Mapped[PickBanSession] = relationship()
    team: Mapped["Team | None"] = relationship()


class EncounterPickBanLedger(db.TimeStampIntegerMixin):
    """Cross-round BAN memory: every item banned anywhere in this encounter's
    series, for a given ``kind``.

    Read when a new round's candidate pool is built (excluded per the owning
    config's ``no_repeat_scope``); written once when a round's bans commit.
    Never read or written mid-round. Protects are deliberately NOT recorded:
    a remembered protect would exclude its item from later rounds exactly as a
    ban does.
    """

    __tablename__ = "encounter_pick_ban_ledger"
    __table_args__ = (
        UniqueConstraint(
            "encounter_id", "kind", "item_id", "banned_by_side", name="uq_encounter_pick_ban_ledger_entry"
        ),
        {"schema": "tournament"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"), index=True)
    kind: Mapped[enums.PickBanKind] = mapped_column(PICK_BAN_KIND_ENUM)
    item_id: Mapped[int] = mapped_column(Integer(), index=True)
    # The side that banned it. Required (not nullable) even for a
    # ``no_repeat_scope=encounter`` (global) rule: the scope decides at READ
    # time whether to filter by side or ignore it, so one ledger shape serves
    # both scopes without a second nullable-vs-not column pair.
    banned_by_side: Mapped[enums.MapPickSide] = mapped_column(PICK_BAN_SIDE_ENUM)
    round: Mapped[int] = mapped_column(Integer())

    encounter: Mapped[Encounter] = relationship()


class EncounterReadiness(db.TimeStampIntegerMixin):
    """One captain side's confirmation that their team is ready to begin this
    encounter's pre-game phase.

    Shared across BOTH :class:`PickBanSession` kinds (map veto + hero bans):
    the same captain confirms once for the whole match, not once per kind, so
    ``ensure_pick_ban_session`` refuses to create a session of EITHER kind
    until both sides have a row here. Cleared by
    ``sync_all_pick_ban_sessions_after_team_change`` whenever either team
    assignment changes -- a confirmation made against one opponent must not
    carry over to a different one.
    """

    __tablename__ = "encounter_readiness"
    __table_args__ = (
        UniqueConstraint("encounter_id", "side", name="uq_encounter_readiness_encounter_side"),
        {"schema": "tournament"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"), index=True)
    side: Mapped[str] = mapped_column(String(16))
    ready_user_id: Mapped[int | None] = mapped_column(ForeignKey(User.id, ondelete="SET NULL"), nullable=True)

    encounter: Mapped[Encounter] = relationship()
    ready_user: Mapped["User | None"] = relationship()
