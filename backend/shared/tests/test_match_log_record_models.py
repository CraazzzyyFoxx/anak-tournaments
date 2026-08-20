"""Pin the match -> log-record link against model drift.

The link exists because the two tables had no relationship: the only bridge was
comparing ``match.log_name`` to ``record.filename``, which are normalised
differently (the parser basenames one, the S3 sweep feeds full keys into the
other) and are both unindexed and non-unique. ``match.log_record_id`` carries the
provenance now, and ``log_name`` stays because the S3 key is still built from it.

These tests assert the model side of that shape. The assertions that read the
``mtchlog001`` revision file -- its backfill join, its ORDER BY tiebreak, its
refusal to rewrite stored filenames -- went away with the ``initial_v6`` squash,
which replaced every per-revision file with one generated baseline.
"""

from __future__ import annotations

from shared import models


class TestColumn:
    def test_model_has_a_nullable_indexed_fk(self):
        """Nullable on purpose: matches predating ingestion, logs the parser
        deleted on a validation failure, and admin-rewritten log_name values
        cannot be resolved, and the backfill leaves those alone."""
        column = models.Match.__table__.c.log_record_id
        assert column.nullable is True
        assert {index.name for index in models.Match.__table__.indexes} >= {"ix_matches_match_log_record_id"}

    def test_log_name_is_kept(self):
        """The S3 key is still built from it; the FK carries provenance, not the
        object location."""
        assert "log_name" in models.Match.__table__.columns
