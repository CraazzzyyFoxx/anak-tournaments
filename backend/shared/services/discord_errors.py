"""The outcomes a Discord read can have, as every caller distinguishes them.

Raised by :class:`shared.services.discord_client.DiscordClient` and consumed by
the Discord-role subscription resolver, team eligibility, the workspace pickers
and the mix voice mover -- one vocabulary, so a decision table written once
reads the same everywhere.
"""

from __future__ import annotations

__all__ = (
    "DiscordError",
    "DiscordForbidden",
    "DiscordNotConfigured",
    "DiscordUnavailable",
    "MemberNotFound",
)


class DiscordError(Exception):
    """Base for the outcomes the callers distinguish."""


class MemberNotFound(DiscordError):
    """The user is not a member of the guild -- a real answer, not a failure."""


class DiscordForbidden(DiscordError):
    """The bot cannot see the guild (not invited, or kicked). Organizer misconfiguration."""


class DiscordNotConfigured(DiscordError):
    """This process has no broker, so discord-service was never asked.

    Deliberately distinct from :class:`DiscordForbidden`: a refusal means the
    guild really is unreachable, while this means we never asked. Reporting it
    as ``guild_not_accessible`` would point the operator at a guild id that is
    fine instead of at the missing wiring.
    """


class DiscordUnavailable(DiscordError):
    """discord-service did not answer: timeout, transport failure, or its own error."""
