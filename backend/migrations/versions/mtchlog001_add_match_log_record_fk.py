"""link matches.match to the log record that produced it

Revision ID: mtchlog001
Revises: encres0001
Create Date: 2026-08-03 00:00:00.000000

``matches.match`` and ``log_processing.record`` had no relationship at all. The
only bridge was comparing ``match.log_name`` to ``record.filename`` — two
unindexed, non-unique columns that are not even normalised the same way:
``log_name`` is always a basename (the processor takes ``filename.split("/")[-1]``)
while ``filename`` is stored verbatim, and the tournament-wide S3 sweep feeds it
full keys (``logs/<tournament_id>/<name>``). That join is unsound in both
directions, which is why the log-download endpoint defensively re-basenames.

This adds the explicit link and backfills it. Deliberately NOT included: any
rewrite of ``record.filename``. Record identity is ``(tournament_id, filename)``
and the stall reaper's per-row ``attempts`` budget hangs off it — normalising
stored names would merge two rows that are today independent lifecycles. With
the FK in place the string comparison is no longer load-bearing, so the two
forms can be reconciled later, separately, if it is ever worth it.

The backfill is a best-effort match on ``(tournament_id, basename)`` with a
deterministic tiebreak: prefer a ``done`` record, then the newest. Rows it
cannot resolve stay NULL and are counted, not guessed at — that count is the
honest size of the un-attributable set.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from loguru import logger

revision: str = "mtchlog001"
down_revision: str | Sequence[str] | None = "encres0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FK = "fk_match_log_record"
_INDEX = "ix_matches_match_log_record_id"


def upgrade() -> None:
    op.add_column("match", sa.Column("log_record_id", sa.BigInteger(), nullable=True), schema="matches")
    op.create_index(_INDEX, "match", ["log_record_id"], schema="matches")
    op.create_foreign_key(
        _FK,
        "match",
        "record",
        ["log_record_id"],
        ["id"],
        source_schema="matches",
        referent_schema="log_processing",
        ondelete="SET NULL",
    )

    # basename on BOTH sides: log_name is already bare, record.filename may carry
    # the S3 key prefix depending on which path created it.
    #
    # Picked with DISTINCT ON rather than a LATERAL in the UPDATE's FROM: Postgres
    # will not let a lateral subquery reference the update target, so the obvious
    # per-row phrasing does not parse. The CTE keeps the same tie-break — a record
    # that finished processing wins, then the newest — and touches only the rows
    # that actually resolve.
    op.execute(
        """
        WITH pick AS (
            SELECT DISTINCT ON (m.id)
                   m.id AS match_id,
                   r.id AS record_id
            FROM matches.match AS m
            JOIN tournament.encounter AS e ON e.id = m.encounter_id
            JOIN log_processing.record AS r
              ON r.tournament_id = e.tournament_id
             AND regexp_replace(r.filename, '^.*/', '') = regexp_replace(m.log_name, '^.*/', '')
            WHERE m.log_record_id IS NULL
            ORDER BY m.id, (r.status = 'done') DESC, r.created_at DESC, r.id DESC
        )
        UPDATE matches.match AS m
        SET log_record_id = pick.record_id
        FROM pick
        WHERE pick.match_id = m.id
        """
    )

    bind = op.get_bind()
    unresolved = bind.execute(sa.text("SELECT count(*) FROM matches.match WHERE log_record_id IS NULL")).scalar_one()
    total = bind.execute(sa.text("SELECT count(*) FROM matches.match")).scalar_one()
    # Not an error: matches predating the ingestion table, logs deleted by the
    # parser on a validation failure, and admin-rewritten log_name values all
    # land here legitimately. The admin UI shows "provenance unresolved" for them.
    logger.info("mtchlog001: {}/{} match rows have no resolvable log record", unresolved, total)


def downgrade() -> None:
    op.drop_constraint(_FK, "match", schema="matches", type_="foreignkey")
    op.drop_index(_INDEX, "match", schema="matches")
    op.drop_column("match", "log_record_id", schema="matches")
