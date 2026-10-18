"""A player's game identity on the wire: the owner provider and the handle as stored (D90)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from shared.core.social import display_social_handle

__all__ = ("PlayerIdentityRead",)


class PlayerIdentityRead(BaseModel):
    """``provider`` is a ``SocialProvider`` value; ``handle`` is the display form (``display_social_handle``)."""

    model_config = ConfigDict(frozen=True)

    provider: str
    handle: str

    @classmethod
    def of(cls, provider: str | None, handle: str | None) -> PlayerIdentityRead | None:
        """The identity ``handle`` denotes for ``provider``, or ``None`` when either is missing or blank."""
        if not provider:
            return None
        text = display_social_handle(provider, handle)
        return cls(provider=provider, handle=text) if text else None
