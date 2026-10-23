"""Analytical read queries for the user domain, split by feature area; each class is bound to one discipline
(``UserCompareQueries.of("overwatch")``)."""

from .compare import UserCompareQueries
from .encounters import UserEncounterQueries
from .overview import UserOverviewQueries
from .profile import UserProfileQueries

__all__ = [
    "UserCompareQueries",
    "UserEncounterQueries",
    "UserOverviewQueries",
    "UserProfileQueries",
]
