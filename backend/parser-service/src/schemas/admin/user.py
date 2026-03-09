from pydantic import BaseModel

__all__ = (
    "UserCreate",
    "UserUpdate",
    "DiscordIdentityCreate",
    "DiscordIdentityUpdate",
    "BattleTagIdentityCreate",
    "BattleTagIdentityUpdate",
    "TwitchIdentityCreate",
    "TwitchIdentityUpdate",
)


class UserCreate(BaseModel):
    """Schema for creating a user"""

    name: str


class UserUpdate(BaseModel):
    """Schema for updating a user"""

    name: str | None = None


# ─── Discord Identity ────────────────────────────────────────────────────────


class DiscordIdentityCreate(BaseModel):
    """Schema for creating a Discord identity"""

    name: str  # Discord username


class DiscordIdentityUpdate(BaseModel):
    """Schema for updating a Discord identity"""

    name: str


# ─── BattleTag Identity ──────────────────────────────────────────────────────


class BattleTagIdentityCreate(BaseModel):
    """Schema for creating a BattleTag identity"""

    battle_tag: str  # Full battle tag (e.g., "Player#1234")


class BattleTagIdentityUpdate(BaseModel):
    """Schema for updating a BattleTag identity"""

    battle_tag: str


# ─── Twitch Identity ─────────────────────────────────────────────────────────


class TwitchIdentityCreate(BaseModel):
    """Schema for creating a Twitch identity"""

    name: str  # Twitch username


class TwitchIdentityUpdate(BaseModel):
    """Schema for updating a Twitch identity"""

    name: str
