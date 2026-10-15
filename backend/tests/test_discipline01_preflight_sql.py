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

_spec_b = importlib.util.spec_from_file_location(
    "discipline01b", _BACKEND / "migrations" / "versions" / "discipline01b_roles.py"
)
assert _spec_b is not None and _spec_b.loader is not None
mod_b = importlib.util.module_from_spec(_spec_b)
_spec_b.loader.exec_module(mod_b)

_SQL = (_BACKEND / "scripts" / "discipline01_preflight.sql").read_text(encoding="utf-8")
_RECONCILE = (_BACKEND / "scripts" / "discipline01_reconcile.sql").read_text(encoding="utf-8")


def _squash(sql: str) -> str:
    return " ".join(sql.split())


def _blocks(prefix: str) -> list[tuple[str, str]]:
    return [
        (question, _squash(body))
        for question, body in re.findall(rf"^\\echo '{prefix}([^\n]*)'\n(.*?);\n(?=\n\\echo|\Z)", _SQL, re.M | re.S)
    ]


def test_the_sql_file_runs_exactly_the_revisions_stop_checks() -> None:
    assert [(q, body) for q, body in _blocks(r"\d+\. ")] == [
        (q, _squash(sql)) for q, sql in (*mod.PREFLIGHT, *mod_b.PREFLIGHT)
    ]


def test_the_sql_file_counts_the_pick_ban_ids_the_revision_cannot_map() -> None:
    assert [body for _q, body in _blocks("count: ")] == [
        _squash(mod.DANGLING_PICK_BAN_IDS),
        _squash(mod_b.OFF_CATALOG_SUB_ROLES),
        _squash(mod_b.FLEX_SUB_ROLES),
    ]


def test_the_reconcile_file_defines_the_revisions_leaf_function() -> None:
    assert _squash(mod_b.LEAF_FUNCTION) + ";" in _squash(_RECONCILE)


def test_the_reconcile_file_uses_the_revisions_format_check() -> None:
    assert _squash(mod_b.TEAM_FORMAT_RECONCILE) in _squash(_RECONCILE)
