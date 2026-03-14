from pydantic import BaseModel, field_serializer

__all__ = (
    "DiscordChannelUpsert",
    "DiscordChannelRead",
)


class DiscordChannelUpsert(BaseModel):
    """Schema for creating or updating a tournament Discord sync channel.

    guild_id and channel_id are Discord snowflakes (64-bit integers). They are
    accepted as strings to avoid JavaScript float64 precision loss on the client side.
    """

    guild_id: str
    channel_id: str
    channel_name: str | None = None
    is_active: bool = True


class DiscordChannelRead(BaseModel):
    """Schema for reading a tournament Discord sync channel."""

    id: int
    tournament_id: int
    guild_id: str
    channel_id: str
    channel_name: str | None
    is_active: bool

    model_config = {"from_attributes": True}

    @field_serializer("guild_id", "channel_id")
    def serialize_snowflake(self, v: str | int) -> str:
        return str(v)
