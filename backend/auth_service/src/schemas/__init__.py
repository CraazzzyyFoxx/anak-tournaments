"""
Schemas for auth service
"""
from .auth import *
from .discord import *

__all__ = [
    "UserRegister",
    "UserLogin",
    "Token",
    "TokenPayload",
    "RefreshTokenRequest",
    "AuthUser",
    "UserUpdate",
    "DiscordOAuthURL",
    "DiscordCallbackRequest",
    "DiscordUserInfo",
    "PlayerLinkRequest",
    "PlayerLinkResponse",
    "LinkedPlayer",
]
