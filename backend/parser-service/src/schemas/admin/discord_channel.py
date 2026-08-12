from pydantic import BaseModel, field_validator

__all__ = (
    "DiscordChannelUpsert",
    "DiscordChannelRead",
)


class DiscordChannelUpsert(BaseModel):
    """Schema for creating or updating a tournament Discord sync channel.

    channel_id is a Discord snowflake (64-bit integer), accepted as a string to
    avoid JavaScript float64 precision loss on the client side. The guild is not
    here: it belongs to the workspace (``Workspace.discord_guild_id``) and was
    duplicated into every tournament row while being read by nobody.
    """

    channel_id: str
    channel_name: str | None = None
    is_active: bool = True


class DiscordChannelRead(BaseModel):
    """Schema for reading a tournament Discord sync channel."""

    id: int
    tournament_id: int
    channel_id: str
    channel_name: str | None
    is_active: bool

    model_config = {"from_attributes": True}

    @field_validator("channel_id", mode="before")
    @classmethod
    def coerce_snowflake_to_str(cls, v: object) -> str:
        return str(v)
