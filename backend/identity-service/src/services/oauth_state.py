"""Signed, self-contained, Redis-free OAuth ``state``.

The callback always lands on the ONE fixed apex URL registered with every
provider, so everything the callback needs to get the user back where they
started has to travel inside ``state`` itself: originating host, post-auth
redirect path, intent, provider, and the browser-binding hashes. That makes it
a bearer token in a query string, so it is HMAC-signed with a domain-separated
subkey and carries its own short expiry.
"""

from __future__ import annotations

import base64
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from src.core import key_derivation
from src.core.config import Settings, settings
from src.services.tickets import guard_digest


@dataclass(frozen=True)
class StatePayload:
    """Decoded, verified contents of a signed OAuth ``state`` parameter.

    Carries the originating host (``origin``), the post-auth redirect path
    (``redirect``), and the intent (``action``: ``"login"`` or ``"link"``) so
    the callback -- which always lands on the ONE fixed apex callback URL
    registered with each provider -- can send the user back to the tenant
    subdomain that started the flow. ``nonce`` is exposed so the caller can
    enforce single-use / replay protection (see the flow layer's ``callback``);
    ``verify`` itself does not consume it. ``csrf`` is the SHA-256 hex
    digest of the raw CSRF cookie value that was live in the browser when the
    flow started (browser-binding, closes OAuth login/link CSRF) -- this
    dataclass never carries the raw token, only its hash, and does not
    compare it against anything; the flow layer does that with the raw cookie
    value it receives separately.

    ``guard_hash`` (JSON key ``"lg"``) is the SAME kind of binding, one layer
    further out: it is the SHA-256 hex digest of the raw ``owt_xdomain_guard``
    cookie value set by the frontend's custom-domain apex bounce
    (``oauth-login.ts``). It is OPTIONAL -- only present for a flow that
    actually bounced through a custom domain -- and, like ``csrf``, this
    dataclass only ever carries the hash, never the raw cookie value. When
    present it is later stored on the cross-domain ticket issued by the flow
    layer's ``callback``/``link`` and compared (constant-time) against the raw
    guard value presented at redemption (``sso_exchange``/``link_complete``)
    -- see the Task 10R fix-1 brief.
    """

    origin: str
    redirect: str
    action: str
    provider: str
    nonce: str
    exp: int
    csrf: str
    guard_hash: str | None = None


class OAuthStateCodec:
    """Signed, self-contained, Redis-free OAuth ``state``."""

    def __init__(self, *, config: Settings = settings) -> None:
        self.config = config
        # Domain-separated subkey for signing OAuth ``state`` (never the raw JWT
        # secret). State is short-lived (minutes), so switching its derivation is
        # safe with no migration — any state signed under the old key simply
        # fails validation and the user retries the redirect.
        self._key = key_derivation.oauth_state_key(config.JWT_SECRET_KEY)

    @staticmethod
    def _encode_part(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

    @staticmethod
    def _decode_part(encoded: str) -> bytes:
        padded = encoded + ("=" * ((4 - len(encoded) % 4) % 4))
        return base64.urlsafe_b64decode(padded.encode("utf-8"))

    def _signature(self, payload_json: bytes) -> str:
        digest = bytes.fromhex(key_derivation.hmac_sha256_hex(self._key, payload_json.decode("utf-8")))
        return self._encode_part(digest)

    def encode(
        self,
        *,
        origin: str,
        redirect: str,
        action: str,
        provider: str,
        csrf: str,
        guard_hash: str | None = None,
    ) -> str:
        """Build a signed, short-lived OAuth ``state`` carrying the originating
        host, post-auth redirect path, and action (``login``/``link``)
        alongside the provider.

        ``csrf`` is the RAW CSRF cookie token (never the hash) that was live
        in the browser that is about to start this flow; only its SHA-256 hex
        digest is stored in the payload (short key ``"c"``) -- the raw value
        itself is never persisted, signed into anything retrievable, or
        logged. This is what lets the flow layer bind the eventual callback
        to the SAME browser: an attacker can trigger the authorization-URL
        call for themselves and obtain a validly-signed ``state``, but cannot
        read the victim's HttpOnly cookie, so they cannot produce a ``csrf``
        value whose hash matches this one.

        ``guard_hash`` is OPTIONAL and, when given, is stored verbatim under
        the short key ``"lg"`` -- it is ALREADY a hash (``sha256_hex`` of the
        raw ``owt_xdomain_guard`` cookie, computed by the frontend before this
        call), never a raw secret, so unlike ``csrf`` there is nothing further
        to hash here. Omitted entirely (no ``"lg"`` key at all) when absent,
        which is the case for every flow that never bounced through a custom
        domain (see ``oauth-login.ts``) -- ``verify`` surfaces that as
        ``guard_hash=None``, and downstream ticket issuance treats that as
        "no cross-domain ticket may be issued" (fail closed).

        Pure and Redis/DB-free: the returned string is fully self-contained
        (``base64url(json) + "." + base64url(hmac)``), so it round-trips
        through any provider's redirect with no shared storage, and
        ``verify`` can check it with nothing but the signing key. Nonce
        single-use / replay protection is enforced separately by the caller
        that has access to Redis (the flow layer's ``callback``) -- keeping
        this method unit-testable without any infra.
        """
        now_ts = int(datetime.now(UTC).timestamp())
        ttl_seconds = max(self.config.OAUTH_STATE_EXPIRE_MINUTES, 1) * 60
        payload: dict[str, str | int] = {
            "o": origin,
            "r": redirect,
            "a": action,
            "p": provider,
            "n": self._encode_part(secrets.token_bytes(24)),
            "e": now_ts + ttl_seconds,
            "c": guard_digest(csrf),
        }
        if guard_hash is not None:
            payload["lg"] = guard_hash
        payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return f"{self._encode_part(payload_json)}.{self._signature(payload_json)}"

    def verify(self, state: str) -> StatePayload:
        """Verify a signed OAuth ``state`` and decode its payload.

        Pure and Redis/DB-free: checks the HMAC signature (constant-time
        comparison) and the embedded expiry only. Raises ``ValueError`` if
        the state is missing, malformed, tampered with, or expired -- never
        ``HTTPException``, so this stays usable from a plain unit test.
        Nonce single-use / replay protection is intentionally NOT enforced
        here; the caller must consume ``StatePayload.nonce`` itself (the flow
        layer's ``callback``). Likewise, this method only returns the stored
        ``csrf``/``guard_hash`` hashes -- it does NOT compare either against
        anything, since that requires the raw cookie values which only the
        RPC-layer caller has access to. Both are surfaced only AFTER the HMAC
        signature above is verified -- never trust an unverified payload's
        fields.
        """
        if not state or not isinstance(state, str):
            raise ValueError("state is required")

        try:
            encoded_payload, signature = state.split(".", maxsplit=1)
            payload_json = self._decode_part(encoded_payload)

            expected_signature = self._signature(payload_json)
            if not hmac.compare_digest(signature, expected_signature):
                raise ValueError("invalid state signature")

            payload = json.loads(payload_json)
            exp = int(payload["e"])
            now_ts = int(datetime.now(UTC).timestamp())
            if now_ts > exp:
                raise ValueError("state expired")

            guard_hash = payload.get("lg")
            return StatePayload(
                origin=str(payload["o"]),
                redirect=str(payload["r"]),
                action=str(payload["a"]),
                provider=str(payload["p"]),
                nonce=str(payload["n"]),
                exp=exp,
                csrf=str(payload["c"]),
                guard_hash=str(guard_hash) if guard_hash is not None else None,
            )
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("malformed OAuth state") from exc


oauth_state = OAuthStateCodec()
