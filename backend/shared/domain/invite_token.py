"""Invite tokens for team registration.

Redeeming one of these creates a registration bound to the redeemer's account
inside a third party's roster and consumes a roster slot. That puts it in the same
tier as ``auth.api_key.secret_hash`` — high entropy, hashed at rest, compared in
constant time — and explicitly NOT in the tier of a scrim room's shareable
address, which is stored raw because it only addresses a room.

The raw token is returned exactly once, by :func:`generate_invite_token`. Nothing
persists it; only :func:`hash_invite_token` output is stored.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

__all__ = (
    "INVITE_TOKEN_BYTES",
    "generate_invite_token",
    "hash_invite_token",
    "tokens_match",
)

#: 32 bytes = 256 bits of entropy, matching ``secrets.token_hex(32)`` as used for
#: API keys. ``token_urlsafe`` because the value travels in a link.
INVITE_TOKEN_BYTES = 32


def hash_invite_token(raw_token: str) -> str:
    """Hex ``sha256`` of a raw token — the only form that is ever stored.

    Plain sha256 rather than a password KDF on purpose: the input is 256 bits of
    machine-generated entropy, so there is nothing to brute-force and no salt to
    add. This matches ``shared/services/subscriptions/challenge_code.py`` and the OAuth
    state store.
    """
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_invite_token() -> tuple[str, str]:
    """``(raw_token, token_sha256)``. The raw value is shown once and never stored."""
    raw = secrets.token_urlsafe(INVITE_TOKEN_BYTES)
    return raw, hash_invite_token(raw)


def tokens_match(raw_token: str, stored_hash: str) -> bool:
    """Constant-time comparison of a presented token against a stored hash.

    Callers normally look the invite up *by* hash (the partial unique index makes
    that a single indexed read); this exists for the paths that already hold a row
    and must not leak a timing signal while confirming it.
    """
    return hmac.compare_digest(hash_invite_token(raw_token), stored_hash)
