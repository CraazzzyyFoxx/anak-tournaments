"""Generic pick-ban engine (map veto + hero bans) — additive schema.

Revision ID: pickban01
Revises: vetoslot01
Create Date: 2026-08-09 00:00:00.000000

Adds the pick-ban engine tables described in
docs/plans/2026-08-09-generic-pickban-engine.md: a pool-agnostic (map/hero)
generalization of ``map_veto_config``/``encounter_veto_session``/
``encounter_map_pool``, plus the per-map result-confirmation and cross-round
memory tables the design needs to progress a series map by map instead of
resolving it all upfront.

Purely additive: the legacy ``map_veto_config``/``encounter_veto_session``/
``encounter_map_pool`` tables and their enum types are untouched by this
migration. Per Decision log #9, the old tables are dropped in a LATER
migration, only once the new engine has run in production and a backfill
parity check has passed (design §5.9) — this migration does not perform that
backfill, it only creates the target schema.

New enum types
==============
All new PG enum types are independent of the legacy ``map*``-named ones (they
share Python enum classes for value literals, but are separate PG types), so
none of the legacy types are altered here.

New tables (schema ``tournament`` unless noted)
================================================
- ``pick_ban_config`` / ``pick_ban_config_item`` / ``pick_ban_config_slot`` /
  ``pick_ban_config_slot_item`` — organizer config, generalizing
  ``map_veto_config`` (+ its map/slot/slot-map children) with a ``kind``
  column (map|hero) and the new ``protect`` step / result-dependent rotation /
  ledger-scope / role-uniqueness options.
- ``pick_ban_session`` / ``pick_ban_entry`` — generalizes
  ``encounter_veto_session``/``encounter_map_pool``. ``first_side`` is
  nullable (NULL exactly while ``awaiting_choice`` is true, i.e. a
  ``result_loser_choice`` round has not been resolved by ``elect_opener``
  yet).
- ``encounter_pick_ban_ledger`` — cross-round "already banned/protected in
  this series" memory, read when a new round's pool is built.
- ``encounter_map_report`` (schema ``tournament``) — per-captain, per-map
  independent result claim; reconciled into a ``matches.match`` row.

Column changes
==============
- ``matches.match``: new ``source`` enum (``log_parser`` default — every
  existing row genuinely came from the log parser, never re-guessed);
  ``time``/``log_name`` become nullable (a ``captain_report``-sourced row has
  neither).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "pickban01"
down_revision: str | Sequence[str] | None = "vetoslot01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KIND_ENUM = postgresql.ENUM(name="pickbankind", schema="tournament", create_type=False)
_MODE_ENUM = postgresql.ENUM(name="pickbanmode", schema="tournament", create_type=False)
_FIRST_PICK_RULE_ENUM = postgresql.ENUM(name="pickbanfirstpickrule", schema="tournament", create_type=False)
_ROTATION_ENUM = postgresql.ENUM(name="pickbanrotation", schema="tournament", create_type=False)
_NO_REPEAT_SCOPE_ENUM = postgresql.ENUM(name="pickbannorepeatscope", schema="tournament", create_type=False)
_SIDE_ENUM = postgresql.ENUM(name="pickbanside", schema="tournament", create_type=False)
_ENTRY_STATUS_ENUM = postgresql.ENUM(name="pickbanentrystatus", schema="tournament", create_type=False)
_SESSION_STATUS_ENUM = postgresql.ENUM(name="pickbansessionstatus", schema="tournament", create_type=False)
_SEED_SOURCE_ENUM = postgresql.ENUM(name="pickbanseedsource", schema="tournament", create_type=False)
_MATCH_SOURCE_ENUM = postgresql.ENUM(name="matchsource", schema="matches", create_type=False)

_TIMESTAMP_COLUMNS = (
    sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
)


def upgrade() -> None:
    op.execute("CREATE TYPE tournament.pickbankind AS ENUM ('map', 'hero')")
    op.execute("CREATE TYPE tournament.pickbanmode AS ENUM ('pool', 'slots')")
    op.execute("CREATE TYPE tournament.pickbanfirstpickrule AS ENUM ('higher_seed')")
    op.execute(
        "CREATE TYPE tournament.pickbanrotation AS ENUM "
        "('fixed', 'alternate', 'result_winner_first', 'result_loser_first', 'result_loser_choice')"
    )
    op.execute("CREATE TYPE tournament.pickbannorepeatscope AS ENUM ('none', 'encounter', 'encounter_same_side')")
    op.execute("CREATE TYPE tournament.pickbanside AS ENUM ('home', 'away', 'decider', 'admin')")
    op.execute(
        "CREATE TYPE tournament.pickbanentrystatus AS ENUM ('available', 'picked', 'banned', 'played', 'protected')"
    )
    op.execute("CREATE TYPE tournament.pickbansessionstatus AS ENUM ('active', 'completed', 'cancelled')")
    op.execute(
        "CREATE TYPE tournament.pickbanseedsource AS ENUM ('bracket_slot', 'standings', 'fallback_home', 'admin')"
    )
    op.execute("CREATE TYPE matches.matchsource AS ENUM ('log_parser', 'captain_report')")

    # ── pick_ban_config ─────────────────────────────────────────────────────
    op.create_table(
        "pick_ban_config",
        *_TIMESTAMP_COLUMNS,
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", _KIND_ENUM, nullable=False),
        sa.Column("stage_id", sa.BigInteger(), nullable=True),
        sa.Column("round", sa.Integer(), nullable=True),
        sa.Column("mode", _MODE_ENUM, nullable=False, server_default="pool"),
        sa.Column("first_pick_rule", _FIRST_PICK_RULE_ENUM, nullable=False, server_default="higher_seed"),
        sa.Column("first_ban_rotation", _ROTATION_ENUM, nullable=False, server_default="fixed"),
        sa.Column("turn_timer_seconds", sa.Integer(), nullable=True),
        sa.Column("preset", sa.String(32), nullable=True),
        sa.Column("sequence_json", sa.JSON(), nullable=False),
        sa.Column("no_repeat_scope", _NO_REPEAT_SCOPE_ENUM, nullable=False, server_default="none"),
        sa.Column("unique_attribute_per_side_per_round", sa.String(32), nullable=True),
        sa.Column("allow_protect", sa.Boolean(), nullable=False, server_default="false"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="CASCADE"),
        sa.CheckConstraint("round IS NULL OR stage_id IS NOT NULL", name="ck_pick_ban_config_round_requires_stage"),
        sa.CheckConstraint("NOT (mode = 'slots' AND preset = 'custom')", name="ck_pick_ban_config_slots_not_custom"),
        schema="tournament",
    )
    op.create_index("ix_pick_ban_config_tournament_id", "pick_ban_config", ["tournament_id"], schema="tournament")
    op.create_index(
        "uq_pick_ban_config_level",
        "pick_ban_config",
        ["tournament_id", "kind", "stage_id", "round"],
        unique=True,
        schema="tournament",
        postgresql_nulls_not_distinct=True,
    )

    # ── pick_ban_config_item (flat-mode pool) ───────────────────────────────
    op.create_table(
        "pick_ban_config_item",
        *_TIMESTAMP_COLUMNS,
        sa.Column("pick_ban_config_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pick_ban_config_id"], ["tournament.pick_ban_config.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("pick_ban_config_id", "item_id", name="uq_pick_ban_config_item"),
        schema="tournament",
    )
    op.create_index(
        "ix_pick_ban_config_item_pick_ban_config_id",
        "pick_ban_config_item",
        ["pick_ban_config_id"],
        schema="tournament",
    )
    op.create_index("ix_pick_ban_config_item_item_id", "pick_ban_config_item", ["item_id"], schema="tournament")

    # ── pick_ban_config_slot / _item (slot-mode pool) ───────────────────────
    op.create_table(
        "pick_ban_config_slot",
        *_TIMESTAMP_COLUMNS,
        sa.Column("pick_ban_config_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("reserve_item_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pick_ban_config_id"], ["tournament.pick_ban_config.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("pick_ban_config_id", "position", name="uq_pick_ban_config_slot_position"),
        sa.CheckConstraint("position >= 1", name="ck_pick_ban_config_slot_position_positive"),
        schema="tournament",
    )
    op.create_index(
        "ix_pick_ban_config_slot_pick_ban_config_id",
        "pick_ban_config_slot",
        ["pick_ban_config_id"],
        schema="tournament",
    )

    op.create_table(
        "pick_ban_config_slot_item",
        *_TIMESTAMP_COLUMNS,
        sa.Column("pick_ban_config_slot_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["pick_ban_config_slot_id"], ["tournament.pick_ban_config_slot.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("pick_ban_config_slot_id", "item_id", name="uq_pick_ban_config_slot_item"),
        schema="tournament",
    )
    op.create_index(
        "ix_pick_ban_config_slot_item_pick_ban_config_slot_id",
        "pick_ban_config_slot_item",
        ["pick_ban_config_slot_id"],
        schema="tournament",
    )

    # ── pick_ban_session / pick_ban_entry ───────────────────────────────────
    op.create_table(
        "pick_ban_session",
        *_TIMESTAMP_COLUMNS,
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", _KIND_ENUM, nullable=False),
        sa.Column("config_id", sa.BigInteger(), nullable=True),
        sa.Column("first_side", _SIDE_ENUM, nullable=True),
        sa.Column("seed_source", _SEED_SOURCE_ENUM, nullable=False),
        sa.Column("home_seed", sa.Integer(), nullable=True),
        sa.Column("away_seed", sa.Integer(), nullable=True),
        sa.Column("resolved_sequence_json", sa.JSON(), nullable=False),
        sa.Column("slot_reserves_json", sa.JSON(), nullable=True),
        sa.Column("turn_timer_seconds", sa.Integer(), nullable=True),
        sa.Column("status", _SESSION_STATUS_ENUM, nullable=False, server_default="active"),
        sa.Column("awaiting_choice", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("pending_loser_side", _SIDE_ENUM, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_step_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["config_id"], ["tournament.pick_ban_config.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("encounter_id", "kind", name="uq_pick_ban_session_encounter_kind"),
        sa.CheckConstraint(
            "first_side IS NULL OR first_side IN ('home', 'away')", name="ck_pick_ban_session_first_side"
        ),
        schema="tournament",
    )
    op.create_index("ix_pick_ban_session_encounter_id", "pick_ban_session", ["encounter_id"], schema="tournament")

    op.create_table(
        "pick_ban_entry",
        *_TIMESTAMP_COLUMNS,
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("action_index", sa.Integer(), nullable=True),
        sa.Column("round", sa.Integer(), nullable=True),
        sa.Column("picked_by", _SIDE_ENUM, nullable=True),
        sa.Column("status", _ENTRY_STATUS_ENUM, nullable=False, server_default="available"),
        sa.Column("team_id", sa.BigInteger(), nullable=True),
        sa.Column("protected_by", _SIDE_ENUM, nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["session_id"], ["tournament.pick_ban_session.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="SET NULL"),
        schema="tournament",
    )
    op.create_index("ix_pick_ban_entry_session_id", "pick_ban_entry", ["session_id"], schema="tournament")
    op.create_index("ix_pick_ban_entry_item_id", "pick_ban_entry", ["item_id"], schema="tournament")
    op.create_index("ix_pick_ban_entry_team_id", "pick_ban_entry", ["team_id"], schema="tournament")

    # ── encounter_pick_ban_ledger ────────────────────────────────────────────
    op.create_table(
        "encounter_pick_ban_ledger",
        *_TIMESTAMP_COLUMNS,
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", _KIND_ENUM, nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("banned_by_side", _SIDE_ENUM, nullable=False),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "encounter_id", "kind", "item_id", "banned_by_side", name="uq_encounter_pick_ban_ledger_entry"
        ),
        schema="tournament",
    )
    op.create_index(
        "ix_encounter_pick_ban_ledger_encounter_id",
        "encounter_pick_ban_ledger",
        ["encounter_id"],
        schema="tournament",
    )
    op.create_index(
        "ix_encounter_pick_ban_ledger_item_id", "encounter_pick_ban_ledger", ["item_id"], schema="tournament"
    )

    # ── encounter_map_report ─────────────────────────────────────────────────
    op.create_table(
        "encounter_map_report",
        *_TIMESTAMP_COLUMNS,
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("reporter_user_id", sa.BigInteger(), nullable=True),
        sa.Column("home_score", sa.Integer(), nullable=False),
        sa.Column("away_score", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("encounter_id", "map_id", "team_id", name="uq_encounter_map_report_encounter_map_team"),
        sa.CheckConstraint("home_score >= 0 AND away_score >= 0", name="ck_encounter_map_report_scores"),
        schema="tournament",
    )
    op.create_index(
        "ix_encounter_map_report_encounter_id", "encounter_map_report", ["encounter_id"], schema="tournament"
    )
    op.create_index("ix_encounter_map_report_map_id", "encounter_map_report", ["map_id"], schema="tournament")
    op.create_index("ix_encounter_map_report_team_id", "encounter_map_report", ["team_id"], schema="tournament")

    # ── matches.match: source discriminator + relaxed log-only columns ──────
    op.add_column(
        "match",
        sa.Column("source", _MATCH_SOURCE_ENUM, nullable=False, server_default="log_parser"),
        schema="matches",
    )
    op.alter_column("match", "time", schema="matches", existing_type=sa.Float(), nullable=True)
    op.alter_column("match", "log_name", schema="matches", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    op.alter_column("match", "log_name", schema="matches", existing_type=sa.String(), nullable=False)
    op.alter_column("match", "time", schema="matches", existing_type=sa.Float(), nullable=False)
    op.drop_column("match", "source", schema="matches")

    op.drop_table("encounter_map_report", schema="tournament")
    op.drop_table("encounter_pick_ban_ledger", schema="tournament")
    op.drop_table("pick_ban_entry", schema="tournament")
    op.drop_table("pick_ban_session", schema="tournament")
    op.drop_table("pick_ban_config_slot_item", schema="tournament")
    op.drop_table("pick_ban_config_slot", schema="tournament")
    op.drop_table("pick_ban_config_item", schema="tournament")
    op.drop_table("pick_ban_config", schema="tournament")

    op.execute("DROP TYPE IF EXISTS matches.matchsource")
    op.execute("DROP TYPE IF EXISTS tournament.pickbanseedsource")
    op.execute("DROP TYPE IF EXISTS tournament.pickbansessionstatus")
    op.execute("DROP TYPE IF EXISTS tournament.pickbanentrystatus")
    op.execute("DROP TYPE IF EXISTS tournament.pickbanside")
    op.execute("DROP TYPE IF EXISTS tournament.pickbannorepeatscope")
    op.execute("DROP TYPE IF EXISTS tournament.pickbanrotation")
    op.execute("DROP TYPE IF EXISTS tournament.pickbanfirstpickrule")
    op.execute("DROP TYPE IF EXISTS tournament.pickbanmode")
    op.execute("DROP TYPE IF EXISTS tournament.pickbankind")
