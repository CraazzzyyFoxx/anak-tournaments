from pydantic import BaseModel

__all__ = (
    "DiscordChannelUpsert",
    "DiscordChannelRead",
)


class DiscordChannelUpsert(BaseModel):
    """Schema for creating or updating a tournament Discord sync channel."""

    guild_id: int
    channel_id: int
    channel_name: str | None = None
    is_active: bool = True


class DiscordChannelRead(BaseModel):
    """Schema for reading a tournament Discord sync channel."""

    id: int
    tournament_id: int
    guild_id: int
    channel_id: int
    channel_name: str | None
    is_active: bool

    model_config = {"from_attributes": True}
