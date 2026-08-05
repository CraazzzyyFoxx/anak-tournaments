"""Resolver-level tests for ``SubscriptionResolver.load_requirement``.

No database. The data-access boundary (``EntitlementStore``) is faked, matching
the convention in ``test_resolve_subscriptions.py`` -- the point of these tests is
the *parse and fail-open* behaviour the resolver adds on top of the raw blob, not
the SQL that fetches it (``test_subscription_store_integration.py`` owns that).

The malformed-blob case is the one worth pinning: every call site used to parse
the form column inline and swallow ``ValueError`` there, so moving the parse to
one place must not turn a bad config row into a 500 at check-in time.

Runs under stdlib unittest -- there is no pytest-asyncio here.
"""

from __future__ import annotations

from typing import Any
from unittest import IsolatedAsyncioTestCase

from shared.services.subscription_entitlements import SubscriptionResolver

WS = 7


class _FakeStore:
    """Only ``load_requirement`` is exercised; the rest of the protocol is inert."""

    def __init__(self, blobs: dict[int, dict[str, Any]] | None = None) -> None:
        self._blobs = blobs or {}
        self.requirement_calls: list[int] = []

    async def load_requirement(self, workspace_id):
        self.requirement_calls.append(workspace_id)
        return self._blobs.get(workspace_id)

    async def load_configs(self, workspace_id, providers):
        return {}

    async def load_entitlements(self, workspace_id, auth_user_ids, providers):
        return {}

    async def upsert(self, workspace_id, auth_user_id, provider, verdict):
        return None


def _resolver(blobs: dict[int, dict[str, Any]] | None = None) -> tuple[SubscriptionResolver, _FakeStore]:
    store = _FakeStore(blobs)
    return SubscriptionResolver(store=store, strategies={}), store


class TestLoadRequirement(IsolatedAsyncioTestCase):
    async def test_the_default_row_becomes_a_parsed_rule(self):
        resolver, store = _resolver({WS: {"mode": "all", "requirements": [{"provider": "boosty", "min_tier_rank": 2}]}})

        requirement = await resolver.load_requirement(workspace_id=WS)

        assert requirement is not None
        assert requirement.mode == "all"
        assert requirement.providers == ("boosty",)
        assert requirement.requirements[0].min_tier_rank == 2
        assert store.requirement_calls == [WS]

    async def test_no_row_is_nothing_to_enforce(self):
        resolver, _ = _resolver()
        assert await resolver.load_requirement(workspace_id=WS) is None

    async def test_an_empty_blob_is_nothing_to_enforce(self):
        resolver, _ = _resolver({WS: {}})
        assert await resolver.load_requirement(workspace_id=WS) is None

    async def test_an_empty_requirements_list_is_nothing_to_enforce(self):
        """Toggle on, rule empty: the documented no-op that never calls a provider."""
        resolver, _ = _resolver({WS: {"requirements": []}})
        assert await resolver.load_requirement(workspace_id=WS) is None

    async def test_a_malformed_mode_fails_open_instead_of_raising(self):
        """``parse_requirement`` raises on an unknown mode; the resolver must not.

        Refusing every patron mid-tournament because one config row is bad is the
        worse failure, and this is exactly what each call site did inline before.
        """
        resolver, _ = _resolver({WS: {"mode": "most", "requirements": [{"provider": "boosty"}]}})
        assert await resolver.load_requirement(workspace_id=WS) is None
