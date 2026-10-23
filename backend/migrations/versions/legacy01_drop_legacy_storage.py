"""Drop every migration-only leftover: the storage the cutovers kept for their reconciles, and nothing else.

Revision ID: legacy01
Revises: rank01
Create Date: 2026-10-21 00:00:00.000000

The cutovers (``stats01``, ``discipline01``/``01b``/``01c``, ``mixround01``, ``enclayer01``, ``bsplit01``,
``regident01``) copied the old storage into the native shape and kept the old copy, unmapped, only for their
pre-flight/reconcile tooling. This drops all of it: the ``matches``, ``log_processing``, ``overwatch`` and ``casual``
schemas, the leftover tables in live schemas, the unmapped legacy columns (``registration.registration``'s Battle.net
columns with them), and the enum types only that storage used. It supersedes the planned ``discipline02``,
``mixround02`` and P9 drops and the ``enclayer02``/``bsplit02`` flags; every statement is ``IF EXISTS`` because a
database where those flags ran already lacks some of it.

GATED, fail-closed (CONTRIBUTING.md, "Destructive migrations are gated") -- but never a no-op stamp: when every legacy
table is empty (fresh and CI databases) it drops; when one still holds a row it raises, so nothing is dropped and the
revision is not stamped, unless ``OWT_APPLY_LEGACY_DROP=1`` is set. Run the cutover reconciles before setting it:
``docs/releases/2026-10-21-backend-cleanup.md``, "Legacy storage drop (legacy01)".
"""

from __future__ import annotations

import os
import time
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.exc import OperationalError

revision: str = "legacy01"
down_revision: str | Sequence[str] | None = "rank01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FLAG = "OWT_APPLY_LEGACY_DROP"
RUNBOOK = 'docs/releases/2026-10-21-backend-cleanup.md, "Legacy storage drop (legacy01)"'
RETRYABLE_SQLSTATES = frozenset({"55P03", "40P01"})
LOCK_TIMEOUT = "3s"
LOCK_ATTEMPTS = 40
LOCK_BACKOFF_SECONDS = 6.0

#: Whole schemas; nothing live points into them (no foreign key, view or column type).
_SCHEMAS = ("matches", "log_processing", "overwatch", "casual")
#: Leftovers in live schemas; nothing live points into them either, so no CASCADE.
_TABLES = (
    "catalog.entity_legacy",
    "roster.team_format_legacy",
    "encounter.team_member_role_legacy",
    "balancer.discipline01c_dropped_ranks",
    "tournament.encounter_map_code",
    "tournament.encounter_map_report",
    "tournament.encounter_captain_report",
    "tournament.encounter_game_result",
    "tournament.encounter_participant",
    "tournament.encounter_readiness",
    "tournament.player_sub_role",
)
#: No model maps any of these; their single-column indexes, foreign keys and checks go with them, as do the
#: multi-column ones no model declares either (``uq_registration_tournament_tag_active``,
#: ``uq_encounter_link_source_role``, ``uq_pick_ban_submission_step_side_attempt``, ``ix_encounter_stage_item_round``,
#: ``ix_player_tournament_role_sub_role``).
_COLUMNS = (
    ("public.workspace", ("default_division_grid_version_id", "default_roster_slots_json")),
    ("analytics.ml_model_artifact", ("role",)),
    ("balancer.member_hidden_rating", ("role",)),
    ("balancer.member_rank", ("role",)),
    ("balancer.team_slot", ("role",)),
    ("balancer.user_config", ("role_slots_json",)),
    ("draft.pick", ("target_role",)),
    ("draft.player", ("captain_role",)),
    (
        "encounter.encounter",
        ("format", "home_team_id", "away_team_id", "home_score", "away_score", "stage_id", "stage_item_id", "round"),
    ),
    ("encounter.game", ("format", "accepted_home_score", "accepted_away_score")),
    ("encounter.pick_ban_entry", ("picked_by", "protected_by", "team_id")),
    (
        "encounter.pick_ban_session",
        ("first_side", "pending_loser_side", "undo_requested_by", "home_seed", "away_seed", "config_id"),
    ),
    ("encounter.pick_ban_submission", ("side",)),
    (
        "encounter.result_audit",
        ("home_score_before", "away_score_before", "home_score_after", "away_score_after", "ffa_results_json"),
    ),
    ("encounter.room_event", ("side",)),
    ("mix.player_role", ("role",)),
    ("registration.registration", ("battle_tag", "battle_tag_normalized", "smurf_tags_json")),
    ("registration.role", ("role", "subrole")),
    ("tournament.encounter_link", ("role", "legacy_target_slot")),
    ("tournament.player", ("role", "sub_role")),
    ("tournament.stage", ("ffa_placement_points", "ffa_columns", "ffa_formula", "split_lower_bracket")),
    ("tournament.tournament", ("roster_slots_json",)),
)
#: Typed only the storage above; no CASCADE, so a live user of one fails the revision instead of losing a column.
_TYPES = (
    "public.abilityevent",
    "public.catalogentitytype",
    "public.heroclass",
    "public.log_processing_source",
    "public.log_processing_status",
    "public.logstatsname",
    "public.matchevent",
    "tournament.encounterlinkrole",
    "tournament.encounterlinkslot",
    "tournament.pickbanside",
    # Typed no column at all (left over from map veto).
    "tournament.firstbanrotation",
    "tournament.firstpickrule",
    "tournament.mappickside",
    "tournament.mappoolentrystatus",
    "tournament.mapvetomode",
    "tournament.mapvetosessionstatus",
    "tournament.vetoseedsource",
)


