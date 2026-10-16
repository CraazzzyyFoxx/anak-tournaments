"""Execute the shipped operator SQL and compare real classifications/results."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from test_stats01_upgrade import (
    CORRUPTIONS,
    REFUSALS,
    classifications,
    mismatches,
    prepare_proof,
    revision,
)

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def operator_results(url, filename):
    """Driver executes the whole script; no SQL text splitting or proof rewrite."""
    engine = sa.create_engine(url)
    try:
        raw = engine.raw_connection()
        try:
            with raw.cursor() as cursor:
                cursor.execute((SCRIPTS / filename).read_text(encoding="utf-8"), prepare=False)
                results = []
                while True:
                    if cursor.description:
                        names = [column.name for column in cursor.description]
                        results.append([dict(zip(names, row, strict=True)) for row in cursor.fetchall()])
                    if not cursor.nextset():
                        break
                return results
        finally:
            raw.close()
    finally:
        engine.dispose()


def test_operator_preflight_accepts_valid_populated_legacy(stats01_legacy_database):
    url, _ = stats01_legacy_database
    summary, details, informational = operator_results(url, "stats01_preflight.sql")
    assert {row["class"] for row in summary} == {name for name, _ in revision.PREFLIGHT}
    assert all(row["offending"] == 0 and row["status"] == "ok" for row in summary)
    assert details == []
    assert {row["class"] for row in informational} == {name for name, _ in revision.COUNTS}


@pytest.mark.parametrize("expected_class,mutation", REFUSALS)
def test_operator_and_revision_return_identical_refusal_classifications(
    stats01_legacy_database, expected_class, mutation
):
    url, ids = stats01_legacy_database
    engine = sa.create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(sa.text(mutation), ids)
        with engine.connect() as conn:
            expected = classifications(conn)
        summary, details, _ = operator_results(url, "stats01_preflight.sql")
        actual = {name: [] for name, _ in revision.PREFLIGHT}
        for row in details:
            actual[row["class"]].append((row["id"], row["reason"]))
        assert actual == {
            name: [tuple(row) for row in rows[: revision.PREFLIGHT_SAMPLE]] for name, rows in expected.items()
        }
        assert {row["class"]: row["offending"] for row in summary} == {
            name: len(rows) for name, rows in expected.items()
        }
        assert actual[expected_class]
    finally:
        engine.dispose()


def test_operator_reconcile_populates_all_classes_including_empty(stats01_database):
    url, _ = stats01_database
    summary, details = operator_results(url, "stats01_reconcile.sql")
    assert {row["class"] for row in summary} == {name for name, _, _ in revision.RECONCILE_CLASSES}
    assert all(row["status"] == "ok" and row["legacy"] == row["migrated"] for row in summary)
    assert details == []


@pytest.mark.parametrize("expected_class,mutation", CORRUPTIONS)
def test_operator_and_revision_return_identical_multiset_mismatches(stats01_database, expected_class, mutation):
    url, ids = stats01_database
    engine = sa.create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(sa.text(mutation), ids)
        with engine.connect() as conn:
            prepare_proof(conn)
            expected_rows = mismatches(conn)
            expected_summary = [dict(row) for row in conn.execute(sa.text(revision.RECONCILE_SUMMARY)).mappings()]
        summary, details = operator_results(url, "stats01_reconcile.sql")

        def canonical(rows):
            return sorted(json.dumps(dict(row), sort_keys=True, default=str) for row in rows)

        assert canonical(summary) == canonical(expected_summary)
        expected_details = [{"class": r[0], "direction": r[1], "row": r[2]} for r in expected_rows[:20]]
        assert canonical(details) == canonical(expected_details)
        assert expected_class in {row["class"] for row in summary if row["status"] == "blocking"}
    finally:
        engine.dispose()
