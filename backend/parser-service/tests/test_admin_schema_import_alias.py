"""Live admin schemas are reachable only through the top-level facade
``from src import schemas``.

``src/schemas/__init__.py`` flattens the six admin submodules that have real
consumers (``achievement_rule``, ``discord_channel``, ``logs``,
``rank_collection``, ``settings``, ``subscription_collection``) onto the
top-level facade, so e.g. ``schemas.DiscordChannelRead`` resolves through the
same import as any public schema. Importing ``src.schemas.admin`` (or one of
those six submodules) directly anywhere outside the schemas package itself
reintroduces a second, narrower ``schemas``-shaped name and is banned.

``src/schemas/admin/{encounter,tournament,stage,standing,player_sub_role}.py``
are a separate matter: confirmed dead code (zero consumers anywhere in this
service, most likely leftover from before tournament/encounter/stage CRUD
moved to tournament-service). They were deliberately left unflattened and are
exempt from this check -- flattening dead code would be pointless, and this
test is about the *reachability* convention, not about deciding their fate.
"""

from __future__ import annotations

import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]

_BANNED_RE = re.compile(r"schemas\.admin\b")

#: Dead admin submodules, exempt because they are not wired into the facade at
#: all (see module docstring). Their own definitions/`__all__` naturally match
#: the "schemas.admin" substring; that is not a violation of the reachability
#: rule, it is just where they still live.
_EXEMPT = {
    "src/schemas/admin/encounter.py",
    "src/schemas/admin/tournament.py",
    "src/schemas/admin/stage.py",
    "src/schemas/admin/standing.py",
    "src/schemas/admin/player_sub_role.py",
    "src/schemas/admin/__init__.py",
}


def _iter_python_files() -> list[Path]:
    return sorted((SERVICE_ROOT / "src").rglob("*.py")) + sorted((SERVICE_ROOT / "tests").rglob("*.py"))


def test_live_admin_schemas_are_reached_through_the_top_level_facade() -> None:
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
