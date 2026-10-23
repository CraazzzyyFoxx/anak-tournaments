"""Align the database with the models: index names, redundant indexes, integer FKs.

Revision ID: drift01
Revises: legacy01
Create Date: 2026-10-21 00:00:00.000000

After ``legacy01`` the remaining model/database drift is not legacy storage but
naming and typing left behind by earlier revisions and the ``initial_v6``
baseline (see ``migrations/README``):

* five indexes carry pre-rename names the models no longer produce, plus the
  co-host user index still named after ``balancer.custom_game_co_host``;
* seven single-column indexes duplicate the leading column of an index or
  unique constraint the models declare, so they only cost writes;
* ``draft.player.registration_id`` lost the index its model declares;
* seven FK columns are ``integer`` although their model (and the referenced
  ``id``) is ``bigint``.

Indexes the queries use but the models did not declare (``auth.refresh_token``
``user_id``, ``tournament.tournament`` ``status``, ``division_grid_import_job``
``status``, ``encounter.encounter`` ``scheduled_at`` / ``started_at`` /
``ended_at``) are declared in the models in the same change and stay as they
are. The partial and expression indexes ``initial_v6`` creates on purpose stay
database-only.

``ALTER COLUMN ... TYPE bigint`` rewrites its table under an exclusive lock; all
seven tables are small, and ``lock_timeout`` makes a busy deploy fail fast and
retry instead of queueing readers behind it. The downgrade restores every name,
index and type.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "drift01"
down_revision: str | Sequence[str] | None = "legacy01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: (schema, old name, model name)
RENAMES: tuple[tuple[str, str, str], ...] = (
    ("analytics", "ix_analytics_tournament_player_id", "ix_analytics_player_shift_player_id"),
    ("analytics", "ix_analytics_tournament_tournament_id", "ix_analytics_player_shift_tournament_id"),
    ("stats", "ix_match_ingest_job", "ix_stats_match_ingest_job"),
    ("stats", "ix_match_workspace", "ix_stats_match_workspace"),
    ("stats", "ix_match_player_role", "ix_match_player_observed_role"),
    ("mix", "ix_custom_game_co_host_user_id", "ix_mix_co_host_user_id"),
)

#: (schema, name, table, columns) -- each covered by a model index or unique constraint's leading column(s).
REDUNDANT: tuple[tuple[str, str, str, str], ...] = (
    ("encounter", "ix_tournament_encounter_tournament_id", "encounter", "tournament_id"),
    ("tournament", "ix_encounter_link_source", "encounter_link", "source_encounter_id"),
    ("tournament", "ix_tournament_encounter_link_source_encounter_id", "encounter_link", "source_encounter_id"),
    ("tournament", "ix_encounter_link_target", "encounter_link", "target_encounter_id"),
    ("tournament", "ix_tournament_encounter_link_target_encounter_id", "encounter_link", "target_encounter_id"),
    ("stats", "ix_stat_baseline_version", "stat_baseline", "formula_version"),
    ("registration", "ix_registration_tournament_status", "registration", "tournament_id, status"),
)

#: (schema, table, column) typed ``integer`` in the database, ``BigInteger`` in the model.
BIGINT_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("achievements", "evaluation_result", "encounter_id"),
    ("draft", "player", "registration_id"),
    ("mix", "lobby", "next_map_id"),
    ("registration", "team", "invite_cap_reset_by"),
    ("registration", "team", "roster_locked_by"),
    ("registration", "team", "subscription_covered_by"),
    ("registration", "team_invite", "revoked_by"),
)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '10s'")
    for schema, old, new in RENAMES:
        op.execute(f"ALTER INDEX IF EXISTS {schema}.{old} RENAME TO {new}")
    for schema, name, _table, _columns in REDUNDANT:
        op.execute(f"DROP INDEX IF EXISTS {schema}.{name}")
    op.execute("CREATE INDEX IF NOT EXISTS ix_draft_player_registration_id ON draft.player (registration_id)")
    for schema, table, column in BIGINT_COLUMNS:
        op.execute(f"ALTER TABLE {schema}.{table} ALTER COLUMN {column} TYPE bigint")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '10s'")
    for schema, table, column in BIGINT_COLUMNS:
        op.execute(f"ALTER TABLE {schema}.{table} ALTER COLUMN {column} TYPE integer")
    op.execute("DROP INDEX IF EXISTS draft.ix_draft_player_registration_id")
    for schema, name, table, columns in REDUNDANT:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {schema}.{table} ({columns})")
    for schema, old, new in RENAMES:
        op.execute(f"ALTER INDEX IF EXISTS {schema}.{new} RENAME TO {old}")
