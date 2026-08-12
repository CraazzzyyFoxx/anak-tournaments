"""Slot-based map pools for map veto.

Revision ID: vetoslot01
Revises: substage0001
Create Date: 2026-08-09 00:00:00.000000

Adds the `slots` veto mode: a config may describe an ordered list of slots, each
holding candidate maps plus an optional reserve. Flat ("pool") mode is untouched
— `map_veto_config_map` is not modified and existing rows default to
`mode='pool'`, so there is no data migration.

Design: docs/plans/2026-08-05-map-veto-slot-pools.md

New tables
==========
- ``tournament.map_veto_config_slot`` — one row per slot, ordered by `position`
  (>= 1, unique per config), with an optional `reserve_map_id`.
- ``tournament.map_veto_config_slot_map`` — the candidate maps of a slot.

Columns added to pre-existing tables
====================================
- ``map_veto_config.mode`` / ``first_ban_rotation`` — both NOT NULL with server
  defaults, so existing configs stay flat-mode without a backfill.
- ``map_veto_config`` additionally gains CHECK
  ``ck_map_veto_config_slots_not_custom`` — ``NOT (mode = 'slots' AND preset =
  'custom')``. A slot-mode sequence is derived from the slot structure, so a
  hand-authored `custom` order contradicts the mode outright, and design §4.1
  asks for it at the database level rather than only in the validator. A NULL
  `preset` leaves the expression NULL, which a CHECK treats as satisfied — the
  intended reading, since an unset preset is not a custom one.
- ``encounter_map_pool.slot`` — the config slot's `position` **value**, copied
  onto the row at session creation; it is NOT a foreign key to
  `map_veto_config_slot.id`. The table now carries three unrelated integers —
  `order` (pool order, then play order), `action_index` (global veto-action
  order) and `slot` — and `slot` is the only one holding another table's value
  rather than an id, which is why `apply_veto_action` keys its lookup on
  `(map_id, slot)`.
- ``encounter_veto_session.slot_reserves_json`` — a `{slot_position: map_id}`
  snapshot, needed because `build_map_pool_state` never sees a config.

Enum types are created with raw CREATE TYPE and referenced with
`create_type=False`, matching mapveto0001. `downgrade` cancels slot-mode veto
sessions BEFORE dropping the tables: a slot-mode `resolved_sequence_json`
carries one decider per slot, which the pre-feature engine rejects, and once the
slot tables are gone a reset cannot rebuild the session (design Decision 20).

Orphaned slot-mode sessions are NOT cancelled. The cancel reaches sessions only
through `config_id`, so one whose config was already deleted (`config_id IS
NULL`, via that FK's ON DELETE SET NULL) survives the downgrade still carrying a
per-slot-decider sequence the pre-feature engine rejects. That is Decision 20 as
written, not an oversight to patch here: widening the predicate — say, to target
sequences carrying more than one decider token — changes the decision and
belongs in design review, not in this migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "vetoslot01"
down_revision: str | Sequence[str] | None = "substage0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MODE_ENUM = postgresql.ENUM(name="mapvetomode", schema="tournament", create_type=False)
_ROTATION_ENUM = postgresql.ENUM(name="firstbanrotation", schema="tournament", create_type=False)


def upgrade() -> None:
    op.execute("CREATE TYPE tournament.mapvetomode AS ENUM ('pool', 'slots')")
    op.execute("CREATE TYPE tournament.firstbanrotation AS ENUM ('fixed', 'alternate')")

    op.add_column(
        "map_veto_config",
        sa.Column("mode", _MODE_ENUM, nullable=False, server_default="pool"),
        schema="tournament",
    )
    op.add_column(
        "map_veto_config",
        sa.Column("first_ban_rotation", _ROTATION_ENUM, nullable=False, server_default="fixed"),
        schema="tournament",
    )

    # Design §4.1's second CHECK. `mode` is NOT NULL, so only `preset` can make
    # the expression NULL; a CHECK passes on NULL, which is the reading we want
    # (an unset preset is not a custom one). Added after both columns exist and
    # after `mode`'s server_default has backfilled existing rows to 'pool', so no
    # current row can violate it.
    op.create_check_constraint(
        "ck_map_veto_config_slots_not_custom",
        "map_veto_config",
        "NOT (mode = 'slots' AND preset = 'custom')",
        schema="tournament",
    )

    op.create_table(
        "map_veto_config_slot",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("map_veto_config_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("reserve_map_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["map_veto_config_id"], ["tournament.map_veto_config.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reserve_map_id"], ["overwatch.map.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("map_veto_config_id", "position", name="uq_map_veto_config_slot_position"),
        sa.CheckConstraint("position >= 1", name="ck_map_veto_config_slot_position_positive"),
        schema="tournament",
    )
    op.create_index(
        "ix_map_veto_config_slot_map_veto_config_id",
        "map_veto_config_slot",
        ["map_veto_config_id"],
        schema="tournament",
    )
    # Both FKs are indexed (dbarch01_index_fk_hygiene's rule): without this every
    # overwatch.map delete sequentially scans this table to enforce SET NULL.
    op.create_index(
        "ix_map_veto_config_slot_reserve_map_id",
        "map_veto_config_slot",
        ["reserve_map_id"],
        schema="tournament",
    )

    op.create_table(
        "map_veto_config_slot_map",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("map_veto_config_slot_id", sa.BigInteger(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["map_veto_config_slot_id"], ["tournament.map_veto_config_slot.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("map_veto_config_slot_id", "map_id", name="uq_map_veto_config_slot_map"),
        schema="tournament",
    )
    op.create_index(
        "ix_map_veto_config_slot_map_map_veto_config_slot_id",
        "map_veto_config_slot_map",
        ["map_veto_config_slot_id"],
        schema="tournament",
    )
    op.create_index(
        "ix_map_veto_config_slot_map_map_id",
        "map_veto_config_slot_map",
        ["map_id"],
        schema="tournament",
    )

    op.add_column("encounter_map_pool", sa.Column("slot", sa.Integer(), nullable=True), schema="tournament")
    op.add_column(
        "encounter_veto_session",
        sa.Column("slot_reserves_json", sa.JSON(), nullable=True),
        schema="tournament",
    )


def downgrade() -> None:
    # Cancel slot-mode sessions first: their resolved sequences carry one decider
    # per slot, which the pre-feature engine rejects, and after the drop below a
    # reset cannot rebuild them. Design Decision 20.
    #
    # ORDER IS LOAD-BEARING: this statement reads `map_veto_config.mode`, which is
    # dropped at the bottom of this function. The reorganisation that breaks it is
    # hoisting the `map_veto_config` column drops and the DROP TYPE calls to the
    # top, mirroring the order `upgrade` creates them in — that drops `mode`
    # before this UPDATE reads it and turns a rollback into a mid-transaction
    # failure.
    op.execute(
        """
        UPDATE tournament.encounter_veto_session s
        SET status = 'cancelled'
        FROM tournament.map_veto_config c
        WHERE s.config_id = c.id AND c.mode = 'slots'
        """
    )

    op.drop_column("encounter_veto_session", "slot_reserves_json", schema="tournament")
    op.drop_column("encounter_map_pool", "slot", schema="tournament")
    op.drop_index("ix_map_veto_config_slot_map_map_id", table_name="map_veto_config_slot_map", schema="tournament")
    op.drop_index(
        "ix_map_veto_config_slot_map_map_veto_config_slot_id",
        table_name="map_veto_config_slot_map",
        schema="tournament",
    )
    op.drop_table("map_veto_config_slot_map", schema="tournament")
    op.drop_index("ix_map_veto_config_slot_reserve_map_id", table_name="map_veto_config_slot", schema="tournament")
    op.drop_index("ix_map_veto_config_slot_map_veto_config_id", table_name="map_veto_config_slot", schema="tournament")
    op.drop_table("map_veto_config_slot", schema="tournament")
    # Before the `mode` drop below: the constraint references that column.
    op.drop_constraint("ck_map_veto_config_slots_not_custom", "map_veto_config", type_="check", schema="tournament")
    op.drop_column("map_veto_config", "first_ban_rotation", schema="tournament")
    op.drop_column("map_veto_config", "mode", schema="tournament")

    op.execute("DROP TYPE IF EXISTS tournament.firstbanrotation")
    op.execute("DROP TYPE IF EXISTS tournament.mapvetomode")
