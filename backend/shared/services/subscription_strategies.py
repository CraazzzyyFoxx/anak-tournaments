"""Wire the providers to real identities and real HTTP.

Each strategy answers "resolve these users for this provider", owning the lookup
from our ``auth_user_id`` to the external account id. That keeps the resolver
purely about config and caching.

Credentials are constructor arguments, never read from a global settings object:
``shared`` is imported by every service and must not depend on any one service's
configuration.
"""

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, Final

import httpx
from loguru import logger
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.messaging.config import DISCORD_MEMBER_ROLES_QUEUE
from shared import models
from shared.core.social import SocialProvider
from shared.subscriptions import SubscriptionVerdict
from shared.subscriptions.providers.discord_role import (
    DiscordForbidden,
    DiscordNotConfigured,
    DiscordRoleResolver,
    DiscordUnavailable,
    GuildRolesFetcher,
    MemberNotFound,
    MemberRolesFetcher,
)
from shared.subscriptions.providers.twitch_helix import (
    HelixForbidden,
    HelixMissingScope,
    HelixNotConfigured,
    HelixNotFound,
    HelixUnavailable,
    TwitchHelixResolver,
)

__all__ = (
    "DISCORD_API_BASE",
    "TWITCH_HELIX_BASE",
    "BoostyDiscordStrategy",
    "TwitchSubscriptionStrategy",
    "load_provider_user_ids",
)

DISCORD_API_BASE: Final = "https://discord.com/api/v10"
TWITCH_HELIX_BASE: Final = "https://api.twitch.tv/helix"

_TIMEOUT: Final = httpx.Timeout(10.0, connect=5.0)


async def load_provider_user_ids(
    session: AsyncSession,
    *,
    auth_user_ids: Sequence[int],
    oauth_provider: str,
) -> dict[int, str]:
    """Map ``auth_user_id`` -> external account id for one OAuth provider.

    A user may have several connections of the same provider (the schema allows
    it deliberately); the lowest id wins so the answer is stable across calls
    rather than flapping between accounts.
    """
    if not auth_user_ids:
        return {}
    rows = await session.execute(
        sa.select(models.OAuthConnection.auth_user_id, models.OAuthConnection.provider_user_id)
        .where(
            models.OAuthConnection.auth_user_id.in_(list(auth_user_ids)),
            models.OAuthConnection.provider == oauth_provider,
        )
        .order_by(models.OAuthConnection.id)
    )
    out: dict[int, str] = {}
    for auth_user_id, provider_user_id in rows.all():
        out.setdefault(auth_user_id, provider_user_id)
    return out


