"""One-time, browser-bound Redis tickets that cross a domain boundary.

Cookies set while an OAuth flow runs on the platform apex are not readable on a
workspace's custom domain — different registrable domain — so the apex callback
cannot hand that domain a session or a link directly. It mints an opaque
short-lived ticket instead; the custom domain's own frontend route redeems it
over RPC and takes it from there. The raw payload never appears in a URL, only
the opaque code does.

Two instances, same mechanics, deliberately different payloads:

* :data:`SSO_TICKETS` carries a SESSION forward (access + refresh token) for the
  custom domain to adopt.
* :data:`LINK_TICKETS` carries ONLY the just-exchanged OAuth PROVIDER identity,
  never a site user id: the account being linked to can only be resolved from a
  live session, and the apex never has one for a custom-domain user.

Single use comes from ``GETDEL`` — the read and the delete are one atomic op, so
two concurrent redeems can never both succeed.

**Browser binding.** Single-use alone does not stop an attacker from running
their own flow, capturing their own ticket, and luring a victim into opening the
redeem route: the victim's browser would redeem the attacker's ticket (session
fixation, or account takeover via linking). So a ticket also stores ``lg`` —
``sha256_hex`` of the raw host-only ``owt_xdomain_guard`` cookie value set by the
frontend's custom-domain apex bounce. Redemption requires the raw cookie again
and compares in constant time. The attacker's ticket is bound to the attacker's
own cookie, which is host-only and never leaves the browser that set it, so the
victim's browser cannot satisfy the binding. The raw value is never stored.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

from src.core.cache import RedisStore

_GUARD_FIELD = "lg"


def guard_digest(raw_guard: str) -> str:
    """``sha256_hex`` of a raw guard/CSRF cookie value — the only form ever stored."""
    return hashlib.sha256(raw_guard.encode("utf-8")).hexdigest()


class TicketStore:
    """Issues and redeems one-time tickets in one Redis namespace."""

    def __init__(self, prefix: str, *, ttl: int, purpose: str) -> None:
        self._store = RedisStore(prefix, ttl=ttl, purpose=purpose)

    async def issue(self, payload: dict[str, Any], *, guard_hash: str | None = None) -> str:
        """Mint a ticket for ``payload``; return its opaque code.

        Raises when Redis is unreachable rather than returning a code nobody
        could ever redeem — unlike the caches, this has no fallback path.

        ``guard_hash`` is stored verbatim (it is already a digest). Whether a
        given flow is *allowed* to mint an unbound ticket is not decided here:
        the fail-closed rule lives in the OAuth flow, which refuses to reach this
        method without a guard hash for a custom-domain origin.
        """
        code = secrets.token_urlsafe(32)
        body = dict(payload)
        if guard_hash is not None:
            body[_GUARD_FIELD] = guard_hash
        await self._store.put_json_strict(code, body)
        return code

    async def redeem(self, code: str, guard: str | None) -> dict[str, Any] | None:
        """Burn the ticket, then verify the browser binding. None on any failure.

        The ticket is consumed before the guard is checked, so a failed guard
        check cannot be retried against the same ticket. An unknown code, an
        expired code, an already-redeemed code, a ticket with no binding, a
        missing cookie and a mismatched cookie are all indistinguishable to the
        caller — every one of them is None, and the raw guard is only ever
        compared, never logged.
        """
        payload = await self._store.take_json(code)
        if payload is None:
            return None
        if not self._binding_holds(payload.get(_GUARD_FIELD), guard):
            return None
        return payload

    @staticmethod
    def _binding_holds(ticket_guard_hash: Any, guard: str | None) -> bool:
        if not isinstance(guard, str) or not guard:
            return False
        if not isinstance(ticket_guard_hash, str) or not ticket_guard_hash:
            return False
        return hmac.compare_digest(guard_digest(guard), ticket_guard_hash)


SSO_TICKETS = TicketStore("sso:ticket:", ttl=60, purpose="SSO ticket")
LINK_TICKETS = TicketStore("link:ticket:", ttl=120, purpose="pending-link ticket")
