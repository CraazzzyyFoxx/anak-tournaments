"""Workspace-level subscription provider configuration.

Minimal admin surface: raw ids typed by hand. Resolving Discord role names through
the API and offering a picker is a deliberate follow-up, not part of this.

Two rules carry the weight here:

- **Plaintext codes are never persisted.** The admin types a code, the server keeps
  only its SHA-256, and the read model returns neither the code nor the digest — a
  digest is still brute-forcible offline, so the UI learns only that a code exists,
  at which tier, and until when.
- **Omitting a field keeps what is stored.** The admin cannot see existing codes,
  so a plain save must not wipe them. Passing an explicit list replaces them.
- **The verification method is authoritative over the cache, not just the call.**
  Narrowing it invalidates stored entitlements whose source it no longer accepts —
  see ``shared.subscriptions.verification`` for why that is load-bearing.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core.social import SocialProvider
from shared.subscriptions import parse_verification_method
from shared.subscriptions.challenge_code import hash_code
from src.schemas.registration import (
    ChallengeCodeRead,
    RoleTierRead,
    SubscriptionProviderConfigListResponse,
    SubscriptionProviderConfigRead,
    SubscriptionProviderConfigUpsert,
)

__all__ = (
    "CONFIGURABLE_PROVIDERS",
    "build_config_json",
    "list_provider_configs",
    "serialize_provider_config",
    "upsert_provider_config",
)

CONFIGURABLE_PROVIDERS = (SocialProvider.BOOSTY, SocialProvider.TWITCH)


def build_config_json(body: SubscriptionProviderConfigUpsert, *, existing: dict[str, Any]) -> dict[str, Any]:
    """Merge an upsert over the stored blob.

    ``None`` means "not supplied, keep what is there"; an explicit value (including
    an empty string or empty list) replaces it.
    """
    config = dict(existing)

    if body.guild_id is not None:
        config["guild_id"] = body.guild_id.strip()
    if body.broadcaster_id is not None:
        config["broadcaster_id"] = body.broadcaster_id.strip()
    if body.broadcaster_login is not None:
        config["broadcaster_login"] = body.broadcaster_login.strip()
    if body.verification_method is not None:
        config["verification_method"] = body.verification_method

    if body.role_tiers is not None:
        config["role_tiers"] = [
            {
                # Kept as a string: a Discord snowflake exceeds 2**53.
                "role_id": row.role_id.strip(),
                "tier_rank": row.tier_rank,
                "tier_label": row.tier_label,
            }
            for row in body.role_tiers
        ]

    if body.codes is not None:
        config["codes"] = [
            {
                # Plaintext is hashed here and dropped; only the digest is stored.
                "code_sha256": row.code_sha256 or hash_code(row.code),
                "tier_rank": row.tier_rank,
                "tier_label": row.tier_label,
                "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            }
            for row in body.codes
        ]

    return config


def serialize_provider_config(row: Any) -> SubscriptionProviderConfigRead:
    config = row.config_json or {}
    return SubscriptionProviderConfigRead(
        provider=row.provider,
        enabled=bool(row.enabled),
        guild_id=config.get("guild_id") or None,
        role_tiers=[
            RoleTierRead(
                role_id=str(entry.get("role_id") or ""),
                tier_rank=int(entry.get("tier_rank") or 1),
                tier_label=str(entry.get("tier_label") or ""),
            )
            for entry in config.get("role_tiers") or []
            if entry.get("role_id")
        ],
        broadcaster_id=config.get("broadcaster_id") or None,
        broadcaster_login=config.get("broadcaster_login") or None,
        # Redacted on purpose: neither the code nor its digest leaves the server.
        codes=[
            ChallengeCodeRead(
                tier_rank=int(entry.get("tier_rank") or 1),
                tier_label=str(entry.get("tier_label") or ""),
                expires_at=entry.get("expires_at"),
            )
            for entry in config.get("codes") or []
        ],
        # Through the runtime parser, not the raw blob: a stored value the code no
        # longer knows must read back as `any`, matching what the gate will do.
        verification_method=parse_verification_method(config),
    )


async def list_provider_configs(session: AsyncSession, workspace_id: int) -> SubscriptionProviderConfigListResponse:
    """Every configurable provider, present or not.

    Providers with no row are returned disabled and empty, so the admin UI renders
    one card per provider without inventing placeholder rows in the database.
    """
    rows = (
        (
            await session.execute(
                sa.select(models.SubscriptionProviderConfig).where(
                    models.SubscriptionProviderConfig.workspace_id == workspace_id
                )
            )
        )
        .scalars()
        .all()
    )
    by_provider = {row.provider: row for row in rows}
    configs = [
        serialize_provider_config(by_provider[provider])
        if provider in by_provider
        else SubscriptionProviderConfigRead(provider=provider, enabled=False)
        for provider in CONFIGURABLE_PROVIDERS
    ]
    return SubscriptionProviderConfigListResponse(configs=configs)


async def upsert_provider_config(
    session: AsyncSession,
    *,
    workspace_id: int,
    body: SubscriptionProviderConfigUpsert,
) -> SubscriptionProviderConfigRead:
    """Create or update one provider's config. Commits internally."""
    existing = (
        await session.execute(
            sa.select(models.SubscriptionProviderConfig).where(
                models.SubscriptionProviderConfig.workspace_id == workspace_id,
                models.SubscriptionProviderConfig.provider == body.provider,
            )
        )
    ).scalar_one_or_none()

    config_json = build_config_json(body, existing=(existing.config_json or {}) if existing else {})

    stmt = pg_insert(models.SubscriptionProviderConfig).values(
        workspace_id=workspace_id,
        provider=body.provider,
        enabled=body.enabled,
        config_json=config_json,
    )
    await session.execute(
        stmt.on_conflict_do_update(
            constraint="uq_subscription_config_workspace_provider",
            set_={
                "enabled": stmt.excluded.enabled,
                "config_json": stmt.excluded.config_json,
                "updated_at": sa.func.now(),
            },
        )
    )
    await session.commit()

    # `populate_existing` is load-bearing, not decoration: the INSERT ... ON
    # CONFLICT above changes the row behind the ORM's back, so a plain SELECT would
    # be served from the identity map and return the PRE-upsert `config_json`. That
    # silently made an explicit `codes: []` look like it had not cleared anything.
    row = (
        await session.execute(
            sa.select(models.SubscriptionProviderConfig)
            .where(
                models.SubscriptionProviderConfig.workspace_id == workspace_id,
                models.SubscriptionProviderConfig.provider == body.provider,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return serialize_provider_config(row)
