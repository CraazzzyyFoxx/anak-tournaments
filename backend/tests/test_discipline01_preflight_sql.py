"""The operator's ``discipline01_preflight.sql`` is the revision's own pre-flight, query for query."""

from __future__ import annotations

import importlib.util
import pathlib
import re

_BACKEND = pathlib.Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "discipline01", _BACKEND / "migrations" / "versions" / "discipline01_catalog.py"
)
assert _spec is not None and _spec.loader is not None
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

_SQL = (_BACKEND / "scripts" / "discipline01_preflight.sql").read_text(encoding="utf-8")


def _squash(sql: str) -> str:
    return " ".join(sql.split())


def _blocks(prefix: str) -> list[tuple[str, str]]:
    return [
        (question, _squash(body))
        for question, body in re.findall(rf"^\\echo '{prefix}([^\n]*)'\n(.*?);\n(?=\n\\echo|\Z)", _SQL, re.M | re.S)
    ]


def test_the_sql_file_runs_exactly_the_revisions_stop_checks() -> None:
    assert [(q, body) for q, body in _blocks(r"\d+\. ")] == [(q, _squash(sql)) for q, sql in mod.PREFLIGHT]
