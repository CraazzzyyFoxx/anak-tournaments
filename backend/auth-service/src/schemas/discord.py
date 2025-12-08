"""
Discord OAuth schemas
"""
from pydantic import BaseModel, Field

__all__ = (
    "DiscordOAuthURL",
    "DiscordCallbackRequest",
    "DiscordUserInfo",
    "PlayerLinkRequest",
    "PlayerLinkResponse",
    "LinkedPlayer",
)


class DiscordOAuthURL(BaseModel):
    """Discord OAuth URL response"""
    url: str
    state: str


class DiscordCallbackRequest(BaseModel):
    """Discord OAuth callback request"""
    code: str
    state: str


class DiscordUserInfo(BaseModel):
    """Discord user information"""
    id: int
    username: str
    discriminator: str | None = None
    avatar: str | None = None
    email: str | None = None
    
    class Config:
        from_attributes = True


class PlayerLinkRequest(BaseModel):
    """Request to link player to auth user"""
    player_id: int
    is_primary: bool = True


class LinkedPlayer(BaseModel):
    """Linked player information"""
    player_id: int
    player_name: str
    is_primary: bool
    linked_at: str
    
    class Config:
        from_attributes = True


class PlayerLinkResponse(BaseModel):
    """Response after linking player"""
    message: str
    player: LinkedPlayer
