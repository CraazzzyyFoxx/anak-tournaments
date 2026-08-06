"""``apply_identity_selection`` deduping must never regress a verified social
identity to unverified. When a selected source account is dropped because the
target already has the same (provider, normalized handle), the source's
verification (and provider_user_id) is promoted onto the surviving target row
instead of being discarded along with the deleted row -- otherwise merging a
verified account into a profile with an unverified duplicate silently reset
verification.
"""

from __future__ import annotations

import importlib
import os
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

user_merge = importlib.import_module("src.services.admin.user_merge")
merge_schemas = importlib.import_module("src.schemas.admin.user_merge")


def _account(id_, *, provider, username, is_verified=False, provider_user_id=None, is_primary=False):
    return SimpleNamespace(
        id=id_,
        provider=provider,
        username=username,
        is_verified=is_verified,
        provider_user_id=provider_user_id,
        is_primary=is_primary,
        user_id=None,
    )


class ApplyIdentitySelectionDedupTests(IsolatedAsyncioTestCase):
    async def test_promotes_verification_when_dropping_verified_source_duplicate(self) -> None:
        source_account = _account(
            1, provider="discord", username="Foo", is_verified=True, provider_user_id="pu1", is_primary=True
        )
        target_account = _account(2, provider="discord", username="foo", is_verified=False, is_primary=True)
        source = SimpleNamespace(id=10, social_accounts=[source_account])
        target = SimpleNamespace(id=20, social_accounts=[target_account])
        session = SimpleNamespace(delete=AsyncMock(), flush=AsyncMock())
        selection = merge_schemas.UserMergeIdentitySelection(social_account_ids=[1])

        result = await user_merge.apply_identity_selection(session, source, target, selection)

        session.delete.assert_awaited_once_with(source_account)
        self.assertEqual({"moved": [], "deduped": [1]}, result)
        # The surviving target row inherits the dropped account's proof of
        # ownership instead of staying unverified.
        self.assertTrue(target_account.is_verified)
        self.assertEqual("pu1", target_account.provider_user_id)

    async def test_does_not_touch_already_verified_target_duplicate(self) -> None:
        source_account = _account(
            1, provider="discord", username="Foo", is_verified=True, provider_user_id="pu1"
        )
        target_account = _account(
            2, provider="discord", username="foo", is_verified=True, provider_user_id="pu2"
        )
        source = SimpleNamespace(id=10, social_accounts=[source_account])
        target = SimpleNamespace(id=20, social_accounts=[target_account])
        session = SimpleNamespace(delete=AsyncMock(), flush=AsyncMock())
        selection = merge_schemas.UserMergeIdentitySelection(social_account_ids=[1])

        result = await user_merge.apply_identity_selection(session, source, target, selection)

        self.assertEqual({"moved": [], "deduped": [1]}, result)
        # Target already owned a verified identity for this handle: its own
        # provider_user_id must not be overwritten by the dropped duplicate's.
        self.assertTrue(target_account.is_verified)
        self.assertEqual("pu2", target_account.provider_user_id)

    async def test_unverified_source_duplicate_does_not_promote(self) -> None:
        source_account = _account(1, provider="discord", username="Foo", is_verified=False)
        target_account = _account(2, provider="discord", username="foo", is_verified=False)
        source = SimpleNamespace(id=10, social_accounts=[source_account])
        target = SimpleNamespace(id=20, social_accounts=[target_account])
        session = SimpleNamespace(delete=AsyncMock(), flush=AsyncMock())
        selection = merge_schemas.UserMergeIdentitySelection(social_account_ids=[1])

        result = await user_merge.apply_identity_selection(session, source, target, selection)

        self.assertEqual({"moved": [], "deduped": [1]}, result)
        self.assertFalse(target_account.is_verified)
        self.assertIsNone(target_account.provider_user_id)

    async def test_moves_non_duplicate_account_and_clears_primary(self) -> None:
        source_account = _account(
            1, provider="twitch", username="bar", is_verified=True, provider_user_id="pu3", is_primary=True
        )
        source = SimpleNamespace(id=10, social_accounts=[source_account])
        target = SimpleNamespace(id=20, social_accounts=[])
        primary_result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [source_account]))
        session = SimpleNamespace(delete=AsyncMock(), flush=AsyncMock(), execute=AsyncMock(return_value=primary_result))
        selection = merge_schemas.UserMergeIdentitySelection(social_account_ids=[1])

        result = await user_merge.apply_identity_selection(session, source, target, selection)

        session.delete.assert_not_awaited()
        self.assertEqual({"moved": [1], "deduped": []}, result)
        self.assertEqual(20, source_account.user_id)
