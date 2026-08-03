"""Guard ``mtchlog001`` — the match → log-record link — against model drift.

The revision exists because the two tables had no relationship: the only bridge
was comparing ``match.log_name`` to ``record.filename``, which are normalised
differently (the parser basenames one, the S3 sweep feeds full keys into the
other) and are both unindexed and non-unique. These tests pin the properties the
migration hard-codes, and the deliberate omission: the revision must NOT rewrite
stored filenames, because record identity is ``(tournament_id, filename)`` and
the stall reaper's per-row ``attempts`` budget hangs off it.

A metadata check, not a substitute for applying the revision — the backfill join
itself needs a real database.
"""

from __future__ import annotations

import pathlib
import re

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models

MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2]
    / "migrations"
    / "versions"
    / "mtchlog001_add_match_log_record_fk.py"
)


def _text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


class TestRevisionWiring:
    def test_migration_is_present(self):
        assert MIGRATION.is_file(), f"missing {MIGRATION}"

    def test_chains_off_the_result_consolidation(self):
        match = re.search(r'^down_revision[^=]*=\s*"([^"]+)"', _text(), re.M)
        assert match, "down_revision must be a single quoted revision id"
        assert match.group(1) == "encres0001"


class TestColumn:
    def test_model_has_a_nullable_indexed_fk(self):
        """Nullable on purpose: matches predating ingestion, logs the parser
        deleted on a validation failure, and admin-rewritten log_name values
        cannot be resolved, and the backfill leaves those alone."""
        column = models.Match.__table__.c.log_record_id
        assert column.nullable is True
        assert {index.name for index in models.Match.__table__.indexes} >= {"ix_matches_match_log_record_id"}

    def test_pruning_ingestion_history_never_deletes_a_played_map(self):
        ddl = str(CreateTable(models.Match.__table__).compile(dialect=postgresql.dialect()))
        assert "FOREIGN KEY(log_record_id) REFERENCES log_processing.record (id) ON DELETE SET NULL" in ddl
        assert 'ondelete="SET NULL"' in _text()

    def test_log_name_is_kept(self):
        """The S3 key is still built from it; the FK carries provenance, not the
        object location."""
        assert "log_name" in models.Match.__table__.columns


class TestBackfill:
    def test_joins_on_basenames_from_both_sides(self):
        """log_name is always bare; record.filename may carry the logs/<id>/
        prefix depending on which path created it."""
        text = _text()
        assert text.count("regexp_replace") >= 2
        assert "regexp_replace(r.filename, '^.*/', '') = regexp_replace(m.log_name, '^.*/', '')" in text

    def test_tiebreak_is_deterministic(self):
        """Duplicate records for one filename are expected — upsert_log_record
        reuses only pending/failed rows — so the pick must not depend on plan
        order.

        Asserted as an ordered sequence of ranking keys rather than one literal
        ORDER BY line: DISTINCT ON has to lead with the partition column, so the
        exact prefix depends on phrasing while the ranking must not.
        """
        order_by = re.search(r"ORDER BY([^\n]*)", _text())
        assert order_by, "the pick has no ORDER BY, so duplicates resolve arbitrarily"
        keys = order_by.group(1)
        ranking = ["r.status = 'done'", "r.created_at DESC", "r.id DESC"]
        positions = [keys.find(k) for k in ranking]
        assert all(p >= 0 for p in positions), f"missing ranking key in: {keys}"
        assert positions == sorted(positions), f"ranking keys out of order in: {keys}"

    def test_scopes_the_match_to_its_own_tournament(self):
        """Filenames are unique only within a tournament; without this the
        backfill would attach a map to another event's log."""
        text = _text()
        assert re.search(r"r\.tournament_id\s*=", text), "record picked without a tournament scope"

    def test_backfill_does_not_lateral_reference_the_update_target(self):
        """Postgres refuses to let a LATERAL subquery in an UPDATE's FROM clause
        reference the row being updated — the natural per-row phrasing does not
        parse at all. Learned the hard way when this first ran against a real
        database; pinned so the readable-looking version does not come back.
        """
        text = _text()
        update_pos = text.find("UPDATE matches.match")
        assert update_pos >= 0
        statement = text[update_pos : text.find('"""', update_pos)]
        assert "LATERAL" not in statement.upper(), (
            "a LATERAL in UPDATE ... FROM cannot see the update target; "
            "precompute the pick in a CTE and join on the primary key"
        )

    def test_unresolved_rows_are_counted_not_guessed(self):
        text = _text()
        assert "log_record_id IS NULL" in text
        assert "logger.info" in text
        assert "raise" not in text, "an unresolvable legacy row must not fail the deploy"


class TestDeliberateOmission:
    def test_does_not_rewrite_stored_filenames(self):
        """Record identity is (tournament_id, filename) and the reaper's attempts
        budget is per row. Normalising stored names would merge two independent
        lifecycles into one — with the FK in place the string comparison is no
        longer load-bearing, so there is nothing to buy for that risk."""
        text = _text()
        assert "UPDATE log_processing.record" not in text
        assert "SET filename" not in text
