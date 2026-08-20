"""Password hashing and token minting — pure crypto, no database, no Redis.

Kept free of I/O on purpose: every other service depends on this module, so it
must stay at the bottom of the dependency graph.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import bcrypt
from jose import JWTError, jwt
from loguru import logger

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from src.core import config, key_derivation

__all__ = ["PasswordHasher", "TokenCodec", "passwords", "token_codec"]

settings = config.settings


class PasswordHasher:
    """bcrypt password hashing."""

    @staticmethod
    def hash(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    @staticmethod
    def verify(plain_password: str, hashed_password: str) -> bool:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


class TokenCodec:
    """JWT minting/decoding plus the domain-separated refresh-token hashes."""

    def __init__(self, config: Any = settings) -> None:
        self._config = config
        # Domain-separated subkey for refresh-token HMAC (never the raw JWT
        # secret). Derived once: HKDF is pure but not free, and the master
        # secret cannot change without a restart.
        self._refresh_key = key_derivation.refresh_token_key(config.JWT_SECRET_KEY)

    @property
    def access_token_ttl_seconds(self) -> int:
        """Seconds a freshly issued access token remains valid (blacklist TTL)."""
        return max(int(self._config.ACCESS_TOKEN_EXPIRE_MINUTES), 1) * 60

    def _encode(self, claims: dict, *, expire: datetime, token_type: str) -> str:
        to_encode = claims.copy()
        to_encode.update({"exp": expire, "type": token_type})
        return jwt.encode(to_encode, self._config.JWT_SECRET_KEY, algorithm=self._config.JWT_ALGORITHM)

    def access_token(self, claims: dict, *, expires_delta: timedelta | None = None) -> str:
        """Mint a user access token carrying RBAC data."""
        delta = expires_delta or timedelta(minutes=self._config.ACCESS_TOKEN_EXPIRE_MINUTES)
        return self._encode(claims, expire=datetime.now(UTC) + delta, token_type="access")

    def service_token(self, claims: dict, *, expires_delta: timedelta | None = None) -> str:
        """Mint a machine-to-machine service token."""
        delta = expires_delta or timedelta(minutes=self._config.SERVICE_ACCESS_TOKEN_EXPIRE_MINUTES)
        return self._encode(claims, expire=datetime.now(UTC) + delta, token_type="service")

    def decode(self, token: str) -> dict:
        """Decode and validate a JWT, or raise 401."""
        try:
            return jwt.decode(
                token,
                self._config.JWT_SECRET_KEY,
                algorithms=[self._config.JWT_ALGORITHM],
                options={"verify_aud": False},
            )
        except JWTError as e:
            logger.warning(f"Token decode error: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            ) from e

    @staticmethod
    def new_refresh_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def new_session() -> tuple[UUID, datetime]:
        """A logical-session identifier reused across refresh rotation."""
        return uuid4(), datetime.now(UTC)

    def hash_refresh_token(self, token: str) -> str:
        """Hash a refresh token for persistence/lookup.

        Uses an HKDF-derived subkey (domain-separated from the JWT signing
        secret). Lookups accept the legacy raw-secret hash too — see
        ``refresh_token_hashes`` — so tokens issued before domain separation
        keep working without a migration or forced re-login.
        """
        return key_derivation.hmac_sha256_hex(self._refresh_key, token)

    def refresh_token_hashes(self, token: str) -> list[str]:
        """New (derived) plus legacy (raw-secret) hash of a refresh token.

        New tokens are always written with the derived hash; this list lets a
        lookup still match tokens persisted under the pre-domain-separation
        HMAC. They migrate to the derived hash naturally on the next rotation.
        """
        new_hash = key_derivation.hmac_sha256_hex(self._refresh_key, token)
        legacy_hash = key_derivation.legacy_hmac_sha256_hex(self._config.JWT_SECRET_KEY, token)
        if new_hash == legacy_hash:
            return [new_hash]
        return [new_hash, legacy_hash]

    @staticmethod
    def client_metadata(request: Any | None) -> tuple[str | None, str | None]:
        """Extract original client metadata, preferring proxy-forwarded headers."""
        if request is None:
            return None, None

        headers = request.headers

        user_agent = headers.get("x-original-user-agent") or headers.get("user-agent")

        forwarded_for = headers.get("x-forwarded-for") or headers.get("x-vercel-forwarded-for")
        ip_address = None
        if forwarded_for:
            for candidate in forwarded_for.split(","):
                candidate = candidate.strip()
                if candidate and candidate.lower() != "unknown":
                    ip_address = candidate
                    break

        if ip_address is None:
            ip_address = (
                headers.get("x-real-ip")
                or headers.get("cf-connecting-ip")
                or headers.get("true-client-ip")
                or headers.get("x-client-ip")
                or (request.client.host if request.client else None)
            )

        return user_agent, ip_address


passwords = PasswordHasher()
token_codec = TokenCodec()
