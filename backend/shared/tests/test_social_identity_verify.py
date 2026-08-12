"""Unit tests for ``verify_social_account`` and its OAuth-handle matcher (no DB).

``verify_social_account`` exists to fix accounts the automatic OAuth-sync missed
(see the docstring in ``social_identity.py``): it must only flip ``is_verified``
when a real ``OAuthConnection`` for the player's linked auth user actually
proves the handle, never on say-so alone. These tests pin that refusal
behaviour with a minimal fake session (no real DB / SQLAlchemy engine).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest import TestCase

from shared.services import social_identity


def _account(*, id_=1, user_id=7, provider="discord", username_normalized="coolguy", is_verified=False):
    return SimpleNamespace(
        id=id_,
        user_id=user_id,
        provider=provider,
        username_normalized=username_normalized,
        is_verified=is_verified,
        provider_user_id=None,
    )


def _connection(*, provider="discord", provider_user_id="pu1", username=None, display_name=None, provider_data=None):
    return SimpleNamespace(
        provider=provider,
        provider_user_id=provider_user_id,
        username=username,
        display_name=display_name,
        provider_data=provider_data,
    )


class _FakeResult:
    """Stands in for a SQLAlchemy ``Result``: supports whichever accessor the
    caller actually uses (``scalar_one_or_none`` for a single row, or
    ``scalars().all()`` for a list)."""

    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return self._value


class _FakeSession:
    """Just enough of ``AsyncSession`` for ``verify_social_account``: the first
    ``execute`` call is always the account lookup, the second (if reached) is
    the OAuth-connections lookup; ``get`` resolves the player."""

    def __init__(self, *, account=None, player=None, connections=()):
        self._account = account
        self._player = player
        self._connections = list(connections)
        self._execute_calls = 0
        self.flush_calls = 0

    async def execute(self, _query):
        self._execute_calls += 1
        if self._execute_calls == 1:
            return _FakeResult(self._account)
        return _FakeResult(self._connections)

    async def get(self, _model, _pk):
        return self._player

    async def flush(self):
        self.flush_calls += 1


class OAuthHandleCandidatesTests(TestCase):
    def test_discord_candidates_include_username_and_global_name(self) -> None:
        conn = _connection(
            provider="discord",
            username="CoolGuy",
            display_name="Cool Guy",
            provider_data={"username": "coolguy_raw", "global_name": "CoolGlobal"},
        )
        candidates = social_identity._oauth_handle_candidates("discord", conn)
        assert candidates == {"coolguy", "cool guy", "coolguy_raw", "coolglobal"}

    def test_battlenet_candidates_normalize_tag_spacing(self) -> None:
        conn = _connection(
            provider="battlenet",
            username="Player#1234",
            provider_data={"battletag": "Player # 1234"},
        )
        candidates = social_identity._oauth_handle_candidates("battlenet", conn)
        assert "player#1234" in candidates

    def test_twitch_candidates_include_login(self) -> None:
        conn = _connection(provider="twitch", username="StreamerX", provider_data={"login": "streamerx"})
        candidates = social_identity._oauth_handle_candidates("twitch", conn)
        assert candidates == {"streamerx"}

    def test_missing_provider_data_yields_only_username_variants(self) -> None:
        conn = _connection(provider="discord", username="Solo", display_name=None, provider_data=None)
        assert social_identity._oauth_handle_candidates("discord", conn) == {"solo"}


class VerifySocialAccountTests(TestCase):
    def test_returns_none_when_account_not_found(self) -> None:
        session = _FakeSession(account=None)
        result = asyncio.run(social_identity.verify_social_account(session, account_id=1, user_id=7))
        assert result is None

    def test_already_verified_is_idempotent_noop(self) -> None:
        account = _account(is_verified=True)
        session = _FakeSession(account=account)
        result = asyncio.run(social_identity.verify_social_account(session, account_id=1, user_id=7))
        assert result is account
        assert session.flush_calls == 0  # never touched -- no write needed

    def test_rejects_non_oauth_provider(self) -> None:
        account = _account(provider="boosty")
        session = _FakeSession(account=account)
        with self.assertRaises(social_identity.SocialAccountNotOAuthLinked):
            asyncio.run(social_identity.verify_social_account(session, account_id=1, user_id=7))

    def test_rejects_player_with_no_linked_auth_account(self) -> None:
        account = _account(provider="discord")
        player = SimpleNamespace(auth_user_id=None)
        session = _FakeSession(account=account, player=player)
        with self.assertRaises(social_identity.SocialAccountNotOAuthLinked):
            asyncio.run(social_identity.verify_social_account(session, account_id=1, user_id=7))

    def test_rejects_when_no_oauth_connection_for_provider(self) -> None:
        account = _account(provider="discord")
        player = SimpleNamespace(auth_user_id=99)
        session = _FakeSession(account=account, player=player, connections=[])
        with self.assertRaises(social_identity.SocialAccountNotOAuthLinked):
            asyncio.run(social_identity.verify_social_account(session, account_id=1, user_id=7))

    def test_rejects_when_connection_handle_does_not_match(self) -> None:
        account = _account(provider="discord", username_normalized="coolguy")
        player = SimpleNamespace(auth_user_id=99)
        # A real OAuth connection exists for this provider, but for a different
        # Discord handle -- must not be treated as proof for this account.
        mismatched = _connection(provider="discord", provider_user_id="pu9", username="SomeoneElse")
        session = _FakeSession(account=account, player=player, connections=[mismatched])
        with self.assertRaises(social_identity.SocialAccountNotOAuthLinked):
            asyncio.run(social_identity.verify_social_account(session, account_id=1, user_id=7))
        assert account.is_verified is False

    def test_verifies_and_adopts_provider_user_id_on_match(self) -> None:
        account = _account(provider="discord", username_normalized="coolguy")
        player = SimpleNamespace(auth_user_id=99)
        match = _connection(provider="discord", provider_user_id="pu1", username="CoolGuy")
        session = _FakeSession(account=account, player=player, connections=[match])

        result = asyncio.run(social_identity.verify_social_account(session, account_id=1, user_id=7))

        assert result is account
        assert account.is_verified is True
        assert account.provider_user_id == "pu1"
        assert session.flush_calls == 1

    def test_matches_against_any_of_several_connections(self) -> None:
        account = _account(provider="battlenet", username_normalized="player#1234")
        player = SimpleNamespace(auth_user_id=99)
        other = _connection(provider="battlenet", provider_user_id="pu-other", username="Other#9999")
        match = _connection(provider="battlenet", provider_user_id="pu-match", username="Player#1234")
        session = _FakeSession(account=account, player=player, connections=[other, match])

        asyncio.run(social_identity.verify_social_account(session, account_id=1, user_id=7))

        assert account.is_verified is True
        assert account.provider_user_id == "pu-match"
