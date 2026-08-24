"""End-to-end check-in gate coverage against a real Postgres.

Skipped unless ``SUBSCRIPTIONS_IT_DSN`` is set, so the default suite stays
database-free. The unit tests inject a fake resolver; this exercises the whole
chain — ``provider_config``, ``requirement`` and ``entitlement`` rows in the
``subscriptions`` schema, the resolver, the Kleene composition, and the gate's HTTP
error — on real Postgres.

One behaviour discovered here and worth stating plainly: the gate always resolves
with ``force_refresh=True``, because a stale ``active`` must not be trusted at
check-in. A provider with **no strategy registered** (missing bot token or client
id) therefore resolves to ``unknown`` and the gate does not enforce it. That is the
intended fail-open, but it means a half-configured deployment silently admits
everyone — ``test_provider_without_a_strategy_does_not_enforce`` pins it so the
behaviour is a decision rather than a surprise.

Run against a scratch/dev database::

    SUBSCRIPTIONS_IT_DSN=postgresql+psycopg://user:pw@127.0.0.1:15432/anak_dev \\
        uv run pytest tournament-service/tests/test_check_in_gate_integration.py -v
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa

DSN = os.environ.get("SUBSCRIPTIONS_IT_DSN")

if sys.platform == "win32":
    # psycopg's async mode refuses the Windows default ProactorEventLoop.
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

ANY_OF = {"mode": "any", "requirements": [{"provider": "boosty"}, {"provider": "twitch"}]}
ALL_OF = {"mode": "all", "requirements": [{"provider": "boosty"}, {"provider": "twitch"}]}
BOOSTY_TIER_2 = {"mode": "all", "requirements": [{"provider": "boosty", "min_tier_rank": 2}]}


class _Form:
    """Only the toggle and the workspace now -- the rule lives in the database."""

    def __init__(self, workspace_id: int) -> None:
        self.workspace_id = workspace_id
        self.require_subscription = True


class _StubStrategy:
    """Stands in for a live provider, answering what the test dictates."""

    def __init__(self, verdict) -> None:
        self._verdict = verdict

    async def resolve_many(self, *, config, auth_user_ids):
        return dict.fromkeys(auth_user_ids, self._verdict)


@unittest.skipUnless(DSN, "set SUBSCRIPTIONS_IT_DSN to run gate integration tests")
class TestCheckInGate(IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        self._engine = create_async_engine(DSN, connect_args={"connect_timeout": 20})
        self._session = async_sessionmaker(self._engine, expire_on_commit=False)()

        self.ws = (await self._session.execute(sa.text("select id from workspace order by id limit 1"))).scalar()
        self.au = (await self._session.execute(sa.text('select id from auth."user" order by id limit 1'))).scalar()
        if self.ws is None or self.au is None:
            self.skipTest("target database has no workspace / auth user to anchor FKs")

        for provider in ("boosty", "twitch"):
            await self._session.execute(
                sa.text(
                    "insert into subscriptions.provider_config "
                    "(workspace_id, provider, enabled, config_json) "
                    "values (:w, :p, true, '{}') "
                    "on conflict on constraint uq_subscription_config_workspace_provider "
                    "do update set enabled = true"
                ),
                {"w": self.ws, "p": provider},
            )
        await self._session.commit()

    async def asyncTearDown(self) -> None:
        await self._session.execute(
            sa.text("delete from subscriptions.entitlement where workspace_id = :w"),
            {"w": self.ws},
        )
        await self._session.execute(
            sa.text("delete from subscriptions.provider_config where workspace_id = :w"),
            {"w": self.ws},
        )
        await self._session.execute(
            sa.text("delete from subscriptions.requirement where workspace_id = :w"),
            {"w": self.ws},
        )
        await self._session.commit()
        await self._session.close()
        await self._engine.dispose()

    @staticmethod
    def _verdict(state: str, tier: int | None):
        from shared.services.subscriptions import SubscriptionVerdict

        now = datetime.now(UTC)
        return SubscriptionVerdict(
            state=state,
            tier_rank=tier,
            tier_label=None,
            source="discord_role",
            checked_at=now,
            expires_at=now + timedelta(minutes=15),
            evidence={},
        )

    async def _set_workspace_requirement(self, blob: dict) -> None:
        """The rule is the workspace's now, so the gate reads it back out of Postgres."""
        await self._session.execute(
            sa.text("delete from subscriptions.requirement where workspace_id = :w"),
            {"w": self.ws},
        )
        await self._session.execute(
            sa.text(
                "insert into subscriptions.requirement "
                "(workspace_id, name, requirement_json, is_default) "
                "values (:w, 'default', :blob, true)"
            ),
            {"w": self.ws, "blob": json.dumps(blob)},
        )
        await self._session.commit()

    async def _blocks(self, blob: dict, live: dict[str, tuple[str, int | None]]) -> bool:
        """True when the gate refuses check-in. Providers absent from ``live`` have
        no strategy and therefore resolve to ``unknown``."""
        from shared.core.errors import BaseAPIException
        from shared.services.subscriptions.entitlements import SubscriptionResolver
        from shared.services.subscriptions.wiring import build_store
        from src.services.registration.subscription_gate import (
            assert_subscription_allows_check_in,
        )

        resolver = SubscriptionResolver(
            store=build_store(self._session),
            strategies={
                provider: _StubStrategy(self._verdict(state, tier)) for provider, (state, tier) in live.items()
            },
        )
        await self._set_workspace_requirement(blob)
        try:
            await assert_subscription_allows_check_in(form=_Form(self.ws), auth_user_id=self.au, resolver=resolver)
        except BaseAPIException:
            return True
        return False

    # ── thresholds ────────────────────────────────────────────────────────────

    async def test_active_below_threshold_blocks(self):
        assert await self._blocks(BOOSTY_TIER_2, {"boosty": ("active", 1)}) is True

    async def test_active_at_threshold_passes(self):
        assert await self._blocks(BOOSTY_TIER_2, {"boosty": ("active", 2)}) is False

    # ── fail open ─────────────────────────────────────────────────────────────

    async def test_provider_without_a_strategy_does_not_enforce(self):
        """A half-configured deployment admits everyone rather than refusing them."""
        assert await self._blocks(BOOSTY_TIER_2, {}) is False

    # ── any ───────────────────────────────────────────────────────────────────

    async def test_any_one_satisfied_passes(self):
        assert await self._blocks(ANY_OF, {"boosty": ("inactive", None), "twitch": ("active", 1)}) is False

    async def test_any_refusal_plus_outage_passes(self):
        """The headline regression: a Twitch outage must not turn a Boosty refusal
        into a hard block."""
        assert await self._blocks(ANY_OF, {"boosty": ("inactive", None)}) is False

    async def test_any_all_refused_blocks(self):
        assert await self._blocks(ANY_OF, {"boosty": ("inactive", None), "twitch": ("inactive", None)}) is True

    # ── all ───────────────────────────────────────────────────────────────────

    async def test_all_one_refusal_blocks(self):
        assert await self._blocks(ALL_OF, {"boosty": ("inactive", None), "twitch": ("active", 1)}) is True

    async def test_all_satisfied_plus_outage_passes(self):
        assert await self._blocks(ALL_OF, {"boosty": ("active", 1)}) is False

    async def test_all_both_refused_blocks(self):
        assert await self._blocks(ALL_OF, {"boosty": ("inactive", None), "twitch": ("inactive", None)}) is True

    # ── mode equivalence ──────────────────────────────────────────────────────

    async def test_single_provider_is_mode_agnostic(self):
        any_one = {"mode": "any", "requirements": [{"provider": "boosty", "min_tier_rank": 2}]}
        under_any = await self._blocks(any_one, {"boosty": ("active", 1)})
        under_all = await self._blocks(BOOSTY_TIER_2, {"boosty": ("active", 1)})
        assert under_any == under_all is True
