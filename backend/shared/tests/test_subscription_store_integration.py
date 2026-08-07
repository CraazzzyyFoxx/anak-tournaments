"""Integration coverage for ``SqlEntitlementStore`` against a real Postgres.

Skipped unless ``SUBSCRIPTIONS_IT_DSN`` is set, so the default suite stays
database-free. The unit tests inject a fake store and can therefore never catch
the things that only real Postgres has an opinion about:

- the ``on_conflict`` upsert actually resolving to an UPDATE on
  ``uq_subscription_entitlement_scope`` rather than inserting a duplicate,
- JSON columns round-tripping ``evidence`` unchanged,
- ``timestamptz`` columns coming back **tz-aware** (a naive value would break the
  TTL comparison in the resolver and silently make every row look stale),
- the schema-qualified table names resolving at all,
- the join onto ``workspace`` that sources ``guild_id``: the provider blob no
  longer carries one, and a stale key left inside ``config_json`` must lose to
  the workspace column,
- the default-row predicate in ``load_requirement`` selecting the right row and
  the ``json`` column round-tripping the rule unchanged.

Run against a scratch/dev database, e.g.::

    SUBSCRIPTIONS_IT_DSN=postgresql+psycopg://user:pw@127.0.0.1:15432/anak_dev \\
        uv run pytest shared/tests/test_subscription_store_integration.py -v

Every row this creates is deleted again in ``asyncTearDown``, and the workspace's
``discord_guild_id`` -- which these tests mutate in place -- is restored there.
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

        # Real FKs need a real workspace and two auth users (upsert_many needs
        # more than one row to prove it, not just parse).
        self.ws = (await self._session.execute(sa.text("select id from workspace order by id limit 1"))).scalar()
        user_rows = (
            await self._session.execute(sa.text('select id from auth."user" order by id limit 2'))
        ).scalars().all()
        if self.ws is None or not user_rows:
            self.skipTest("target database has no workspace / auth user to anchor FKs")
        self.au = user_rows[0]
        self.au2 = user_rows[1] if len(user_rows) > 1 else None

        # Snapshot: this suite mutates a real workspace row and must put it back.
        self._guild_before = (
            await self._session.execute(sa.text("select discord_guild_id from workspace where id=:w"), {"w": self.ws})
        ).scalar()

    async def asyncTearDown(self) -> None:
        au_ids = [self.au] + ([self.au2] if self.au2 is not None else [])
        await self._session.execute(
            sa.text("delete from subscriptions.entitlement where workspace_id=:w and auth_user_id = any(:u)"),
            {"w": self.ws, "u": au_ids},
        )
        await self._session.execute(
            sa.text("delete from subscriptions.provider_config where workspace_id=:w and provider='boosty'"),
            {"w": self.ws},
        )
        await self._session.execute(
            sa.text("update workspace set discord_guild_id=:g where id=:w"),
            {"g": self._guild_before, "w": self.ws},
        )
        await self._session.execute(
            sa.text("delete from subscriptions.requirement where workspace_id=:w"),
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
                "values (:ws,'boosty',true,'{}') "
                "on conflict on constraint uq_subscription_config_workspace_provider "
                "do update set enabled=true"
            ),
            {"ws": self.ws},
        )
        await self._session.commit()

    async def _set_workspace_guild(self, guild_id: str | None) -> None:
        await self._session.execute(
            sa.text("update workspace set discord_guild_id=:g where id=:w"),
            {"g": guild_id, "w": self.ws},
        )
        await self._session.commit()

    async def test_empty_reads_touch_nothing(self):
        assert await self.store.load_configs(self.ws, []) == {}
        assert await self.store.load_entitlements(self.ws, [], ["boosty"]) == {}
        assert await self.store.load_entitlements(self.ws, [self.au], []) == {}

    async def test_load_configs_returns_only_configured_providers(self):
        await self._set_workspace_guild("424242424242424242")
        await self._configure_boosty()
        configs = await self.store.load_configs(self.ws, ["boosty", "twitch"])
        assert set(configs) == {"boosty"}
        assert configs["boosty"].enabled is True
        # The guild comes from the workspace, not from the provider blob.
        assert configs["boosty"].config["guild_id"] == "424242424242424242"

    async def test_a_workspace_without_a_guild_reads_back_as_unconfigured(self):
        """The fail-open path: no guild must reach the resolver as "not set"."""
        await self._set_workspace_guild(None)
        await self._configure_boosty()
        configs = await self.store.load_configs(self.ws, ["boosty"])
        assert configs["boosty"].config["guild_id"] == ""

    async def test_a_stale_blob_guild_cannot_outrank_the_workspace(self):
        """Regression guard for the injection order -- the blob must lose."""
        await self._set_workspace_guild("111111111111111111")
        await self._session.execute(
            sa.text(
                "insert into subscriptions.provider_config "
                "(workspace_id, provider, enabled, config_json) "
                "values (:ws,'boosty',true,'{\"guild_id\":\"999\"}') "
                "on conflict on constraint uq_subscription_config_workspace_provider "
                'do update set config_json=\'{"guild_id":"999"}\''
            ),
            {"ws": self.ws},
        )
        await self._session.commit()
        configs = await self.store.load_configs(self.ws, ["boosty"])
        assert configs["boosty"].config["guild_id"] == "111111111111111111"

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

    async def test_upsert_many_writes_every_user_in_one_round_trip(self):
        """The write side of the resolve() batching fix: one multi-row INSERT
        must resolve conflicts independently per (workspace, user, provider)."""
        if self.au2 is None:
            self.skipTest("target database has only one auth user; need two to prove batching")

        await self.store.upsert_many(
            self.ws,
            "boosty",
            {
                self.au: _verdict("active", 2, "discord_role", {}),
                self.au2: _verdict("inactive", None, "discord_role", {"reason": "no_mapped_role"}),
            },
        )
        await self._session.commit()

        rows = await self.store.load_entitlements(self.ws, [self.au, self.au2], ["boosty"])
        assert rows[(self.au, "boosty")].state == "active"
        assert rows[(self.au, "boosty")].tier_rank == 2
        assert rows[(self.au2, "boosty")].state == "inactive"
        assert rows[(self.au2, "boosty")].evidence["reason"] == "no_mapped_role"

    async def test_upsert_many_second_call_updates_existing_rows_in_place(self):
        await self.store.upsert_many(self.ws, "boosty", {self.au: _verdict("active", 2, "discord_role", {})})
        await self.store.upsert_many(self.ws, "boosty", {self.au: _verdict("inactive", None, "discord_role", {})})
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
        assert row.tier_rank is None

    async def test_upsert_many_with_no_verdicts_touches_nothing(self):
        await self.store.upsert_many(self.ws, "boosty", {})
        await self._session.commit()
        assert await self.store.load_entitlements(self.ws, [self.au], ["boosty"]) == {}

    async def test_stored_row_converts_to_a_verdict(self):
        await self.store.upsert(self.ws, self.au, "boosty", _verdict("active", 3, "challenge_code", {}))
        await self._session.commit()
        row = (await self.store.load_entitlements(self.ws, [self.au], ["boosty"]))[(self.au, "boosty")]
        verdict = row.to_verdict()
        assert verdict.state == "active"
        assert verdict.tier_rank == 3
        assert verdict.source == "challenge_code"

    async def test_load_requirement_round_trips_the_default_row(self):
        """The rule the whole admission stack hangs off, read back out of `json`."""
        assert await self.store.load_requirement(self.ws) is None

        await self._session.execute(
            sa.text(
                "insert into subscriptions.requirement "
                "(workspace_id, name, requirement_json, is_default) "
                "values (:ws,'default',:blob,true)"
            ),
            {"ws": self.ws, "blob": '{"mode":"all","requirements":[{"provider":"boosty","min_tier_rank":2}]}'},
        )
        await self._session.commit()

        blob = await self.store.load_requirement(self.ws)
        assert blob == {"mode": "all", "requirements": [{"provider": "boosty", "min_tier_rank": 2}]}
