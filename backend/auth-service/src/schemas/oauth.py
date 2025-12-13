"""
Generic OAuth schemas for multiple providers
"""
from enum import Enum
from pydantic import BaseModel, Field

__all__ = (
    "OAuthProvider",
    "OAuthURL",
    "OAuthCallbackRequest",
    "OAuthUserInfo",
    "PlayerLinkRequest",
    "PlayerLinkResponse",
    "LinkedPlayer",
)


class OAuthProvider(str, Enum):
    """Supported OAuth providers"""
    DISCORD = "discord"
    GOOGLE = "google"
    GITHUB = "github"
    # Add more providers as needed


class OAuthURL(BaseModel):
    """OAuth URL response"""
    provider: OAuthProvider
    url: str
    state: str


class OAuthCallbackRequest(BaseModel):
    """OAuth callback request"""
    code: str
    state: str


class OAuthUserInfo(BaseModel):
    """Generic OAuth user information"""
    provider: OAuthProvider
    provider_user_id: str
    email: str | None = None
    username: str
    display_name: str | None = None
    avatar_url: str | None = None
    raw_data: dict = Field(default_factory=dict)
    
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
