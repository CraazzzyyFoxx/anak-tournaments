"""Which of the account links a self-service mix signup requires are missing:
Discord, plus the mix game's own identity provider when it can be OAuth-linked.

Each for a concrete reason: Discord because the bot can only act for an account
that linked the Discord user who clicked; the game's provider (Battle.net for
Overwatch, Riot for League) because a mix roster row is named after that handle
and its ranks are resolved through the player identity that link creates.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.social import PROVIDERS, SocialProvider
from shared.disciplines import discipline
from shared.repository import OAuthConnectionRepository

__all__ = ("missing_account_links", "required_link_providers")

_connections = OAuthConnectionRepository()


def required_link_providers(discipline_code: str) -> tuple[str, ...]:
    """Discord, then the game's identity provider when an OAuth link can prove it. Order = blocker order."""
    provider = discipline(discipline_code).identity_provider
    spec = PROVIDERS.get(provider) if provider else None
    return (SocialProvider.DISCORD, provider) if spec is not None and spec.supports_oauth else (SocialProvider.DISCORD,)


async def missing_account_links(session: AsyncSession, auth_user_id: int, discipline_code: str) -> frozenset[str]:
    """The subset of :func:`required_link_providers` this account has no OAuth row for."""
    required = required_link_providers(discipline_code)
    rows = await _connections.list_by_user_providers(session, auth_user_id=auth_user_id, providers=list(required))
    linked = {row.provider for row in rows}
    return frozenset(provider for provider in required if provider not in linked)
