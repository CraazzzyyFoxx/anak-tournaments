"""Twitch Helix ``GET /streams`` under an **app** access token.

Answers one question: which of these channels are on air right now.

Three properties of Helix shape every line below:

- **``GET /streams`` returns ONLY live channels.** There is no ``is_live`` field
  to read — a channel that is absent from the response is offline. Do not look
  for one; the absence *is* the signal, and it is why the caller replaces the
  whole live set instead of merging into it.
- **Multi-value parameters repeat, they are not comma-joined.**
  ``?user_login=a&user_login=b`` returns two channels; ``?user_login=a,b``
  returns zero and no error (https://dev.twitch.tv/docs/api/guide/,
  "Specifying multiple query parameter values"). A comma-joined build is a
  silent永 all-offline board, so ``test_helix_client`` asserts the encoded query.
- **The app-token bucket is 800 points/min and is SHARED with identity-service**
  (same Twitch application). Hence ``ratelimit_floor``: the batch loop stops
  issuing requests while there is still headroom for the OAuth logins that
  service needs, and reports how far it got instead of pretending it polled
  everything.

The credential path is deliberately separate from
``shared/subscriptions/providers/twitch_helix.py``: that client runs on each
patron's **user** token against ``GET /subscriptions/user``. Nothing is reused
but the shape of the error taxonomy — an app-token client that raised
``HelixMissingScope`` would put an operator's missing credential on a player's
to-do list.

HTTP is injected as a callable (``request=``), exactly as that module injects
``check_subscription``, so batching, the repeated-parameter encoding, the
401 -> refresh -> retry path and the rate-limit gate are all testable without a
network or a live Twitch application.

Wrapped in a class (``HelixClient``) rather than free functions threading
``client_id``/``client_secret``/``helix_url``/``token_url``/``proxy`` through
every call: those five values are fixed for the life of one poll tick, and
binding them once at construction is what let the tick's fetcher shrink to
``logins``/``user_ids``/``batch_size`` (see ``services/poller.py``).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Iterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Final

import httpx
from redis.asyncio import Redis

from src.services.state import TOKEN_KEY

__all__ = (
    "HELIX_MAX_PARAMS_PER_REQUEST",
    "RATELIMIT_FLOOR",
    "THUMBNAIL_HEIGHT",
    "THUMBNAIL_WIDTH",
    "HelixBatchResult",
    "HelixClient",
    "HelixError",
    "HelixNotConfigured",
    "HelixRateLimited",
    "HelixUnauthorized",
    "HelixUnavailable",
    "StreamSnapshot",
)

#: Hard Helix cap on how many ``user_login``/``user_id`` values one request takes.
#: ``StreamCollectionConfig.batch_size`` is validated ``le=100`` for the same
#: reason; this constant is the floor under that validation, not a duplicate of it.
HELIX_MAX_PARAMS_PER_REQUEST: Final = 100

#: Stop issuing batches while ``Ratelimit-Remaining`` is still above this. The
#: bucket is shared with identity-service's OAuth logins, and a poll tick that
#: drains it turns "nobody can sign in with Twitch" into a stream-badge feature's
#: fault. Policy lives with the caller (``poller`` passes it) — this module only
#: enforces it, because mid-batch is the only place it can be enforced.
RATELIMIT_FLOOR: Final = 100

#: Helix hands back ``.../{width}x{height}.jpg``. Substituted here rather than on
#: the frontend so exactly one place decides the size and the value stored in
#: Redis is directly renderable.
THUMBNAIL_WIDTH: Final = 440
THUMBNAIL_HEIGHT: Final = 248

#: Renew slightly early: a token that expires between the check and the request
#: costs a 401 round trip on every channel batch in flight.
TOKEN_RENEWAL_MARGIN_SECONDS: Final = 60

_TIMEOUT: Final = httpx.Timeout(10.0, connect=5.0)

HelixRequest = Callable[..., Awaitable[httpx.Response]]


class HelixError(Exception):
    """Base for the outcomes the poller distinguishes."""


class HelixNotConfigured(HelixError):
    """No ``TWITCH_CLIENT_ID``/``TWITCH_CLIENT_SECRET``, so no request was made.

    Distinct from every other failure because it is inert by design: the feature
    ships with the credentials unset and the tick must no-op rather than retry,
    alarm, or count against the error budget.
    """


class HelixUnauthorized(HelixError):
    """A 401 that survived a token refresh — the credentials are wrong, not stale."""


class HelixRateLimited(HelixError):
    """429. ``reset_at`` is the unix timestamp from ``Ratelimit-Reset``, if sent."""

    def __init__(self, message: str, *, reset_at: int | None = None) -> None:
        super().__init__(message)
        self.reset_at = reset_at


class HelixUnavailable(HelixError):
    """5xx / timeout / transport failure — retry next tick, nothing is wrong here."""


@dataclass(frozen=True, slots=True)
class StreamSnapshot:
    """One live channel, in exactly the shape the tournament page renders.

    Everything nullable except identity: Helix omits fields for some categories
    and a missing title must degrade to "live, no title", never to "not live".
    """

    channel: str
    user_id: str | None
    url: str
    title: str | None
    game_name: str | None
    viewer_count: int | None
    thumbnail_url: str | None
    started_at: str | None
    platform: str = "twitch"

    def as_dict(self) -> dict[str, Any]:
        """The JSON body stored in ``stream:live:{tournament_id}``.

        The poller adds ``player_id``/``source`` on top; those are tournament
        context, not channel facts, and the same channel can carry different ones
        in two tournaments.
        """
        return {
            "platform": self.platform,
            "channel": self.channel,
            "user_id": self.user_id,
            "url": self.url,
            "title": self.title,
            "game_name": self.game_name,
            "viewer_count": self.viewer_count,
            "thumbnail_url": self.thumbnail_url,
            "started_at": self.started_at,
        }


@dataclass(frozen=True, slots=True)
class HelixBatchResult:
    """Outcome of polling a set of channels.

    ``polled_logins``/``polled_user_ids`` are the identifiers actually sent, not
    the ones asked for: when ``truncated`` is true the rate-limit gate stopped the
    loop early, and a caller that assumed full coverage would write "offline" for
    channels nobody ever asked Twitch about.
    """

    snapshots: list[StreamSnapshot]
    ratelimit_remaining: int | None = None
    polled_logins: frozenset[str] = field(default_factory=frozenset)
    polled_user_ids: frozenset[str] = field(default_factory=frozenset)
    truncated: bool = False


def _ratelimit_remaining(response: httpx.Response) -> int | None:
    raw = response.headers.get("Ratelimit-Remaining")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _ratelimit_reset(response: httpx.Response) -> int | None:
    raw = response.headers.get("Ratelimit-Reset")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _raise_for_status(response: httpx.Response) -> None:
    """Map an HTTP status onto the taxonomy above. 200 returns silently."""
    if response.status_code == 200:
        return
    if response.status_code == 401:
        raise HelixUnauthorized("401 from helix")
    if response.status_code == 429:
        raise HelixRateLimited("429 from helix", reset_at=_ratelimit_reset(response))
    raise HelixUnavailable(f"status {response.status_code}")


def _thumbnail(raw: Any) -> str | None:
    if not isinstance(raw, str) or not raw:
        return None
    return raw.replace("{width}", str(THUMBNAIL_WIDTH)).replace("{height}", str(THUMBNAIL_HEIGHT))


def _as_int(raw: Any) -> int | None:
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _snapshot(row: dict[str, Any]) -> StreamSnapshot | None:
    login = str(row.get("user_login") or "").strip().casefold()
    if not login:
        return None
    return StreamSnapshot(
        channel=login,
        user_id=str(row["user_id"]) if row.get("user_id") else None,
        url=f"https://twitch.tv/{login}",
        title=str(row["title"]) if row.get("title") else None,
        game_name=str(row["game_name"]) if row.get("game_name") else None,
        viewer_count=_as_int(row.get("viewer_count")),
        thumbnail_url=_thumbnail(row.get("thumbnail_url")),
        started_at=str(row["started_at"]) if row.get("started_at") else None,
    )


def _chunks(params: Sequence[tuple[str, str]], size: int) -> Iterator[list[tuple[str, str]]]:
    """Split ``(param_name, value)`` pairs into request-sized groups.

    ``user_id`` and ``user_login`` are chunked together: Helix accepts both in one
    call and caps each at 100, so a mixed chunk of <=100 is always legal and costs
    fewer requests out of the shared bucket than two single-type passes.
    """
    for start in range(0, len(params), size):
        yield list(params[start : start + size])


class HelixClient:
    """Twitch Helix app-token client, bound to one set of credentials/endpoints.

    ``request`` is the injection seam: pass a fake to exercise batching, the
    repeated-parameter encoding, and the 401 -> refresh -> retry path without a
    network or a live Twitch application.
    """

    def __init__(
        self,
        redis: Redis,
        *,
        client_id: str | None,
        client_secret: str | None,
        helix_url: str,
        token_url: str,
        proxy: str | None = None,
        request: HelixRequest | None = None,
    ) -> None:
        self._redis = redis
        self._client_id = client_id
        self._client_secret = client_secret
        self._helix_url = helix_url
        self._token_url = token_url
        self._proxy = proxy
        self._request = request

    @asynccontextmanager
    async def _requester(self) -> AsyncIterator[HelixRequest]:
        """Yield the injected callable, or one client shared by the whole batch loop.

        One client per loop, not per request: egress goes through the SOCKS proxy
        and a fresh connection per batch would pay the handshake ten times over.
        """
        if self._request is not None:
            yield self._request
            return
        async with httpx.AsyncClient(proxy=self._proxy, timeout=_TIMEOUT) as client:
            yield client.request

    async def get_app_token(self) -> str:
        """Cached app access token (``grant_type=client_credentials``).

        Cached in Redis rather than in the process: every replica shares one
        token, so a rolling restart does not mint a new one per pod. TTL is
        ``expires_in - TOKEN_RENEWAL_MARGIN_SECONDS`` — the token itself is what
        expires; the key just stops being offered slightly earlier.
        """
        if not self._client_id or not self._client_secret:
            raise HelixNotConfigured("twitch client id/secret are not configured")

        cached = await self._redis.get(TOKEN_KEY)
        if cached:
            return str(cached)

        async with self._requester() as send:
            try:
                response = await send(
                    "POST",
                    self._token_url,
                    data={
                        "client_id": self._client_id,
                        "client_secret": self._client_secret,
                        "grant_type": "client_credentials",
                    },
                )
            except httpx.HTTPError as exc:
                raise HelixUnavailable(str(exc)) from exc

        if response.status_code in (400, 401, 403):
            # The token endpoint answers 400 for a bad client_secret, not 401.
            # Both mean the same operator action, so both land on
            # HelixUnauthorized rather than being retried forever as a transient
            # outage.
            raise HelixUnauthorized(f"token endpoint refused credentials (status {response.status_code})")
        _raise_for_status(response)

        payload: dict[str, Any] = response.json()
        token = str(payload.get("access_token") or "")
        if not token:
            raise HelixUnavailable("token endpoint returned no access_token")

        expires_in = _as_int(payload.get("expires_in")) or 0
        ttl = max(expires_in - TOKEN_RENEWAL_MARGIN_SECONDS, TOKEN_RENEWAL_MARGIN_SECONDS)
        await self._redis.set(TOKEN_KEY, token, ex=ttl)
        return token

    async def get_live_streams(
        self,
        *,
        logins: Sequence[str] = (),
        user_ids: Sequence[str] = (),
        token: str,
        batch_size: int = HELIX_MAX_PARAMS_PER_REQUEST,
        ratelimit_floor: int = RATELIMIT_FLOOR,
    ) -> HelixBatchResult:
        """Which of ``logins``/``user_ids`` are live, in batches of ``batch_size``.

        Prefer ``user_ids`` where available: a Twitch login changes when the
        streamer renames the channel, and a stale login silently reports offline
        forever (Risks, "user_login for self-declared nicks").

        Raises rather than returning partial garbage on 401/429/5xx. The one
        partial outcome that IS returned is the rate-limit gate:
        ``truncated=True`` with the identifiers that were actually polled.
        """
        size = max(1, min(int(batch_size), HELIX_MAX_PARAMS_PER_REQUEST))
        wanted: list[tuple[str, str]] = [("user_id", str(v)) for v in user_ids if str(v).strip()]
        wanted += [("user_login", str(v).strip().casefold()) for v in logins if str(v).strip()]
        if not wanted:
            return HelixBatchResult(snapshots=[])

        assert self._client_id is not None  # get_app_token raises HelixNotConfigured otherwise
        headers = {"Authorization": f"Bearer {token}", "Client-Id": self._client_id}
        url = f"{self._helix_url.rstrip('/')}/streams"

        snapshots: list[StreamSnapshot] = []
        polled_logins: set[str] = set()
        polled_user_ids: set[str] = set()
        remaining: int | None = None
        truncated = False

        async with self._requester() as send:
            for chunk in _chunks(wanted, size):
                if remaining is not None and remaining < ratelimit_floor:
                    truncated = True
                    break
                # A list of pairs, NOT a dict: httpx encodes repeated keys as
                # `user_login=a&user_login=b`, which is the only form Helix reads.
                # Also pin `first` — the endpoint defaults to 20 and would
                # silently drop the tail of a 100-channel batch.
                params: list[tuple[str, str]] = [*chunk, ("first", str(len(chunk)))]
                try:
                    response = await send("GET", url, params=params, headers=headers)
                except httpx.HTTPError as exc:
                    raise HelixUnavailable(str(exc)) from exc

                _raise_for_status(response)
                remaining = _ratelimit_remaining(response)

                for name, value in chunk:
                    (polled_user_ids if name == "user_id" else polled_logins).add(value)

                payload: dict[str, Any] = response.json() or {}
                for row in payload.get("data") or []:
                    if not isinstance(row, dict):
                        continue
                    snapshot = _snapshot(row)
                    if snapshot is not None:
                        snapshots.append(snapshot)

        return HelixBatchResult(
            snapshots=snapshots,
            ratelimit_remaining=remaining,
            polled_logins=frozenset(polled_logins),
            polled_user_ids=frozenset(polled_user_ids),
            truncated=truncated,
        )

    async def fetch_live_streams(
        self,
        *,
        logins: Sequence[str] = (),
        user_ids: Sequence[str] = (),
        batch_size: int = HELIX_MAX_PARAMS_PER_REQUEST,
        ratelimit_floor: int = RATELIMIT_FLOOR,
    ) -> HelixBatchResult:
        """``get_live_streams`` with the token lifecycle attached.

        The 401 -> drop the cached token -> retry once path lives here rather
        than in ``get_live_streams`` because it needs the credentials and the
        Redis cache, and ``get_live_streams`` deliberately takes neither: a
        method handed a bare token stays trivially testable. A second 401 is not
        a stale token, it is wrong credentials, so it surfaces as
        ``HelixUnauthorized``.
        """
        token = await self.get_app_token()

        for attempt in (1, 2):
            try:
                return await self.get_live_streams(
                    logins=logins,
                    user_ids=user_ids,
                    token=token,
                    batch_size=batch_size,
                    ratelimit_floor=ratelimit_floor,
                )
            except HelixUnauthorized:
                if attempt == 2:
                    raise
                await self._redis.delete(TOKEN_KEY)
                token = await self.get_app_token()

        raise AssertionError("unreachable")  # pragma: no cover
