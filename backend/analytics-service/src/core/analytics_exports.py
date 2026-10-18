"""The service's one door to a discipline's analytics module (D83, D99).

Concrete features, models and the canonical division scale live in ``shared.disciplines.<slug>.analytics``; this
service reaches them only through the registry's lazy ``DisciplineSpec.analytics`` hook. A discipline that declares none
is unsupported, never served another game's module.
"""

from __future__ import annotations

from shared.disciplines import discipline
from shared.domain.analytics import AnalyticsExports

__all__ = ("OVERWATCH", "UnsupportedAnalytics", "analytics_exports")

OVERWATCH = "overwatch"


class UnsupportedAnalytics(LookupError):
    """The discipline declares no analytics module."""


def analytics_exports(code: str) -> AnalyticsExports:
    spec = discipline(code)
    if spec.analytics is None:
        raise UnsupportedAnalytics(f"discipline {code!r} declares no analytics module")
    return spec.analytics()
