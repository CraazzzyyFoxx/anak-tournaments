"""Domain-separated key derivation for the identity service.

Derives a distinct 32-byte subkey per purpose (refresh-token hashing, OAuth
``state`` signing, API-key secret hashing) from the master secret with
HKDF-SHA256 (RFC 5869, stdlib ``hashlib`` + ``hmac``). One key shared across
domains means a weakness or leak in any one usage compromises all of them and
opens cross-protocol confusion attacks.

Notes:
  * The **access/service JWT** keeps signing with the raw master secret, because
    the Go gateway validates those tokens locally with the same raw secret.
    Deriving a JWT subkey here would invalidate every issued token and break
    edge validation. JWTs therefore remain the master key's single "raw" use.
  * Refresh-token and API-key hashes are verified against BOTH the derived and
    the raw-secret HMAC (``legacy_hmac_sha256_hex``) but written only in the
    derived form, so already-persisted hashes keep verifying.
"""

from __future__ import annotations

import hashlib
import hmac

# Bump the version suffix if a subkey ever needs rotation independent of the
# master secret.
_INFO_REFRESH_TOKEN = b"anak-identity:refresh-token:v1"
_INFO_OAUTH_STATE = b"anak-identity:oauth-state:v1"
_INFO_API_KEY = b"anak-identity:api-key:v1"

_HASH = hashlib.sha256
_HASH_LEN = _HASH().digest_size  # 32


def _hkdf(ikm: bytes, info: bytes, length: int = _HASH_LEN, salt: bytes = b"") -> bytes:
    """RFC 5869 HKDF-SHA256 (extract + expand)."""
    if not salt:
        salt = b"\x00" * _HASH_LEN
    prk = hmac.new(salt, ikm, _HASH).digest()  # extract
    okm = b""
    block = b""
    counter = 1
    while len(okm) < length:
        block = hmac.new(prk, block + info + bytes([counter]), _HASH).digest()  # expand
        okm += block
        counter += 1
    return okm[:length]


def derive_key(master_secret: str, info: bytes) -> bytes:
    """Derive a purpose-bound subkey from the master secret."""
    return _hkdf(master_secret.encode("utf-8"), info)


def refresh_token_key(master_secret: str) -> bytes:
    return derive_key(master_secret, _INFO_REFRESH_TOKEN)


def oauth_state_key(master_secret: str) -> bytes:
    return derive_key(master_secret, _INFO_OAUTH_STATE)


def api_key_secret_key(master_secret: str) -> bytes:
    return derive_key(master_secret, _INFO_API_KEY)


def hmac_sha256_hex(key: bytes, message: str) -> str:
    return hmac.new(key, message.encode("utf-8"), _HASH).hexdigest()


def legacy_hmac_sha256_hex(master_secret: str, message: str) -> str:
    """HMAC keyed with the raw master secret; verify-only.

    Matches refresh-token / API-key hashes persisted with the raw secret; never
    used for new writes.
    """
    return hmac.new(master_secret.encode("utf-8"), message.encode("utf-8"), _HASH).hexdigest()
