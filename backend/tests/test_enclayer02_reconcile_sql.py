"""``enclayer02`` refuses its drop on the operator's reconcile view -- the same view, text for text."""

from __future__ import annotations

import importlib.util
import pathlib
import re

_BACKEND = pathlib.Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "enclayer02", _BACKEND / "migrations" / "versions" / "enclayer02_drop_legacy.py"
)
assert _spec is not None and _spec.loader is not None
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

_SQL = (_BACKEND / "scripts" / "enclayer01_reconcile.sql").read_text(encoding="utf-8")


def _squash(sql: str) -> str:
    return " ".join(sql.split())


def _file_view() -> str:
    text = "\n".join(
        line for line in _SQL.splitlines() if not line.startswith("\\") and not line.lstrip().startswith("--")
    )
    return next(part for part in re.split(r";\s*\n", text + "\n") if part.strip().startswith("CREATE TEMP VIEW"))


def test_the_gate_reads_the_operators_reconcile_view_verbatim() -> None:
    assert _squash(mod.RECONCILE_VIEW) == _squash(_file_view())