class BoostyDiscordStrategy:
    """Boosty tiers via the Discord roles Boosty's own bot assigns.

    Prefers FastStream RPC to ``discord-service`` for cached discord.py roles;
    falls back to direct HTTP REST calls to Discord API if RPC is unavailable.
    """

    def __init__(
        self,
        session: AsyncSession,
        *,
        bot_token: str | None = None,
        broker: Any | None = None,
        proxy: str | None = None,
        api_base: str = DISCORD_API_BASE,
    ) -> None:
        self._session = session
        self._bot_token = bot_token
        self._broker = broker
        self._proxy = proxy
        self._api_base = api_base

    async def resolve_many(
        self, *, config: dict[str, Any], auth_user_ids: Sequence[int]
    ) -> dict[int, SubscriptionVerdict]:
        discord_ids = await load_provider_user_ids(
            self._session, auth_user_ids=auth_user_ids, oauth_provider=SocialProvider.DISCORD
        )

        guild_id = str(config.get("guild_id") or "").strip() if config else ""

        # First attempt: RPC call to discord-service for in-memory cached discord.py roles
        if self._broker is not None and guild_id:
            try:
                rpc_res = await self._broker.request(
                    {
                        "guild_id": guild_id,
                        "user_ids": [uid for uid in discord_ids.values() if uid],
                    },
                    DISCORD_MEMBER_ROLES_QUEUE,
                    timeout=5.0,
                )
                if isinstance(rpc_res, dict) and "members" in rpc_res and not rpc_res.get("error"):
                    return await self._resolve_from_rpc(
                        config=config,
                        auth_user_ids=auth_user_ids,
                        discord_ids=discord_ids,
                        rpc_res=rpc_res,
                    )
            except Exception as exc:
                logger.warning(f"RPC call to discord_member_roles failed, falling back to HTTP: {exc}")

        # Fallback: direct HTTP REST requests
        async with httpx.AsyncClient(
            proxy=self._proxy,
            timeout=_TIMEOUT,
            headers={"Authorization": f"Bot {self._bot_token}"} if self._bot_token else {},
        ) as client:
            resolver = DiscordRoleResolver(
                fetch_member_roles=self._member_roles_fetcher(client),
                fetch_guild_role_ids=self._guild_roles_fetcher(client),
            )
            semaphore = asyncio.Semaphore(15)

            async def _resolve_one(auth_user_id: int) -> tuple[int, SubscriptionVerdict]:
                async with semaphore:
                    verdict = await resolver.resolve(
                        config=config,
                        discord_user_id=discord_ids.get(auth_user_id),
                    )
                    return auth_user_id, verdict

            results = await asyncio.gather(*[_resolve_one(uid) for uid in auth_user_ids])
            return dict(results)

    async def _resolve_from_rpc(
        self,
        *,
        config: dict[str, Any],
        auth_user_ids: Sequence[int],
        discord_ids: dict[int, str],
        rpc_res: dict[str, Any],
    ) -> dict[int, SubscriptionVerdict]:
        guild_role_ids = {str(r) for r in (rpc_res.get("guild_role_ids") or [])}
        members = rpc_res.get("members") or {}

        async def fetch_guild_roles(gid: str) -> set[str]:
            return guild_role_ids

        out: dict[int, SubscriptionVerdict] = {}
        for auth_user_id in auth_user_ids:
            discord_id = discord_ids.get(auth_user_id)
            if not discord_id:
                async def fetch_member_roles(gid: str, uid: str) -> list[str]:
                    raise MemberNotFound("member not found")
            else:
                m_info = members.get(discord_id)
                if not m_info or not m_info.get("found"):
                    async def fetch_member_roles(gid: str, uid: str) -> list[str]:
                        raise MemberNotFound("member not found")
                else:
                    user_roles = [str(r) for r in (m_info.get("roles") or [])]
                    async def fetch_member_roles(gid: str, uid: str, _r=user_roles) -> list[str]:
                        return _r

            resolver = DiscordRoleResolver(
                fetch_member_roles=fetch_member_roles,
                fetch_guild_role_ids=fetch_guild_roles,
            )
            out[auth_user_id] = await resolver.resolve(config=config, discord_user_id=discord_id)

        return out

    def _member_roles_fetcher(self, client: httpx.AsyncClient) -> MemberRolesFetcher:
        async def fetch(guild_id: str, user_id: str) -> list[str]:
            if not self._bot_token:
                raise DiscordNotConfigured("discord bot token is not configured")
            try:
                response = await client.get(f"{self._api_base}/guilds/{guild_id}/members/{user_id}")
            except httpx.HTTPError as exc:
                raise DiscordUnavailable(str(exc)) from exc
            # 404 = not a member (a real "not subscribed"); it does NOT count
            # toward Discord's invalid-request ban budget, unlike 401/403/429.
            if response.status_code == 404:
                raise MemberNotFound("member not found")
            if response.status_code in (401, 403):
                raise DiscordForbidden(f"status {response.status_code}")
            if response.status_code >= 500 or response.status_code == 429:
                raise DiscordUnavailable(f"status {response.status_code}")
            if response.status_code != 200:
                raise DiscordUnavailable(f"unexpected status {response.status_code}")
            return [str(role_id) for role_id in (response.json().get("roles") or [])]

        return fetch

    def _guild_roles_fetcher(self, client: httpx.AsyncClient) -> GuildRolesFetcher:
        async def fetch(guild_id: str) -> set[str]:
            if not self._bot_token:
                raise DiscordNotConfigured("discord bot token is not configured")
            try:
                response = await client.get(f"{self._api_base}/guilds/{guild_id}/roles")
            except httpx.HTTPError as exc:
                raise DiscordUnavailable(str(exc)) from exc
            if response.status_code in (401, 403):
                raise DiscordForbidden(f"status {response.status_code}")
            if response.status_code != 200:
                raise DiscordUnavailable(f"status {response.status_code}")
            return {str(role.get("id")) for role in response.json() or []}

        return fetch


