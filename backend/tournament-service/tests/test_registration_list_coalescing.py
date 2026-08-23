"""Single-flight coalescing of the public registration-list rebuild.

The list is the heaviest public read and every connected viewer refetches it
at once after any registration mutation (the "realtime invalidation herd").
Two things matter here and nothing else:

1. A burst of concurrent callers for the SAME tournament_id must trigger
   exactly one real read-model build -- not one per caller.
2. One follower's cancellation must never take the shared build down with it
   for every other follower still waiting on it.

Runs under stdlib unittest -- no pytest-asyncio in this repo.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch


def _ensure_test_env() -> None:
    for key, value in {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "tournament_test",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "JWT_SECRET_KEY": "test-secret",
        "REDIS_URL": "redis://localhost:6379",
    }.items():
        os.environ.setdefault(key, value)


_ensure_test_env()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.rpc import public_rpc  # noqa: E402


class _FakeSessionCtx:
    async def __aenter__(self) -> object:
        return object()

    async def __aexit__(self, *exc: object) -> None:
        return None


class TestCoalescing(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        public_rpc._reg_pub_list_inflight.clear()

    async def test_concurrent_callers_share_one_build(self) -> None:
        calls = 0

        async def fake_build(session: object, *, tournament_id: int) -> str:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)
            return f"snapshot-{tournament_id}-{calls}"

        with (
            patch.object(public_rpc.db, "async_session_maker", lambda: _FakeSessionCtx()),
            patch.object(public_rpc.reg_service.registration_service, "build_public_registration_list", fake_build),
        ):
            results = await asyncio.gather(*[public_rpc._coalesced_registration_list(42) for _ in range(6)])

        assert calls == 1, f"expected one real build for the whole burst, got {calls}"
        assert len(set(results)) == 1, "every concurrent caller must see the same live snapshot"
        assert 42 not in public_rpc._reg_pub_list_inflight, "in-flight entry must be cleaned up after completion"

    async def test_distinct_tournaments_never_share_a_build(self) -> None:
        seen_ids: list[int] = []

        async def fake_build(session: object, *, tournament_id: int) -> int:
            seen_ids.append(tournament_id)
            await asyncio.sleep(0.02)
            return tournament_id

        with (
            patch.object(public_rpc.db, "async_session_maker", lambda: _FakeSessionCtx()),
            patch.object(public_rpc.reg_service.registration_service, "build_public_registration_list", fake_build),
        ):
            results = await asyncio.gather(
                public_rpc._coalesced_registration_list(1),
                public_rpc._coalesced_registration_list(2),
            )

        assert sorted(seen_ids) == [1, 2]
        assert results == [1, 2]

    async def test_sequential_calls_after_completion_rebuild(self) -> None:
        calls = 0

        async def fake_build(session: object, *, tournament_id: int) -> int:
            nonlocal calls
            calls += 1
            return calls

        with (
            patch.object(public_rpc.db, "async_session_maker", lambda: _FakeSessionCtx()),
            patch.object(public_rpc.reg_service.registration_service, "build_public_registration_list", fake_build),
        ):
            first = await public_rpc._coalesced_registration_list(7)
            second = await public_rpc._coalesced_registration_list(7)

        assert (first, second) == (1, 2), "a call after the burst settles must see fresh, live data, not a stale share"

    async def test_follower_cancellation_does_not_kill_the_shared_build(self) -> None:
        calls = 0

        async def fake_build(session: object, *, tournament_id: int) -> str:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.1)
            return "ok"

        with (
            patch.object(public_rpc.db, "async_session_maker", lambda: _FakeSessionCtx()),
            patch.object(public_rpc.reg_service.registration_service, "build_public_registration_list", fake_build),
        ):
            leader = asyncio.create_task(public_rpc._coalesced_registration_list(9))
            follower = asyncio.create_task(public_rpc._coalesced_registration_list(9))
            await asyncio.sleep(0.02)

            follower.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await follower

            result = await leader

        assert result == "ok"
        assert calls == 1
