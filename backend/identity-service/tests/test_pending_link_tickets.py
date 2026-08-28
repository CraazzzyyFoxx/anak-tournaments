"""``tickets.LINK_TICKETS``: the one-time, browser-bound Redis ticket used to
hand a PROVIDER IDENTITY (never a session, never a site user id) to a custom
domain that wants to link it.

Same mechanics as ``SSO_TICKETS`` (see ``test_sso_tickets.py``), deliberately
different payload: the fixed apex callback has no live session for a
custom-domain user, so it can only forward what it just exchanged from the
provider. The account being linked TO is resolved later, from the custom
domain's OWN bearer session (``oauth.link_complete``) -- which is why the
ticket carrying no account identifier is a security invariant, not an
omission.

Exercised here: the single-use ``GETDEL`` contract, the
``lg = sha256_hex(raw guard cookie)`` browser binding (missing / mismatched /
absent-binding all fail closed and are indistinguishable), ``issue`` raising on
an unreachable Redis (no fallback exists for a ticket nobody could redeem) and
``redeem`` failing closed on one.
"""

import asyncio
import hashlib
import sys
from pathlib import Path

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tests._fakes import DownRedisClient as _DownRedisClient  # noqa: E402
from tests._fakes import FakeRedisClient as _FakeRedisClient  # noqa: E402
from tests._fakes import make_oauth_info as _oauth_info  # noqa: E402
from src.schemas.oauth import OAuthUserInfo  # noqa: E402
from src.services.tickets import LINK_TICKETS, guard_digest  # noqa: E402

# ``src.core.cache.get_redis`` is the single Redis entry point every store goes
# through, so pointing it at a fake redirects the whole ticket store.
_GET_REDIS = "src.core.cache.get_redis"


def _use_redis(monkeypatch: pytest.MonkeyPatch, client: object) -> None:
    monkeypatch.setattr(_GET_REDIS, lambda: client)



def _link_payload(**overrides: object) -> dict[str, object]:
    """Exactly the shape ``oauth.link`` stores on a pending-link ticket: the
    just-exchanged PROVIDER identity and its token data -- and nothing else."""
    payload: dict[str, object] = {
        "oauth_info": _oauth_info().model_dump(mode="json"),
        "token_data": {"access_token": "provider-access-1"},
    }
    payload.update(overrides)
    return payload


def _guard_pair(raw: str = "raw-guard-token") -> tuple[str, str]:
    """``(raw_guard, sha256_hex(raw_guard))`` -- the pair the frontend's
    custom-domain apex bounce produces (host-only cookie + signed hash)."""
    return raw, hashlib.sha256(raw.encode("utf-8")).hexdigest()


def test_issue_redeem_roundtrip_returns_provider_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _FakeRedisClient())

    guard, guard_hash = _guard_pair()
    code = asyncio.run(LINK_TICKETS.issue(_link_payload(), guard_hash=guard_hash))
    payload = asyncio.run(LINK_TICKETS.redeem(code, guard))

    assert payload is not None
    assert payload["oauth_info"]["provider"] == "discord"
    assert payload["oauth_info"]["provider_user_id"] == "provider-uid-1"
    assert payload["oauth_info"]["username"] == "player1"
    assert payload["token_data"] == {"access_token": "provider-access-1"}


def test_ticket_payload_never_carries_a_site_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """SECURITY INVARIANT #2: the ticket holds ONLY the provider identity --
    the linked-to account is resolved from the redeeming caller's own live
    session, never read out of the ticket. A user id in here would be an
    account-takeover primitive."""
    _use_redis(monkeypatch, _FakeRedisClient())

    guard, guard_hash = _guard_pair()
    code = asyncio.run(LINK_TICKETS.issue(_link_payload(), guard_hash=guard_hash))
    payload = asyncio.run(LINK_TICKETS.redeem(code, guard))

    assert payload is not None
    assert set(payload) == {"oauth_info", "token_data", "lg"}
    assert "auth_user_id" not in payload
    assert "user_id" not in payload
    assert "auth_user_id" not in payload["oauth_info"]
    assert "user_id" not in payload["oauth_info"]
    assert "auth_user_id" not in payload["token_data"]
    # No session tokens either -- that is the SSO ticket's job, not this one.
    assert "access_token" not in payload
    assert "refresh_token" not in payload


