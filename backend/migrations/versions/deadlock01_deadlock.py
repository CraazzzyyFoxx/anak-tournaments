"""Deadlock: its ``catalog.discipline`` row, its rank collector's settings, and ``stats.match_fetch``.

Revision ID: deadlock01
Revises: drift01
Create Date: 2026-10-21 00:00:00.000000

``stats.match_fetch`` is the generic pending state of "import this match by its external id": stats core retries a row
until the discipline's producer serves the match, then stores the bytes like an upload and creates the normal ingest
job. The Deadlock rank collector's ``Settings`` row is seeded on (it needs no credentials); ``rate_limit_per_minute`` is
left out so the collector derives it from whether ``DEADLOCK_API_KEY`` is set.

The downgrade removes the discipline row too, which a database that already holds Deadlock data refuses (foreign keys):
that data is never dropped silently.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "deadlock01"
down_revision: str | Sequence[str] | None = "drift01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SETTINGS_KEY = "deadlock.rank_collection"
DEFAULTS = {
    "enabled": True,
    "interval_seconds": 21600,
    "batch_size": 1000,
    "scope": "all",
    "auto_pace": True,
    "jitter_fraction": 0.15,
    "max_per_tick": None,
    "extra_accounts_per_registration": 0,
    "max_consecutive_failures": 5,
    "backoff_base_seconds": 60,
}


def upgrade() -> None:
    op.execute(
        "INSERT INTO catalog.discipline (code, name) VALUES ('deadlock', 'Deadlock') ON CONFLICT (code) DO NOTHING"
    )
    op.get_bind().execute(
        sa.text(
            "INSERT INTO settings (key, value) VALUES (:key, CAST(:value AS json)) ON CONFLICT (key) DO NOTHING"
        ).bindparams(key=SETTINGS_KEY, value=json.dumps(DEFAULTS))
    )
    op.create_table(
        "match_fetch",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "workspace_id",
            sa.BigInteger(),
            sa.ForeignKey("workspace.id", name="fk_match_fetch_workspace", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "discipline",
            sa.String(32),
            sa.ForeignKey("catalog.discipline.code", name="fk_match_fetch_discipline"),
            nullable=False,
        ),
        sa.Column("source_kind", sa.String(32), nullable=False),
        sa.Column("external_id", sa.String(128), nullable=False),
        sa.Column(
            "hint_tournament_id",
            sa.BigInteger(),
            sa.ForeignKey("tournament.tournament.id", name="fk_match_fetch_tournament", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hint_encounter_id",
            sa.BigInteger(),
            sa.ForeignKey("encounter.encounter.id", name="fk_match_fetch_encounter", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hint_encounter_game_id",
            sa.BigInteger(),
            sa.ForeignKey("encounter.game.id", name="fk_match_fetch_game", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("auth.user.id", name="fk_match_fetch_requested_by", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "done",
                "failed",
                native_enum=False,
                create_constraint=True,
                name="ck_match_fetch_status",
                length=16,
            ),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "ingest_job_id",
            sa.BigInteger(),
            sa.ForeignKey("stats.ingest_job.id", name="fk_match_fetch_ingest_job", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("source_kind", "external_id", "hint_encounter_game_id", name="uq_match_fetch_game"),
        schema="stats",
    )
    op.create_index("ix_match_fetch_due", "match_fetch", ["status", "next_attempt_at"], schema="stats")
    op.create_index(
        "ix_match_fetch_workspace_external",
        "match_fetch",
        ["workspace_id", "source_kind", "external_id"],
        schema="stats",
    )


def downgrade() -> None:
    op.drop_table("match_fetch", schema="stats")
    op.get_bind().execute(sa.text("DELETE FROM settings WHERE key = :key").bindparams(key=SETTINGS_KEY))
    op.execute("DELETE FROM catalog.discipline WHERE code = 'deadlock'")
