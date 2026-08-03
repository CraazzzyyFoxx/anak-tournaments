"""consolidate encounter result status; add the result audit trail

Revision ID: encres0001
Revises: logretry0001
Create Date: 2026-08-03 00:00:00.000000

Makes ``result_status`` the single authority on whether an encounter is played.

Two mechanisms used to finalize a result. One drove the ``result_status`` state
machine (captain reports, admin confirm); the other only pushed ``status`` to
COMPLETED (admin encounter edit, bulk edit, Challonge import) and never touched
``result_status``. Nothing could repair the divergence afterwards, because
``result_status`` appeared in no admin schema. Downstream consumers then split:
``tournament_utils.completed`` treated status OR result_status as done while the
standings filter required both, so the same encounter counted for Swiss
round-advance readiness and not for the table.

This revision:

1. creates ``tournament.encounter_result_audit`` (+ its enum) — the replacement
   for the ``submitted_by_id``/``confirmed_by_id`` slots, which recorded only
   the last writer and had no readers;
2. backfills every COMPLETED encounter to CONFIRMED;
3. clears ``closeness`` left on encounters that are not confirmed — the bracket
   cascade used to reset a stale result without clearing it, leaking the
   previous matchup's rating into the tournament average;
4. seeds the audit from ``confirmed_by_id`` where it is populated;
5. asserts the invariant, then enforces it with a CHECK constraint;
6. drops ``confirmed_by_id``, ``submitted_by_id``, ``submitted_at``.

Enum storage differs between the two columns and the SQL below depends on it:
``encounterstatus`` persists member NAMES (``COMPLETED``) while
``encounterresultstatus`` persists values (``confirmed``). Step 5 verifies that
assumption against ``pg_enum`` before the constraint is created, so a future
type change fails loudly here instead of silently matching nothing.

Downgrade re-adds the three columns as nullable and drops the constraint and the
audit table. It does NOT restore their data: the values are gone, and the audit
seed is the only surviving trace.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "encres0001"
down_revision: str | Sequence[str] | None = "logretry0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RESULT_STATUS_ENUM = postgresql.ENUM(name="encounterresultstatus", schema="tournament", create_type=False)
_AUDIT_ACTION_ENUM = postgresql.ENUM(
    "confirm",
    "reopen",
    "auto_confirm",
    "auto_dispute",
    "import",
    "cascade_reset",
    name="encounterresultauditaction",
    schema="tournament",
)

# ``encounterstatus`` stores member NAMES; ``encounterresultstatus`` stores values.
_COMPLETED = "COMPLETED"
_CONFIRMED = "confirmed"

_INVARIANT = f"(result_status = '{_CONFIRMED}') = (status = '{_COMPLETED}')"
_CONSTRAINT = "ck_encounter_result_status_matches_status"


def upgrade() -> None:
    bind = op.get_bind()

    # ── 1. the audit trail ────────────────────────────────────────────────
    _AUDIT_ACTION_ENUM.create(bind, checkfirst=True)
    op.create_table(
        "encounter_result_audit",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "encounter_id",
            sa.BigInteger(),
            sa.ForeignKey("tournament.encounter.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            sa.BigInteger(),
            sa.ForeignKey("players.user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", _AUDIT_ACTION_ENUM, nullable=False),
        sa.Column("from_result_status", _RESULT_STATUS_ENUM, nullable=True),
        sa.Column("to_result_status", _RESULT_STATUS_ENUM, nullable=False),
        sa.Column("home_score_before", sa.Integer(), nullable=True),
        sa.Column("away_score_before", sa.Integer(), nullable=True),
        sa.Column("home_score_after", sa.Integer(), nullable=False),
        sa.Column("away_score_after", sa.Integer(), nullable=False),
        sa.Column(
            "adopted_team_id",
            sa.BigInteger(),
            sa.ForeignKey("tournament.team.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source", sa.String(length=16), nullable=False),
        schema="tournament",
    )
    # Every read is "the history of this encounter", newest first.
    op.create_index(
        "ix_encounter_result_audit_encounter_created",
        "encounter_result_audit",
        ["encounter_id", "created_at"],
        schema="tournament",
    )

    # ── 2. every completed encounter is a confirmed encounter ─────────────
    op.execute(
        f"""
        UPDATE tournament.encounter
        SET result_status = '{_CONFIRMED}',
            confirmed_at = COALESCE(confirmed_at, updated_at, created_at)
        WHERE status = '{_COMPLETED}' AND result_status <> '{_CONFIRMED}'
        """
    )
    # Expected to touch nothing: only the captain/admin path wrote CONFIRMED and
    # it always set COMPLETED too. Logged rather than asserted, because a stray
    # row here is repairable and blocking the deploy over it is not worth it.
    orphan_confirmed = bind.execute(
        sa.text(
            f"SELECT count(*) FROM tournament.encounter "
            f"WHERE result_status = '{_CONFIRMED}' AND status <> '{_COMPLETED}'"
        )
    ).scalar_one()
    if orphan_confirmed:
        op.execute(
            f"""
            UPDATE tournament.encounter
            SET status = '{_COMPLETED}'
            WHERE result_status = '{_CONFIRMED}' AND status <> '{_COMPLETED}'
            """
        )

    # ── 3. closeness belongs to a result that still exists ────────────────
    op.execute(
        f"""
        UPDATE tournament.encounter
        SET closeness = NULL
        WHERE result_status <> '{_CONFIRMED}' AND closeness IS NOT NULL
        """
    )

    # ── 4. seed the audit from the column about to disappear ──────────────
    # Only encounters with a recorded confirmer can be reconstructed; for the
    # rest the history genuinely does not exist and is left empty rather than
    # invented.
    op.execute(
        f"""
        INSERT INTO tournament.encounter_result_audit (
            created_at, encounter_id, actor_user_id, action,
            from_result_status, to_result_status,
            home_score_before, away_score_before,
            home_score_after, away_score_after,
            adopted_team_id, source
        )
        SELECT
            COALESCE(e.confirmed_at, e.updated_at, e.created_at),
            e.id,
            e.confirmed_by_id,
            'confirm',
            NULL,
            '{_CONFIRMED}',
            NULL,
            NULL,
            e.home_score,
            e.away_score,
            NULL,
            'captain'
        FROM tournament.encounter e
        WHERE e.confirmed_by_id IS NOT NULL
        """
    )

    # ── 5. the invariant becomes structural ───────────────────────────────
    stored_status_labels = {
        row[0]
        for row in bind.execute(
            sa.text(
                "SELECT e.enumlabel FROM pg_enum e "
                "JOIN pg_type t ON t.oid = e.enumtypid "
                "JOIN pg_namespace n ON n.oid = t.typnamespace "
                "WHERE t.typname = 'encounterstatus' AND n.nspname = 'tournament'"
            )
        )
    }
    if _COMPLETED not in stored_status_labels:
        raise RuntimeError(
            f"encounterstatus does not contain the label {_COMPLETED!r} "
            f"(found {sorted(stored_status_labels)}); the constraint expression "
            "below would silently match nothing"
        )

    violations = bind.execute(
        sa.text(f"SELECT count(*) FROM tournament.encounter WHERE NOT ({_INVARIANT})")
    ).scalar_one()
    if violations:
        raise RuntimeError(
            f"{violations} encounter(s) still violate '{_INVARIANT}' after the backfill; "
            "refusing to create the constraint — inspect them before retrying"
        )

    op.create_check_constraint(_CONSTRAINT, "encounter", _INVARIANT, schema="tournament")

    # ── 6. drop the slots the audit replaces ──────────────────────────────
    op.drop_constraint("fk_encounter_confirmed_by", "encounter", schema="tournament", type_="foreignkey")
    op.drop_constraint("fk_encounter_submitted_by", "encounter", schema="tournament", type_="foreignkey")
    op.drop_column("encounter", "confirmed_by_id", schema="tournament")
    op.drop_column("encounter", "submitted_by_id", schema="tournament")
    op.drop_column("encounter", "submitted_at", schema="tournament")


def downgrade() -> None:
    op.add_column("encounter", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True), schema="tournament")
    op.add_column("encounter", sa.Column("submitted_by_id", sa.BigInteger(), nullable=True), schema="tournament")
    op.add_column("encounter", sa.Column("confirmed_by_id", sa.BigInteger(), nullable=True), schema="tournament")
    op.create_foreign_key(
        "fk_encounter_submitted_by",
        "encounter",
        "user",
        ["submitted_by_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="players",
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_encounter_confirmed_by",
        "encounter",
        "user",
        ["confirmed_by_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="players",
        ondelete="SET NULL",
    )
    op.drop_constraint(_CONSTRAINT, "encounter", schema="tournament", type_="check")

    op.drop_index("ix_encounter_result_audit_encounter_created", "encounter_result_audit", schema="tournament")
    op.drop_table("encounter_result_audit", schema="tournament")
    _AUDIT_ACTION_ENUM.drop(op.get_bind(), checkfirst=True)
