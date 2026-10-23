"""The Overwatch analytics module reached through its one door, the discipline registry.

Tests exercise the concrete features and models the way the service does: ``discipline("overwatch").analytics()``. A
private helper of a moved file is reached as a submodule of that package (``module("models.shift_v2")``).
"""

from __future__ import annotations

import importlib
from types import ModuleType

from shared.disciplines import discipline

exports = discipline("overwatch").analytics()


def module(path: str) -> ModuleType:
    """A submodule of the Overwatch analytics package, e.g. ``features.extractors`` or ``models.shift_v2``."""
    return importlib.import_module(f"{exports.__name__}.{path}")
