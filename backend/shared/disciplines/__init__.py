"""The discipline registry (D83, D99): the only door from core to a discipline module.

``catalog.discipline`` is the row every owner's ``discipline`` column references; a module under this package is the
behaviour behind that code. Core imports names from here and never from ``shared.disciplines.<slug>``
(``backend/.importlinter``, ``backend/tests/test_discipline_module_boundary.py``).
"""

from __future__ import annotations

from shared.disciplines.ingest import INGESTORS, assemble_ingestors
from shared.disciplines.lol import SPEC as _LOL
from shared.disciplines.overwatch import SPEC as _OVERWATCH
from shared.disciplines.spec import (
    CATALOG_KINDS,
    DimensionSpec,
    DisciplineSpec,
    EventTypeSpec,
    FormatDimensionSpec,
    FormatRuleSpec,
    NativeRanks,
    NativeTier,
    RoleSpec,
    StatAggregation,
    StatDefSpec,
    StatFormat,
    TeamFormatPreset,
)

__all__ = (
    "INGESTORS",
    "CATALOG_KINDS",
    "DISCIPLINES",
    "DimensionSpec",
    "DisciplineSpec",
    "EventTypeSpec",
    "FormatDimensionSpec",
    "FormatRuleSpec",
    "NativeRanks",
    "NativeTier",
    "RoleSpec",
    "StatAggregation",
    "StatDefSpec",
    "StatFormat",
    "TeamFormatPreset",
    "discipline",
    "fallback_ladder",
    "identity_provider",
    "rated_role_codes",
)


def _assemble(specs: tuple[DisciplineSpec, ...]) -> dict[str, DisciplineSpec]:
    registry: dict[str, DisciplineSpec] = {}
    for spec in specs:
        if spec.code in registry:
            raise ValueError(f"duplicate discipline {spec.code!r}")
        registry[spec.code] = spec
    return registry


DISCIPLINES: dict[str, DisciplineSpec] = _assemble((_OVERWATCH, _LOL))
INGESTORS.update(assemble_ingestors(DISCIPLINES.values()))


def discipline(code: str) -> DisciplineSpec:
    """The spec for ``code``, or a side-less, kind-less stand-in for a code nobody has written behaviour for.

    Unknown is not an error: ``catalog.discipline`` is the authority on which codes exist, and refusing here would take
    down every encounter of it."""
    return DISCIPLINES.get(code) or DisciplineSpec(code, code, ())


def identity_provider(code: str) -> str:
    """The provider whose handle identifies a player of ``code`` (D90)."""
    provider = discipline(code).identity_provider
    if provider is None:
        raise LookupError(f"discipline {code!r} declares no identity provider (D90)")
    return provider


def rated_role_codes(code: str) -> tuple[str, ...]:
    """The module roles of ``code``'s rated dimension in declaration order: what ranks are kept on (D32, D87)."""
    return tuple(role.code for role in discipline(code).rated_dimension.roles)


def fallback_ladder() -> tuple[NativeTier, ...]:
    """The first registered native ladder, for reads that name no discipline.

    A discipline-scoped read uses only its own ladder; a game without one has no in-code grid.
    """
    return next((spec.native_ladder for spec in DISCIPLINES.values() if spec.native_ladder), ())
