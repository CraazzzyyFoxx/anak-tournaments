"""Admin schemas are reachable only through the top-level facade ``from src import schemas``.

``src/schemas/__init__.py`` flattens every admin submodule onto the facade too
(``from .admin.tournament_link import *``, etc., alongside the public domains), so
``schemas.TournamentLinkCreate`` and ``schemas.TeamRead`` resolve through the exact same
import -- there is no second, narrower ``schemas``-shaped name to keep straight. Importing
``src.schemas.admin`` (or any of its submodules) directly anywhere outside the schemas
package itself re-introduces that second name and is banned.

Two files are exempt because they run *inside* the schemas package while it is still being
built and would otherwise import the partially-initialized facade back into itself:
``src/schemas/tournament.py`` and ``src/schemas/admin/matches.py``.
"""

from __future__ import annotations

import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]

_BANNED_RE = re.compile(r"schemas\.admin\b")

_EXEMPT = {
    "src/schemas/tournament.py",
    "src/schemas/admin/matches.py",
}


def _iter_python_files() -> list[Path]:
    return sorted((SERVICE_ROOT / "src").rglob("*.py")) + sorted((SERVICE_ROOT / "tests").rglob("*.py"))


def test_admin_schemas_are_reached_through_the_top_level_facade() -> None:
    offenders = [
        relative
        for path in _iter_python_files()
        if (relative := str(path.relative_to(SERVICE_ROOT)).replace("\\", "/")) not in _EXEMPT
        and relative != "tests/test_admin_schema_import_alias.py"
        and _BANNED_RE.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == [], (
        "Import admin schemas through 'from src import schemas' (schemas.X), never "
        f"src.schemas.admin directly: {offenders}"
    )