def test_ticket_stores_only_the_guard_digest(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _FakeRedisClient())

    guard, guard_hash = _guard_pair()
    code = asyncio.run(LINK_TICKETS.issue(_link_payload(), guard_hash=guard_hash))
    payload = asyncio.run(LINK_TICKETS.redeem(code, guard))

    assert payload is not None
    assert payload["lg"] == guard_digest(guard)
    assert payload["lg"] != guard


def test_redeem_is_single_use(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _FakeRedisClient())

    guard, guard_hash = _guard_pair()
    code = asyncio.run(LINK_TICKETS.issue(_link_payload(), guard_hash=guard_hash))

    first = asyncio.run(LINK_TICKETS.redeem(code, guard))
    second = asyncio.run(LINK_TICKETS.redeem(code, guard))

    assert first is not None
    assert second is None


def test_redeem_rejects_missing_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """A bound ticket redeemed with NO guard fails closed: the victim's browser
    never held the attacker's host-only guard cookie."""
    _use_redis(monkeypatch, _FakeRedisClient())

    _guard, guard_hash = _guard_pair()
    code = asyncio.run(LINK_TICKETS.issue(_link_payload(), guard_hash=guard_hash))

    assert asyncio.run(LINK_TICKETS.redeem(code, None)) is None


def test_redeem_rejects_mismatched_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _FakeRedisClient())

    _guard, guard_hash = _guard_pair("the-real-guard-value")
    code = asyncio.run(LINK_TICKETS.issue(_link_payload(), guard_hash=guard_hash))

    assert asyncio.run(LINK_TICKETS.redeem(code, "an-attackers-forged-guard-value")) is None


def test_unbound_ticket_can_never_be_redeemed(monkeypatch: pytest.MonkeyPatch) -> None:
    """No binding to check must never be read as binding satisfied."""
    _use_redis(monkeypatch, _FakeRedisClient())

    code = asyncio.run(LINK_TICKETS.issue(_link_payload()))

    assert asyncio.run(LINK_TICKETS.redeem(code, "any-guard-value")) is None
    assert asyncio.run(LINK_TICKETS.redeem(code, None)) is None


def test_failed_guard_check_still_burns_the_ticket(monkeypatch: pytest.MonkeyPatch) -> None:
    """The GETDEL runs before the binding check, so a wrong guard consumes the
    ticket exactly like a right one."""
    _use_redis(monkeypatch, _FakeRedisClient())

    guard, guard_hash = _guard_pair()
    code = asyncio.run(LINK_TICKETS.issue(_link_payload(), guard_hash=guard_hash))

    assert asyncio.run(LINK_TICKETS.redeem(code, "wrong-guard")) is None
    assert asyncio.run(LINK_TICKETS.redeem(code, guard)) is None


def test_redeem_unknown_code_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _FakeRedisClient())

    assert asyncio.run(LINK_TICKETS.redeem("does-not-exist", "any-guard-value")) is None


def test_redeem_empty_code_returns_none_without_touching_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    # A blank ticket is never valid; short-circuit before any Redis call so
    # a missing/blank query param can't even reach the client.
    monkeypatch.setattr(_GET_REDIS, lambda: (_ for _ in ()).throw(AssertionError("should not be called")))

    assert asyncio.run(LINK_TICKETS.redeem("", "any-guard-value")) is None


def test_issue_stores_under_prefixed_key_with_120s_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class _CapturingRedis:
        async def set(self, key: str, value: str, ex: int | None = None) -> None:
            captured.update(key=key, value=value, ex=ex)

    _use_redis(monkeypatch, _CapturingRedis())

    code = asyncio.run(LINK_TICKETS.issue(_link_payload()))

    assert captured["key"] == f"link:ticket:{code}"
    assert captured["ex"] == 120


def test_issue_raises_when_redis_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    # issue() has no safe fallback -- cookies/sessions can't cross the
    # registrable domain boundary, so a ticket nobody could ever redeem is
    # worse than an explicit failure. Must raise, not swallow.
    _use_redis(monkeypatch, _DownRedisClient())

    with pytest.raises(RedisConnectionError):
        asyncio.run(LINK_TICKETS.issue(_link_payload()))


def test_redeem_fails_closed_when_redis_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _DownRedisClient())

    assert asyncio.run(LINK_TICKETS.redeem("some-code", "any-guard-value")) is None


def test_redeem_discards_corrupted_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    class _CorruptRedis:
        async def getdel(self, key: str) -> str:
            return "definitely-not-json"

    _use_redis(monkeypatch, _CorruptRedis())

    assert asyncio.run(LINK_TICKETS.redeem("some-code", "any-guard-value")) is None
