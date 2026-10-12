"""The operator's ``enclayer01_preflight.sql`` is the revision's own pre-flight.

An operator runs the SQL file days before the deploy window; the revision runs
``PREFLIGHT`` and ``GUARDS`` as its first act. If the two drift, a clean file
no longer promises a revision that passes -- so they are compared, query for
query, here.
"""

from __future__ import annotations

import importlib.util
import pathlib
import re

_BACKEND = pathlib.Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "enclayer01", _BACKEND / "migrations" / "versions" / "enclayer01_encounter_layer.py"
)
assert _spec is not None and _spec.loader is not None
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

_SQL = (_BACKEND / "scripts" / "enclayer01_preflight.sql").read_text(encoding="utf-8")


def _squash(sql: str) -> str:
    return " ".join(sql.split())


def _file_checks() -> list[tuple[str, str]]:
    checks = []
    for _number, question, body in re.findall(
        r"^\\echo '(\d+)\. ([^\n]*)'\n(.*?);\n(?=\n\\echo|\Z)", _SQL, re.M | re.S
    ):
        checks.append((question, _squash(body)))
    return checks


def test_the_sql_file_runs_exactly_the_revisions_checks() -> None:
    expected = [(question, _squash(sql)) for question, sql in (*mod.PREFLIGHT, *mod.GUARDS)]

    assert _file_checks() == expected


def test_the_sql_file_header_counts_its_queries() -> None:
    assert f"these same {len(mod.PREFLIGHT) + len(mod.GUARDS)} queries" in " ".join(
        line.removeprefix("--").strip() for line in _SQL.splitlines() if line.startswith("--")
    )
