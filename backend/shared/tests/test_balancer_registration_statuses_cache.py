"""Cache behaviour for get_status_metas_map, the hot status-metadata read.

Called on every registration mutation and every participants-list rebuild
(14+ call sites across tournament-service), but the underlying rows are
organizer config that changes on the order of "a few times a workspace's
whole lifetime" -- so it's cached per workspace. Two things matter here:

1. Repeat calls for the same workspace are served from cache.
2. invalidate_status_metas_cache drops exactly one workspace's entry, so a
   status edit is visible on the very next read, not after the TTL.
"""

from __future__ import annotations

from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from cashews import cache

from shared import balancer_registration_statuses as statuses


class _CacheTestBase(IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        cache.setup("mem://", prefix="backend:")
        await cache.delete_match("backend:registration_status_metas:*")


class GetStatusMetasMapCacheTests(_CacheTestBase):
    async def test_repeat_call_for_the_same_workspace_is_served_from_cache(self) -> None:
        rows = AsyncMock(return_value=[])
        with patch.object(statuses, "list_workspace_status_rows", rows):
            await statuses.get_status_metas_map(object(), workspace_id=1)
            await statuses.get_status_metas_map(object(), workspace_id=1)
        rows.assert_awaited_once()

    async def test_different_workspaces_never_share_a_cache_entry(self) -> None:
        rows = AsyncMock(return_value=[])
        with patch.object(statuses, "list_workspace_status_rows", rows):
            await statuses.get_status_metas_map(object(), workspace_id=1)
            await statuses.get_status_metas_map(object(), workspace_id=2)
        self.assertEqual(2, rows.await_count)

    async def test_cached_result_still_merges_in_every_builtin_status(self) -> None:
        with patch.object(statuses, "list_workspace_status_rows", AsyncMock(return_value=[])):
            result = await statuses.get_status_metas_map(object(), workspace_id=3)

        self.assertEqual(set(statuses.BUILTIN_STATUS_META["registration"]), set(result["registration"]))
        self.assertEqual(set(statuses.BUILTIN_STATUS_META["balancer"]), set(result["balancer"]))


class InvalidateStatusMetasCacheTests(_CacheTestBase):
    async def test_invalidation_forces_a_fresh_read_for_that_workspace_only(self) -> None:
        rows = AsyncMock(return_value=[])
        with patch.object(statuses, "list_workspace_status_rows", rows):
            await statuses.get_status_metas_map(object(), workspace_id=1)
            await statuses.get_status_metas_map(object(), workspace_id=2)

            await statuses.invalidate_status_metas_cache(1)

            await statuses.get_status_metas_map(object(), workspace_id=1)  # re-fetches: was invalidated
            await statuses.get_status_metas_map(object(), workspace_id=2)  # still cached: untouched

        self.assertEqual(3, rows.await_count)
