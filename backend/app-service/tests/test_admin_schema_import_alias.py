"""Admin schemas are reachable only through the top-level facade ``from src import schemas``.

``src/schemas/__init__.py`` flattens every admin submodule onto the facade too
(``from .admin.user import *``, etc., alongside the public domains), so
``schemas.UserCreate`` and ``schemas.UserRead`` resolve through the exact same
import -- there is no second, narrower ``schemas``-shaped name to keep straight.
Importing ``src.schemas.admin`` (or any of its submodules) directly anywhere
outside the schemas package itself re-introduces that second name and is
banned.

``admin/user.py``'s update schema is named ``UserAdminUpdate`` -- not
``UserUpdate`` -- specifically because the facade already carries an unrelated
``schemas.UserUpdate`` (``user_base.py``); flattening a second ``UserUpdate``
would have silently shadowed one of the two. Nothing in this repo needs a
same-named second admin schema, but if one ever collides, disambiguate the
*admin* class's name (matching this precedent) rather than reintroducing a
private import path.

No file is currently exempt: unlike ``tournament-service``, app-service's
``admin/`` submodules are never imported by another ``schemas/`` file
internally.
"""

from __future__ import annotations

import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]

_BANNED_RE = re.compile(r"schemas\.admin\b")


def _iter_python_files() -> list[Path]:
    return sorted((SERVICE_ROOT / "src").rglob("*.py")) + sorted((SERVICE_ROOT / "tests").rglob("*.py"))


def test_admin_schemas_are_reached_through_the_top_level_facade() -> None:
    offenders = [
        relative
        for path in _iter_python_files()
        if (relative := str(path.relative_to(SERVICE_ROOT)).replace("\\", "/"))
        != "tests/test_admin_schema_import_alias.py"
        and _BANNED_RE.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == [], (
        "Import admin schemas through 'from src import schemas' (schemas.X), never "
        f"src.schemas.admin directly: {offenders}"
    )
