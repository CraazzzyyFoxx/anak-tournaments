from pydantic import BaseModel, Field

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
    url: str | None = None
    is_verified: bool = False
    is_primary: bool = False
    # Display visibility (populated only when the visibilities relationship is
    # loaded — e.g. the admin profile dialog). ``visible_global`` = shown on the
    # public profile; ``visible_workspace_ids`` = workspaces it is shown in.
    visible_global: bool = True
    visible_workspace_ids: list[int] = Field(default_factory=list)


class UserRead(BaseRead):
    name: str
    avatar_url: str | None = None
    # Owner's veto on having their live stream surfaced on tournament pages.
    # Defaults to True for the same reason the column does: nothing that fails to
    # populate it may read as "this player asked to be hidden".
    stream_visible: bool = True
    social_accounts: list[SocialAccountRead] = []


class UserUpdate(BaseModel):
    name: str
