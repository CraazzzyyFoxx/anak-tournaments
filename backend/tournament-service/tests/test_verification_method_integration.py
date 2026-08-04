"""The verification method, end to end against a real Postgres.

Skipped unless ``SUBSCRIPTIONS_IT_DSN`` is set. The unit tests cover each rule in
isolation; these prove the two states that were UNREACHABLE before the picker
existed actually work once config, cache and gate are wired together:

- **Code-only used to admit everybody.** No Discord server meant the live path
  answered ``guild_not_configured`` → ``unknown`` → fail open. Here an unredeemed
  patron must be a *refusal* and the composed gate must block.
- **Live-only could not revoke a code.** A redeemed code is deliberately never
  re-polled, so only rejecting it by source can take it away.

Only the live provider call is faked (there is no Discord guild in CI); the config
blob, the entitlement cache, the redemption and the composition are all real.

Run::

    SUBSCRIPTIONS_IT_DSN=postgresql+psycopg://user:pw@127.0.0.1:15432/anak_dev \\
        uv run pytest tournament-service/tests/test_verification_method_integration.py -v
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa

DSN = os.environ.get("SUBSCRIPTIONS_IT_DSN")

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

for _key, _value in {
    "POSTGRES_HOST": "localhost",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "tournament_test",
    "POSTGRES_USER": "postgres",
    "POSTGRES_PASSWORD": "postgres",
    "JWT_SECRET_KEY": "test-secret",
    "REDIS_URL": "redis://localhost:6379",
}.items():
    os.environ.setdefault(_key, _value)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

CODE = "integration-method-secret"
ROLE = "9876543210987654321"


class _LiveSignalAlwaysActive:
    """Stands in for Discord/Twitch: always answers "subscribed at tier 3"."""

    def __init__(self) -> None:
        self.calls = 0

    async def resolve_many(self, *, config, auth_user_ids):
        from shared.subscriptions import SubscriptionSource, SubscriptionState, SubscriptionVerdict

        self.calls += 1
        now = datetime.now(UTC)
        return {
            uid: SubscriptionVerdict(
                state=SubscriptionState.ACTIVE,
                tier_rank=3,
                tier_label="L3",
                source=SubscriptionSource.DISCORD_ROLE,
                checked_at=now,
                expires_at=now + timedelta(seconds=900),
                evidence={"reason": "matched_role"},
            )
            for uid in auth_user_ids
        }


@unittest.skipUnless(DSN, "set SUBSCRIPTIONS_IT_DSN to run verification-method integration tests")
class TestVerificationMethodEndToEnd(IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        self._engine = create_async_engine(DSN, connect_args={"connect_timeout": 20})
        self._session = async_sessionmaker(self._engine, expire_on_commit=False)()
        self.ws = (await self._session.execute(sa.text("select id from workspace order by id limit 1"))).scalar()
        self.uid = (await self._session.execute(sa.text("select id from auth.user order by id limit 1"))).scalar()
        if self.ws is None or self.uid is None:
            self.skipTest("target database has no workspace/user to anchor the FKs")
        await self._wipe()

    async def asyncTearDown(self) -> None:
        await self._wipe()
        await self._session.close()
        await self._engine.dispose()

    async def _wipe(self) -> None:
        for table in ("subscriptions.entitlement", "subscriptions.provider_config"):
            await self._session.execute(sa.text(f"delete from {table} where workspace_id = :w"), {"w": self.ws})
        await self._session.commit()

    async def _configure(self, method: str, *, with_codes: bool, with_roles: bool = True) -> None:
        from src.schemas.registration import SubscriptionProviderConfigUpsert
        from src.services.registration import subscription_config

        body: dict = {"provider": "boosty", "enabled": True, "verification_method": method}
        if with_roles:
            body["role_tiers"] = [{"role_id": ROLE, "tier_rank": 2}]
        body["codes"] = [{"code": CODE, "tier_rank": 2}] if with_codes else []
        await subscription_config.upsert_provider_config(
            self._session, workspace_id=self.ws, body=SubscriptionProviderConfigUpsert(**body)
        )

    def _resolver(self, strategy):
        from shared.services.subscription_entitlements import SubscriptionResolver
        from shared.services.subscription_store import SqlEntitlementStore

        return SubscriptionResolver(store=SqlEntitlementStore(self._session), strategies={"boosty": strategy})

    async def _resolve(self, strategy):
        result = await self._resolver(strategy).resolve(
            workspace_id=self.ws, auth_user_ids=[self.uid], providers=["boosty"]
        )
        return result[self.uid]["boosty"]

    async def _redeem(self):
        from shared.services.subscription_store import SqlEntitlementStore
        from src.services.registration.subscription_codes import redeem_challenge_code

        return await redeem_challenge_code(
            store=SqlEntitlementStore(self._session),
            workspace_id=self.ws,
            auth_user_id=self.uid,
            provider="boosty",
            submitted_code=CODE,
        )

    async def test_method_round_trips_and_the_code_stays_hashed(self):
        from src.services.registration import subscription_config

        await self._configure("code", with_codes=True)
        listed = await subscription_config.list_provider_configs(self._session, self.ws)
        boosty = next(c for c in listed.configs if c.provider == "boosty")
        assert boosty.verification_method == "code"

        raw = (
            await self._session.execute(
                sa.text(
                    "select config_json::text from subscriptions.provider_config "
                    "where workspace_id = :w and provider = 'boosty'"
                ),
                {"w": self.ws},
            )
        ).scalar()
        assert CODE not in raw

    async def test_code_only_refuses_an_unredeemed_patron_without_polling(self):
        """The regression: this used to be `unknown`, which fails open."""
        from shared.subscriptions import SubscriptionState

        await self._configure("code", with_codes=True)
        strategy = _LiveSignalAlwaysActive()

        verdict = await self._resolve(strategy)

        assert verdict.state == SubscriptionState.INACTIVE
        assert verdict.evidence["reason"] == "no_code_redeemed"
        assert strategy.calls == 0

    async def test_the_composed_gate_therefore_blocks(self):
        from shared.subscriptions import parse_requirement

        await self._configure("code", with_codes=True)
        requirement = parse_requirement({"mode": "any", "requirements": [{"provider": "boosty", "min_tier_rank": 1}]})

        outcomes = await self._resolver(_LiveSignalAlwaysActive()).evaluate(
            workspace_id=self.ws, auth_user_ids=[self.uid], requirement=requirement
        )

        assert outcomes[self.uid][0].value == "refused"

    async def test_redeeming_satisfies_code_only(self):
        from shared.subscriptions import SubscriptionSource, SubscriptionState

        await self._configure("code", with_codes=True)
        assert (await self._redeem()).tier_rank == 2

        verdict = await self._resolve(_LiveSignalAlwaysActive())

        assert verdict.state == SubscriptionState.ACTIVE
        assert verdict.source == SubscriptionSource.CHALLENGE_CODE

    async def test_switching_to_live_only_revokes_a_redeemed_code(self):
        """A code is never re-polled, so only source rejection can take it away."""
        from shared.subscriptions import SubscriptionSource

        await self._configure("code", with_codes=True)
        await self._redeem()

        await self._configure("live", with_codes=True)
        strategy = _LiveSignalAlwaysActive()
        verdict = await self._resolve(strategy)

        assert strategy.calls == 1, "the live signal must be consulted instead"
        assert verdict.source == SubscriptionSource.DISCORD_ROLE
        assert verdict.tier_rank == 3

    async def test_live_only_rejects_a_correct_code_at_the_door(self):
        from shared.core.errors import BaseAPIException

        await self._configure("live", with_codes=True)

        with self.assertRaises(BaseAPIException) as caught:
            await self._redeem()

        assert caught.exception.status_code == 400
        assert "не кодом" in str(caught.exception.detail)

    async def test_code_only_with_no_codes_fails_open(self):
        from shared.subscriptions import SubscriptionState

        await self._configure("code", with_codes=False)

        verdict = await self._resolve(_LiveSignalAlwaysActive())

        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "no_codes_configured"

    async def test_either_polls_and_still_accepts_a_code(self):
        from shared.subscriptions import SubscriptionState

        await self._configure("any", with_codes=True)
        strategy = _LiveSignalAlwaysActive()
        assert (await self._resolve(strategy)).state == SubscriptionState.ACTIVE
        assert strategy.calls == 1

        await self._session.execute(
            sa.text("delete from subscriptions.entitlement where workspace_id = :w"), {"w": self.ws}
        )
        await self._session.commit()
        assert (await self._redeem()).state == SubscriptionState.ACTIVE

    async def test_a_config_predating_the_field_behaves_as_either(self):
        """Nothing configured before this feature may change behaviour on deploy."""
        from src.services.registration import subscription_config

        await self._configure("live", with_codes=True)
        # `config_json` is `json`, not `jsonb`, so the delete operator needs a cast.
        await self._session.execute(
            sa.text(
                "update subscriptions.provider_config set config_json = "
                "(config_json::jsonb - 'verification_method')::json "
                "where workspace_id = :w and provider = 'boosty'"
            ),
            {"w": self.ws},
        )
        await self._session.commit()

        listed = await subscription_config.list_provider_configs(self._session, self.ws)
        boosty = next(c for c in listed.configs if c.provider == "boosty")
        assert boosty.verification_method == "any"

        strategy = _LiveSignalAlwaysActive()
        await self._resolve(strategy)
        assert strategy.calls == 1
        assert (await self._redeem()).state == "active"
