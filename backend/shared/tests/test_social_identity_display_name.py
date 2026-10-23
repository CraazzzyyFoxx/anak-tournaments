"""``SocialIdentityService``'s ``display_name`` policy (no DB).

A Steam account's handle is a bare account id, so its persona name lives in
``display_name`` and identity-service fetches it on ``SteamAccountChangedEvent``.
Pinned here: the event goes out exactly when a Steam account appears or is
re-pointed without a name, and a re-pointed account never keeps the old id's name.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from shared.messaging.config import STEAM_ACCOUNT_CHANGED_QUEUE
from shared.services.social_identity import SocialIdentityService

SESSION = object()


class _Accounts:
    """``SocialAccountRepository`` holding at most one account."""

    def __init__(self, account=None):
        self.account = account

    async def get_by_provider_subject(self, _session, **_):
        return None

    async def find_by_handle(self, _session, *, username_normalized, **_):
        found = self.account is not None and self.account.username_normalized == username_normalized
        return self.account if found else None

    async def get_owned(self, _session, **_):
        return self.account

    async def find_handle_clash(self, _session, **_):
        return None

    async def has_any_for_provider(self, _session, **_):
        return self.account is not None

    async def create(self, _session, instance):
        instance.id = 41
        self.account = instance
        return instance

    async def update_fields(self, _session, instance, data):
        for field, value in data.items():
            setattr(instance, field, value)
        return instance


def _steam(account_id="206464648", display_name="KitKat"):
    return SimpleNamespace(
        id=41, provider="steam", username=account_id, username_normalized=account_id, display_name=display_name
    )


def _run(account, call):
    """Run ``call(service)``; returns its result and the ids of the Steam accounts it requested names for."""
    service = SocialIdentityService(accounts=_Accounts(account))
    with patch("shared.services.social_identity.enqueue_outbox_event", AsyncMock()) as enqueue:
        result = asyncio.run(call(service))
    for c in enqueue.await_args_list:
        assert c.kwargs == {"exchange": "", "routing_key": STEAM_ACCOUNT_CHANGED_QUEUE.name}
    return result, [c.args[1].social_account_id for c in enqueue.await_args_list]


def _upsert(username, provider="steam", **kwargs):
    return lambda s: s.upsert(
        SESSION, user_id=7, provider=provider, username=username, ensure_global_visibility=False, **kwargs
    )


class SteamDisplayNameTests(TestCase):
    def test_new_steam_account_without_a_name_requests_one(self) -> None:
        account, requested = _run(None, _upsert("[U:1:206464648]"))
        assert (account.username_normalized, account.display_name) == ("206464648", None)
        assert requested == [41]

    def test_a_name_supplied_by_the_writer_is_stored_and_not_requested(self) -> None:
        account, requested = _run(None, _upsert("206464648", display_name="KitKat"))
        assert account.display_name == "KitKat"
        assert requested == []

    def test_upserting_the_same_id_keeps_the_name_and_requests_nothing(self) -> None:
        account, requested = _run(_steam(), _upsert("76561198166730376"))  # the same account as a SteamID64
        assert account.display_name == "KitKat"
        assert requested == []

    def test_changing_the_id_drops_the_old_name_and_requests_the_new_one(self) -> None:
        account, requested = _run(_steam(), lambda s: s.update(SESSION, account_id=41, user_id=7, username="22202"))
        assert (account.username_normalized, account.display_name) == ("22202", None)
        assert requested == [41]

    def test_other_providers_never_request_a_steam_name(self) -> None:
        _, requested = _run(None, _upsert("Player#1234", provider="battlenet"))
        assert requested == []
