from pydantic import BaseModel

from src.schemas import BaseRead

__all__ = (
    "UserRead",
    "SocialAccountRead",
    "UserUpdate",
)


class SocialAccountRead(BaseRead):
    """Unified player social identity (battlenet/discord/twitch/boosty/vk/youtube/…)."""

    user_id: int
    provider: str
    username: str
    # The provider's display name where ``username`` is an opaque id (Steam persona name).
    display_name: str | None = None
    url: str | None = None
    is_verified: bool = False
    is_primary: bool = False


class UserRead(BaseRead):
    name: str
    social_accounts: list[SocialAccountRead] = []


class UserUpdate(BaseModel):
    name: str
