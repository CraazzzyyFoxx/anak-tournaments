"""Integration coverage for ``SqlEntitlementStore`` against a real Postgres.

Skipped unless ``SUBSCRIPTIONS_IT_DSN`` is set, so the default suite stays
database-free. The unit tests inject a fake store and can therefore never catch
the things that only real Postgres has an opinion about:

- the ``on_conflict`` upsert actually resolving to an UPDATE on
  ``uq_subscription_entitlement_scope`` rather than inserting a duplicate,
- JSON columns round-tripping ``evidence`` unchanged,
- ``timestamptz`` columns coming back **tz-aware** (a naive value would break the
  TTL comparison in the resolver and silently make every row look stale),
- the schema-qualified table names resolving at all.

Run against a scratch/dev database, e.g.::

    SUBSCRIPTIONS_IT_DSN=postgresql+psycopg://user:pw@127.0.0.1:15432/anak_dev \\
        uv run pytest shared/tests/test_subscription_store_integration.py -v

Every row this creates is deleted again in ``asyncTearDown``.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa

DSN = os.environ.get("SUBSCRIPTIONS_IT_DSN")

# Windows defaults to ProactorEventLoop, which psycopg's async mode refuses.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def _verdict(state, tier, source, evidence):
    from shared.subscriptions import SubscriptionVerdict

    now = datetime.now(UTC)
    return SubscriptionVerdict(
        state=state,
        tier_rank=tier,
        tier_label=f"L{tier}" if tier else None,
        source=source,
        checked_at=now,
        expires_at=now + timedelta(minutes=15),
        evidence=evidence,
    )


@unittest.skipUnless(DSN, "set SUBSCRIPTIONS_IT_DSN to run store integration tests")
class TestSqlEntitlementStore(IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from shared.services.subscription_store import SqlEntitlementStore

        self._engine = create_async_engine(DSN)
        self._session = async_sessionmaker(self._engine, expire_on_commit=False)()
        self.store = SqlEntitlementStore(self._session)

        # Real FKs need a real workspace and auth user.
        self.ws = (await self._session.execute(sa.text("select id from workspace order by id limit 1"))).scalar()
        self.au = (await self._session.execute(sa.text('select id from auth."user" order by id limit 1'))).scalar()
        if self.ws is None or self.au is None:
            self.skipTest("target database has no workspace / auth user to anchor FKs")

    async def asyncTearDown(self) -> None:
        await self._session.execute(
            sa.text("delete from subscriptions.entitlement where workspace_id=:w and auth_user_id=:u"),
            {"w": self.ws, "u": self.au},
        )
        await self._session.execute(
            sa.text("delete from subscriptions.provider_config where workspace_id=:w and provider='boosty'"),
            {"w": self.ws},
        )
        await self._session.commit()
        await self._session.close()
        await self._engine.dispose()

    async def _configure_boosty(self) -> None:
        await self._session.execute(
            sa.text(
                "insert into subscriptions.provider_config "
                "(workspace_id, provider, enabled, config_json) "
                "values (:ws,'boosty',true,'{\"guild_id\":\"999\"}') "
                "on conflict on constraint uq_subscription_config_workspace_provider "
                "do update set enabled=true"
            ),
            {"ws": self.ws},
        )
        await self._session.commit()

    async def test_empty_reads_touch_nothing(self):
        assert await self.store.load_configs(self.ws, []) == {}
        assert await self.store.load_entitlements(self.ws, [], ["boosty"]) == {}
        assert await self.store.load_entitlements(self.ws, [self.au], []) == {}

    async def test_load_configs_returns_only_configured_providers(self):
        await self._configure_boosty()
        configs = await self.store.load_configs(self.ws, ["boosty", "twitch"])
        assert set(configs) == {"boosty"}
        assert configs["boosty"].enabled is True
        assert configs["boosty"].config["guild_id"] == "999"

    async def test_upsert_then_load_round_trips(self):
        await self.store.upsert(
            self.ws, self.au, "boosty", _verdict("active", 2, "discord_role", {"matched_role_id": "200"})
        )
        await self._session.commit()

        rows = await self.store.load_entitlements(self.ws, [self.au], ["boosty", "twitch"])
        assert list(rows) == [(self.au, "boosty")]
        row = rows[(self.au, "boosty")]
        assert (row.state, row.tier_rank, row.source) == ("active", 2, "discord_role")
        assert row.evidence["matched_role_id"] == "200"

    async def test_timestamps_come_back_timezone_aware(self):
        """A naive value here would make the resolver read every row as stale."""
        await self.store.upsert(self.ws, self.au, "boosty", _verdict("active", 1, "discord_role", {}))
        await self._session.commit()
        row = (await self.store.load_entitlements(self.ws, [self.au], ["boosty"]))[(self.au, "boosty")]
        assert row.checked_at is not None and row.checked_at.tzinfo is not None
        assert row.expires_at is not None and row.expires_at.tzinfo is not None

    async def test_second_upsert_updates_in_place(self):
        """The unique constraint path: one row per (workspace, user, provider)."""
        await self.store.upsert(self.ws, self.au, "boosty", _verdict("active", 2, "discord_role", {}))
        await self.store.upsert(
            self.ws,
            self.au,
            "boosty",
            _verdict("inactive", None, "discord_role", {"reason": "no_mapped_role"}),
        )
        await self._session.commit()

        count = (
            await self._session.execute(
                sa.text(
                    "select count(*) from subscriptions.entitlement "
                    "where workspace_id=:w and auth_user_id=:u and provider='boosty'"
                ),
                {"w": self.ws, "u": self.au},
            )
        ).scalar()
        assert count == 1

        row = (await self.store.load_entitlements(self.ws, [self.au], ["boosty"]))[(self.au, "boosty")]
        assert row.state == "inactive"
        assert row.tier_rank is None, "an update must clear a previously set tier"
        assert row.evidence["reason"] == "no_mapped_role"

    async def test_stored_row_converts_to_a_verdict(self):
        await self.store.upsert(self.ws, self.au, "boosty", _verdict("active", 3, "challenge_code", {}))
        await self._session.commit()
        row = (await self.store.load_entitlements(self.ws, [self.au], ["boosty"]))[(self.au, "boosty")]
        verdict = row.to_verdict()
        assert verdict.state == "active"
        assert verdict.tier_rank == 3
        assert verdict.source == "challenge_code"