class TwitchSubscriptionStrategy:
    """Twitch tiers via Helix ``GET /subscriptions/user``.

    Uses each patron's own stored user access token. A 401 means either an expired
    token or a token predating the ``user:read:subscriptions`` scope; both surface
    as ``HelixMissingScope`` so the UI offers a reconnect instead of refusing the
    patron. Refreshing the token is identity-service's job, not this module's.
    """

    def __init__(
        self,
        session: AsyncSession,
        *,
        client_id: str | None,
        proxy: str | None = None,
        api_base: str = TWITCH_HELIX_BASE,
    ) -> None:
        self._session = session
        self._client_id = client_id
        self._proxy = proxy
        self._api_base = api_base

    async def resolve_many(
        self, *, config: dict[str, Any], auth_user_ids: Sequence[int]
    ) -> dict[int, SubscriptionVerdict]:
        connections = await self._load_connections(auth_user_ids)

        async with httpx.AsyncClient(proxy=self._proxy, timeout=_TIMEOUT) as client:
            semaphore = asyncio.Semaphore(15)

            async def _resolve_one(auth_user_id: int) -> tuple[int, SubscriptionVerdict]:
                async with semaphore:
                    connection = connections.get(auth_user_id)
                    resolver = TwitchHelixResolver(check_subscription=self._checker(client, connection))
                    verdict = await resolver.resolve(
                        config=config,
                        twitch_user_id=connection[0] if connection else None,
                    )
                    return auth_user_id, verdict

            results = await asyncio.gather(*[_resolve_one(uid) for uid in auth_user_ids])
            return dict(results)

    async def _load_connections(self, auth_user_ids: Sequence[int]) -> dict[int, tuple[str, str | None]]:
        if not auth_user_ids:
            return {}
        rows = await self._session.execute(
            sa.select(
                models.OAuthConnection.auth_user_id,
                models.OAuthConnection.provider_user_id,
                models.OAuthConnection.access_token,
            )
            .where(
                models.OAuthConnection.auth_user_id.in_(list(auth_user_ids)),
                models.OAuthConnection.provider == SocialProvider.TWITCH,
            )
            .order_by(models.OAuthConnection.id)
        )
        out: dict[int, tuple[str, str | None]] = {}
        for auth_user_id, provider_user_id, access_token in rows.all():
            out.setdefault(auth_user_id, (provider_user_id, access_token))
        return out

    def _checker(
        self, client: httpx.AsyncClient, connection: tuple[str, str | None] | None
    ) -> Callable[..., Awaitable[dict[str, Any]]]:
        async def check(*, broadcaster_id: str, user_id: str) -> dict[str, Any]:
            token = connection[1] if connection else None
            if not self._client_id:
                raise HelixNotConfigured("twitch client id is not configured")
            if not token:
                raise HelixMissingScope("no usable twitch token")
            try:
                response = await client.get(
                    f"{self._api_base}/subscriptions/user",
                    params={"broadcaster_id": broadcaster_id, "user_id": user_id},
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Client-Id": self._client_id,
                    },
                )
            except httpx.HTTPError as exc:
                raise HelixUnavailable(str(exc)) from exc
            if response.status_code == 404:
                raise HelixNotFound("not subscribed")
            if response.status_code == 401:
                raise HelixMissingScope("401 from helix")
            if response.status_code in (400, 403):
                raise HelixForbidden(f"status {response.status_code}")
            if response.status_code != 200:
                raise HelixUnavailable(f"status {response.status_code}")
            result: dict[str, Any] = response.json()
            return result

        return check
