"""A player's game identity on the wire: the owner provider and the handle as stored (D90)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

__all__ = ("PlayerIdentityRead",)


class PlayerIdentityRead(BaseModel):
    """``provider`` is a ``SocialProvider`` value; ``handle`` is the display form (``display_social_handle``)."""

    model_config = ConfigDict(frozen=True)

    provider: str
    handle: str
