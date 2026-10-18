# Import all enums from shared library and re-export
from enum import StrEnum

from shared.core.enums import *


# Parser-specific enum
class RouteTag(StrEnum):
    """Tags used to classify API routes"""

    ENCOUNTER = " Encounter"
    TEAMS = " Teams"
    TOURNAMENT = " Tournament"
    STANDINGS = " Standings"
    GAMEMODE = " Gamemode"
    MAP = " Map"
    HERO = " Hero"
    USER = " User"
    LOGS = " Logs"
    CHALLONGE = " Challonge"
    ANALYTICS = " Analytics"
    ACHIEVEMENT = " Achievement"
