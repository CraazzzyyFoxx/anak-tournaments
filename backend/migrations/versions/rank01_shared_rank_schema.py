"""One rank schema for every game: ``overwatch_rank`` -> ``rank``, a ``discipline`` on every row, LoL's columns.

Revision ID: rank01
Revises: quota0003
Create Date: 2026-10-21 00:00:00.000000

``battle_tag_state`` becomes ``account_state`` (one collection state per game account, whatever the game);
``battle_tag`` becomes ``handle`` and ``player_id_slug`` becomes ``external_id`` (OverFast slug, Riot PUUID). Existing
rows are Overwatch's: ``discipline`` is backfilled ``'overwatch'`` and the server default is dropped, so every writer
names its game. LoL rows carry ``queue`` (``solo``/``flex``), ``lp``, ``wins``, ``losses`` and no ``role``/``platform``.
The LoL collector's ``Settings`` row is seeded with its defaults (collection stays off).
Every division-grid import job's ``request_json`` key ``include_ow_rank_mappings`` becomes
``include_native_rank_mappings`` (the job runner reads only the new key; a failed job is retried from its stored request).
Idempotency keys and source fingerprints hash the value, not this key, and are left alone.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "rank01"
down_revision: str | Sequence[str] | None = "quota0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "rank"
TABLES = ("rank_snapshot", "account_state", "fetch_log")
LOL_SETTINGS_KEY = "lol.rank_collection"
LOL_DEFAULTS = {
    "enabled": False,
    "interval_seconds": 21600,
    "batch_size": 50,
    "rate_limit_per_minute": 50,
    "scope": "all",
    "auto_pace": True,
    "jitter_fraction": 0.15,
    "max_per_tick": None,
    "extra_accounts_per_registration": 0,
    "max_consecutive_failures": 5,
    "backoff_base_seconds": 60,
}
LATEST_RANKED_WHERE = sa.text("rank_value IS NOT NULL AND is_ranked IS TRUE")
IMPORT_JOB_KEY_OLD = "include_ow_rank_mappings"
IMPORT_JOB_KEY_NEW = "include_native_rank_mappings"


def rename_import_job_key(old: str, new: str) -> None:
    """Rename one top-level key of every ``division_grid_import_job.request_json`` that has it, keeping its value."""
    op.get_bind().execute(
        sa.text(
            """
            UPDATE division_grid_import_job
            SET request_json = CAST(
                (CAST(request_json AS jsonb) - CAST(:old AS text))
                || jsonb_build_object(CAST(:new AS text), CAST(request_json AS jsonb) -> CAST(:old AS text))
                AS json
            )
            WHERE (CAST(request_json AS jsonb) -> CAST(:old AS text)) IS NOT NULL
            """
        ).bindparams(old=old, new=new)
    )


def upgrade() -> None:
    op.execute("ALTER SCHEMA overwatch_rank RENAME TO rank")
    op.rename_table("battle_tag_state", "account_state", schema=SCHEMA)
    for table in TABLES:
        op.alter_column(table, "battle_tag", new_column_name="handle", schema=SCHEMA)
        op.add_column(
            table, sa.Column("discipline", sa.String(32), nullable=False, server_default="overwatch"), schema=SCHEMA
        )
        op.alter_column(table, "discipline", server_default=None, schema=SCHEMA)
    op.alter_column("account_state", "player_id_slug", new_column_name="external_id", nullable=True, schema=SCHEMA)
    op.add_column("account_state", sa.Column("region", sa.String(16), nullable=True), schema=SCHEMA)
    op.add_column("rank_snapshot", sa.Column("queue", sa.String(16), nullable=True), schema=SCHEMA)
    for column in ("lp", "wins", "losses"):
        op.add_column("rank_snapshot", sa.Column(column, sa.Integer(), nullable=True), schema=SCHEMA)
    op.alter_column("rank_snapshot", "role", existing_type=sa.String(16), nullable=True, schema=SCHEMA)
    op.alter_column("rank_snapshot", "platform", existing_type=sa.String(16), nullable=True, schema=SCHEMA)

    op.drop_index("ix_rank_snapshot_series_captured", table_name="rank_snapshot", schema=SCHEMA)
    op.create_index(
        "ix_rank_snapshot_series_captured",
        "rank_snapshot",
        ["social_account_id", "role", "platform", "queue", "captured_at"],
        schema=SCHEMA,
    )
    op.drop_index("ix_rank_snapshot_latest_ranked", table_name="rank_snapshot", schema=SCHEMA)
    op.create_index(
        "ix_rank_snapshot_latest_ranked",
        "rank_snapshot",
        ["social_account_id", "role", "queue", sa.literal_column("captured_at DESC")],
        schema=SCHEMA,
        postgresql_where=LATEST_RANKED_WHERE,
    )
    op.execute(
        "ALTER INDEX rank.ix_overwatch_rank_rank_snapshot_captured_at RENAME TO ix_rank_rank_snapshot_captured_at"
    )
    op.drop_index("ix_battle_tag_state_due", table_name="account_state", schema=SCHEMA)
    op.create_index(
        "ix_account_state_due",
        "account_state",
        ["discipline", "status", "next_eligible_at", "last_checked_at"],
        schema=SCHEMA,
    )
    op.execute("ALTER INDEX rank.ix_battle_tag_state_priority RENAME TO ix_account_state_priority")

    op.get_bind().execute(
        sa.text(
            "INSERT INTO settings (key, value) VALUES (:key, CAST(:value AS json)) ON CONFLICT (key) DO NOTHING"
        ).bindparams(key=LOL_SETTINGS_KEY, value=json.dumps(LOL_DEFAULTS))
    )
    rename_import_job_key(IMPORT_JOB_KEY_OLD, IMPORT_JOB_KEY_NEW)


def downgrade() -> None:
    rename_import_job_key(IMPORT_JOB_KEY_NEW, IMPORT_JOB_KEY_OLD)
    op.get_bind().execute(sa.text("DELETE FROM settings WHERE key = :key").bindparams(key=LOL_SETTINGS_KEY))
    op.get_bind().execute(sa.text("DELETE FROM rank.rank_snapshot WHERE discipline <> 'overwatch'"))
    op.get_bind().execute(sa.text("DELETE FROM rank.fetch_log WHERE discipline <> 'overwatch'"))
    op.get_bind().execute(sa.text("DELETE FROM rank.account_state WHERE discipline <> 'overwatch'"))
    op.execute("ALTER INDEX rank.ix_account_state_priority RENAME TO ix_battle_tag_state_priority")
    op.drop_index("ix_account_state_due", table_name="account_state", schema=SCHEMA)
    op.create_index(
        "ix_battle_tag_state_due", "account_state", ["status", "next_eligible_at", "last_checked_at"], schema=SCHEMA
    )
    op.execute(
        "ALTER INDEX rank.ix_rank_rank_snapshot_captured_at RENAME TO ix_overwatch_rank_rank_snapshot_captured_at"
    )
    op.drop_index("ix_rank_snapshot_latest_ranked", table_name="rank_snapshot", schema=SCHEMA)
    op.create_index(
        "ix_rank_snapshot_latest_ranked",
        "rank_snapshot",
        ["social_account_id", "role", sa.literal_column("captured_at DESC")],
        schema=SCHEMA,
        postgresql_where=LATEST_RANKED_WHERE,
    )
    op.drop_index("ix_rank_snapshot_series_captured", table_name="rank_snapshot", schema=SCHEMA)
    op.create_index(
        "ix_rank_snapshot_series_captured",
        "rank_snapshot",
        ["social_account_id", "role", "platform", "captured_at"],
        schema=SCHEMA,
    )
    op.alter_column("rank_snapshot", "platform", existing_type=sa.String(16), nullable=False, schema=SCHEMA)
    op.alter_column("rank_snapshot", "role", existing_type=sa.String(16), nullable=False, schema=SCHEMA)
    for column in ("losses", "wins", "lp", "queue"):
        op.drop_column("rank_snapshot", column, schema=SCHEMA)
    op.drop_column("account_state", "region", schema=SCHEMA)
    op.execute("UPDATE rank.account_state SET external_id = replace(handle, '#', '-') WHERE external_id IS NULL")
    op.alter_column("account_state", "external_id", new_column_name="player_id_slug", nullable=False, schema=SCHEMA)
    for table in TABLES:
        op.drop_column(table, "discipline", schema=SCHEMA)
        op.alter_column(table, "handle", new_column_name="battle_tag", schema=SCHEMA)
    op.rename_table("account_state", "battle_tag_state", schema=SCHEMA)
    op.execute("ALTER SCHEMA rank RENAME TO overwatch_rank")
