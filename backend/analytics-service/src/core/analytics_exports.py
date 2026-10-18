"""The service's one door to a discipline's analytics module (D83, D99).

Concrete features, models and the canonical division scale live in ``shared.disciplines.<slug>.analytics``; this
service reaches them only through the registry's lazy ``DisciplineSpec.analytics`` hook. A discipline that declares none
is unsupported, never served another game's module. Which module serves a request is decided by the tournament that owns
it (:func:`tournament_discipline`), never by a default.
"""

from __future__ import annotations

import functools
from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from shared.disciplines import DISCIPLINES, DisciplineSpec, discipline
from shared.domain.analytics import AnalyticsExports
from shared.repository import TournamentRepository

__all__ = (
    "ContradictoryDiscipline",
    "UnsupportedAnalytics",
    "analytics_exports",
    "assert_unique_algorithm_names",
    "supports_analytics",
    "tournament_discipline",
    "tournament_module",
)

_tournaments = TournamentRepository()


class UnsupportedAnalytics(LookupError):
    """The discipline declares no analytics module."""


class ContradictoryDiscipline(ValueError):
    """An explicit discipline names a different game than the tournament that owns the request."""


def supports_analytics(code: str) -> bool:
    """Whether ``code`` declares an analytics module, without importing it (pandas and the estimators stay unloaded)."""
    return discipline(code).analytics is not None


def assert_unique_algorithm_names(specs: Iterable[DisciplineSpec]) -> None:
    """An algorithm name owns its registry rows and role-less artifacts: two modules declaring one would share them."""
    owners: dict[str, str] = {}
    for spec in specs:
        if spec.analytics is None:
            continue
        for declaration in spec.analytics().MODELS.values():
            if owners.setdefault(declaration.algorithm_name, spec.code) != spec.code:
                raise ValueError(
                    f"analytics algorithm {declaration.algorithm_name!r} is declared by both "
                    f"{owners[declaration.algorithm_name]!r} and {spec.code!r}"
                )


@functools.cache
def _algorithm_names_checked() -> bool:
    assert_unique_algorithm_names(DISCIPLINES.values())
    return True


def analytics_exports(code: str) -> AnalyticsExports:
    spec = discipline(code)
    if spec.analytics is None:
        raise UnsupportedAnalytics(f"discipline {code!r} declares no analytics module")
    _algorithm_names_checked()  # fails loudly (and on every call: functools.cache does not memoise exceptions)
    return spec.analytics()


async def tournament_discipline(
    session: AsyncSession, tournament_id: int, *, explicit: str | None = None
) -> str | None:
    """The discipline that owns ``tournament_id``; ``None`` when no such tournament exists.

    The tournament is authoritative: an ``explicit`` discipline that names another game is rejected, not obeyed.
    """
    owner = await _tournaments.get_owner(session, tournament_id)
    if owner is None:
        return None
    code = owner[1]
    if explicit is not None and explicit != code:
        raise ContradictoryDiscipline(f"tournament {tournament_id} belongs to discipline {code!r}, not {explicit!r}")
    return code


async def tournament_module(session: AsyncSession, tournament_id: int) -> tuple[str, AnalyticsExports] | None:
    """``(discipline, module)`` of the tournament's owner, or ``None`` when the tournament is unknown or its discipline
    declares no analytics module: automatic enrichment then has nothing to do and must write nothing."""
    code = await tournament_discipline(session, tournament_id)
    if code is None or not supports_analytics(code):
        return None
    return code, analytics_exports(code)
