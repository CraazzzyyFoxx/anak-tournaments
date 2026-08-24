"""Admin and draft schemas are reachable only through the top-level facade
``from src import schemas``.

``src/schemas/__init__.py`` explicitly imports every name from ``admin/balancer.py``
and every name from ``draft.py`` (a first-class, non-admin schemas module that was
simply never wired into the facade before) into the same top-level namespace as
``balancer.py``/``team.py``, so ``schemas.DraftBoardSnapshot`` and
``schemas.BalanceRead`` resolve through the exact same import. Importing
``src.schemas.admin`` or ``src.schemas.draft`` directly anywhere outside the
schemas package itself reintroduces a second, narrower ``schemas``-shaped name
and is banned.
"""

from __future__ import annotations

import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]

_BANNED_RE = re.compile(r"schemas\.(admin|draft)\b")


def _iter_python_files() -> list[Path]:
    return sorted((SERVICE_ROOT / "src").rglob("*.py")) + sorted((SERVICE_ROOT / "tests").rglob("*.py"))


def test_admin_and_draft_schemas_are_reached_through_the_top_level_facade() -> None:
    offenders = [
        relative
        for path in _iter_python_files()
        if (relative := str(path.relative_to(SERVICE_ROOT)).replace("\\", "/"))
        != "tests/test_admin_schema_import_alias.py"
        and _BANNED_RE.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == [], (
        "Import admin/draft schemas through 'from src import schemas' (schemas.X), never "
        f"src.schemas.admin or src.schemas.draft directly: {offenders}"
    )