def _legacy_tables(bind: sa.Connection) -> list[str]:
    in_schemas = bind.execute(
        sa.text(
            "SELECT format('%I.%I', n.nspname, c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
            " WHERE n.nspname = ANY(:schemas) AND c.relkind IN ('r', 'p') ORDER BY 1"
        ),
        {"schemas": list(_SCHEMAS)},
    ).scalars()
    present = [t for t in _TABLES if bind.scalar(sa.text("SELECT to_regclass(:t) IS NOT NULL"), {"t": t})]
    return [*in_schemas, *present]


def _take_locks(bind: sa.Connection) -> None:
    """Lock every altered live table first, retrying past busy readers (``bsplit02``)."""
    tables = ", ".join(table for table, _columns in _COLUMNS)
    bind.execute(sa.text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
    for attempt in range(1, LOCK_ATTEMPTS + 1):
        savepoint = bind.begin_nested()
        try:
            bind.execute(sa.text(f"LOCK TABLE {tables} IN ACCESS EXCLUSIVE MODE"))
        except OperationalError as exc:
            savepoint.rollback()
            if getattr(exc.orig, "sqlstate", None) not in RETRYABLE_SQLSTATES or attempt == LOCK_ATTEMPTS:
                raise
            time.sleep(LOCK_BACKOFF_SECONDS)
        else:
            savepoint.commit()
            return


def upgrade() -> None:
    bind = op.get_bind()
    holding = [t for t in _legacy_tables(bind) if bind.scalar(sa.text(f"SELECT EXISTS (SELECT 1 FROM {t})"))]
    if holding and os.environ.get(FLAG) != "1":
        raise RuntimeError(
            f"legacy01 refuses the drop: {len(holding)} legacy table(s) still hold rows ({', '.join(holding)}). "
            f"Take a backup, run the cutover pre-flight/reconcile tooling ({RUNBOOK}), "
            f"then re-run with {FLAG}=1. Nothing was dropped and the revision is not stamped."
        )
    _take_locks(bind)
    op.execute(f"DROP SCHEMA IF EXISTS {', '.join(_SCHEMAS)} CASCADE")
    op.execute(f"DROP TABLE IF EXISTS {', '.join(_TABLES)}")
    for table, columns in _COLUMNS:
        op.execute(f"ALTER TABLE {table} " + ", ".join(f"DROP COLUMN IF EXISTS {column}" for column in columns))
    op.execute(f"DROP TYPE IF EXISTS {', '.join(_TYPES)}")


def downgrade() -> None:
    raise RuntimeError("legacy01 is forward-fix only; restore from a backup to go back")
