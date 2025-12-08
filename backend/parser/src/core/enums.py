# Import all enums from shared library and re-export
from shared.core.enums import *

from enum import StrEnum


# Parser-specific enum
class RouteTag(StrEnum):
    """Tags used to classify API routes"""

    ENCOUNTER = " Encounter"
    TEAMS = " Teams"
    TOURNAMENT = " Tournament"
    STANDINGS = " Standings"
    HERO = " Hero"
    USER = " User"
    LOGS = " Logs"
    CHALLONGE = " Challonge"
    ANALYTICS = " Analytics"
