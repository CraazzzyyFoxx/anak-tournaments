"""The discipline registry (D83, D99): the only door from core to a discipline module.

``catalog.discipline`` is the row every owner's ``discipline`` column references; a module under this package is the
behaviour behind that code. Core imports names from here and never from ``shared.disciplines.<slug>``
(``backend/.importlinter``, ``backend/tests/test_discipline_module_boundary.py``).
"""

from __future__ import annotations

from shared.disciplines.lol import SPEC as _LOL
from shared.disciplines.overwatch import SPEC as _OVERWATCH
from shared.disciplines.spec import CATALOG_KINDS, DisciplineSpec

__all__ = ("CATALOG_KINDS", "DISCIPLINES", "DisciplineSpec", "discipline")

DISCIPLINES: dict[str, DisciplineSpec] = {spec.code: spec for spec in (_OVERWATCH, _LOL)}


def discipline(code: str) -> DisciplineSpec:
    """The spec for ``code``, or a side-less, kind-less stand-in for a code nobody has written behaviour for.

    Unknown is not an error: ``catalog.discipline`` is the authority on which codes exist, and refusing here would take
    down every encounter of it."""
    return DISCIPLINES.get(code) or DisciplineSpec(code, code, ())
