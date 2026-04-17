from .tournament import *
from .stage import *
from .team import *
from .encounter import *
from .standing import *
from .user import *
from .hero import *
from .gamemode import *
from .map import *
from .player_sub_role import *

__all__ = (
    # Tournament schemas
    "TournamentCreate",
    "TournamentUpdate",
    # Team schemas
    "TeamCreate",
    "TeamUpdate",
    # Player schemas
    "PlayerCreate",
    "PlayerUpdate",
    "PlayerSubRoleCreate",
    "PlayerSubRoleRead",
    "PlayerSubRoleUpdate",
    # Encounter schemas
    "EncounterCreate",
    "EncounterUpdate",
    # Standing schemas
    "StandingUpdate",
    # User schemas
    "UserCreate",
    "UserUpdate",
    # Identity schemas
    "DiscordIdentityCreate",
    "DiscordIdentityUpdate",
    "BattleTagIdentityCreate",
    "BattleTagIdentityUpdate",
    "TwitchIdentityCreate",
    "TwitchIdentityUpdate",
    # Hero schemas
    "HeroCreate",
    "HeroUpdate",
    # Gamemode schemas
    "GamemodeCreate",
    "GamemodeUpdate",
    # Map schemas
    "MapCreate",
    "MapUpdate",
)
