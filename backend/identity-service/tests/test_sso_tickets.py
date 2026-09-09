"""``tickets.SSO_TICKETS``: the one-time, browser-bound Redis ticket used to
hand a SESSION to a custom domain.

Cookies set on the platform apex are not readable on a workspace's custom
domain (different registrable domain), so the apex callback mints an opaque
ticket and the custom domain's own frontend route redeems it over RPC.

Two contracts are exercised here against an in-memory fake Redis:

* **single use** -- redemption is an atomic ``GETDEL``, so the second redeem of
  a code can never succeed, and a redeem whose *guard* check fails still burns
  the ticket (the burn happens first, on purpose).
* **browser binding** -- the ticket stores ``lg = sha256_hex(raw guard cookie)``
  and redemption requires the raw value again. A missing guard, a mismatched
  guard, and a ticket that carries no binding at all are all indistinguishable
  from an unknown code: every one of them is ``None``.

``issue`` has NO fallback: a ticket that was never stored can never be
redeemed, and cookies cannot cross the registrable-domain boundary to make up
for it, so an unreachable Redis must raise rather than hand the browser a code
that will silently fail. ``redeem`` is the opposite -- it fails closed.
"""

import asyncio
import hashlib
import sys
from pathlib import Path

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.services.tickets import SSO_TICKETS, guard_digest  # noqa: E402
from tests._fakes import DownRedisClient as _DownRedisClient  # noqa: E402
from tests._fakes import FakeRedisClient as _FakeRedisClient  # noqa: E402

# ``src.core.cache.get_redis`` is the single Redis entry point every store goes
# through, so pointing it at a fake redirects the whole ticket store.
_GET_REDIS = "src.core.cache.get_redis"


def _use_redis(monkeypatch: pytest.MonkeyPatch, client: object) -> None:
    monkeypatch.setattr(_GET_REDIS, lambda: client)


def _sso_payload(**overrides: object) -> dict[str, object]:
    """Exactly the shape ``oauth.callback`` stores on an SSO ticket: a SESSION
    (access + refresh) plus where to land afterwards -- and nothing else."""
    payload = {"access_token": "access-1", "refresh_token": "refresh-1", "redirect": "/dashboard"}
    payload.update(overrides)
    return payload


def _guard_pair(raw: str = "raw-guard-token") -> tuple[str, str]:
    """``(raw_guard, sha256_hex(raw_guard))`` -- the pair the frontend's
    custom-domain apex bounce produces (host-only cookie + signed hash)."""
    return raw, hashlib.sha256(raw.encode("utf-8")).hexdigest()


def test_issue_redeem_roundtrip_returns_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _FakeRedisClient())

    guard, guard_hash = _guard_pair()
    code = asyncio.run(SSO_TICKETS.issue(_sso_payload(), guard_hash=guard_hash))
    payload = asyncio.run(SSO_TICKETS.redeem(code, guard))

    assert payload is not None
    assert payload["access_token"] == "access-1"
    assert payload["refresh_token"] == "refresh-1"
    assert payload["redirect"] == "/dashboard"


def test_ticket_payload_carries_a_session_and_the_guard_binding_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """The SSO ticket's payload is the session itself -- distinct from a link
    ticket, which carries a provider identity and never a session."""
    _use_redis(monkeypatch, _FakeRedisClient())

    guard, guard_hash = _guard_pair()
    code = asyncio.run(SSO_TICKETS.issue(_sso_payload(), guard_hash=guard_hash))
    payload = asyncio.run(SSO_TICKETS.redeem(code, guard))

    assert payload is not None
    assert set(payload) == {"access_token", "refresh_token", "redirect", "lg"}
    # Only the DIGEST of the guard cookie is ever stored, never the raw value.
    assert payload["lg"] == guard_digest(guard)
    assert guard not in payload.values()


def test_redeem_is_single_use(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _FakeRedisClient())

    guard, guard_hash = _guard_pair()
    code = asyncio.run(SSO_TICKETS.issue(_sso_payload(), guard_hash=guard_hash))

    first = asyncio.run(SSO_TICKETS.redeem(code, guard))
    second = asyncio.run(SSO_TICKETS.redeem(code, guard))

    assert first is not None
    assert second is None


def test_redeem_rejects_missing_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """A ticket bound to a guard hash, redeemed with NO guard at all, fails
    closed -- the reverse-CSRF shape this binding closes: the victim's browser
    never held the attacker's host-only guard cookie."""
    _use_redis(monkeypatch, _FakeRedisClient())

    _guard, guard_hash = _guard_pair()
    code = asyncio.run(SSO_TICKETS.issue(_sso_payload(), guard_hash=guard_hash))

    assert asyncio.run(SSO_TICKETS.redeem(code, None)) is None


def test_redeem_rejects_mismatched_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """A WRONG guard (an attacker's own cookie value) fails exactly like a
    missing one."""
    _use_redis(monkeypatch, _FakeRedisClient())

    _guard, guard_hash = _guard_pair("the-real-guard-value")
    code = asyncio.run(SSO_TICKETS.issue(_sso_payload(), guard_hash=guard_hash))

    assert asyncio.run(SSO_TICKETS.redeem(code, "an-attackers-forged-guard-value")) is None


def test_unbound_ticket_can_never_be_redeemed(monkeypatch: pytest.MonkeyPatch) -> None:
    """A ticket issued with no ``guard_hash`` has no binding to satisfy, and
    "nothing to check" must never be read as "check passed" -- no guard value
    can ever redeem it. (The flow layer refuses to mint one in the first place;
    this is the store's own fail-closed backstop.)"""
    _use_redis(monkeypatch, _FakeRedisClient())

    code = asyncio.run(SSO_TICKETS.issue(_sso_payload()))

    assert asyncio.run(SSO_TICKETS.redeem(code, "any-guard-value")) is None
    assert asyncio.run(SSO_TICKETS.redeem(code, None)) is None


def test_failed_guard_check_still_burns_the_ticket(monkeypatch: pytest.MonkeyPatch) -> None:
    """The GETDEL happens BEFORE the binding is checked, so a wrong guard
    consumes the ticket just like a right one -- it can never be retried."""
    _use_redis(monkeypatch, _FakeRedisClient())

    guard, guard_hash = _guard_pair()
    code = asyncio.run(SSO_TICKETS.issue(_sso_payload(), guard_hash=guard_hash))

    assert asyncio.run(SSO_TICKETS.redeem(code, "wrong-guard")) is None
    assert asyncio.run(SSO_TICKETS.redeem(code, guard)) is None


def test_redeem_unknown_code_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _FakeRedisClient())

    assert asyncio.run(SSO_TICKETS.redeem("does-not-exist", "any-guard-value")) is None


def test_redeem_empty_code_returns_none_without_touching_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    # A blank ticket is never valid; short-circuit before any Redis call so
    # a missing/blank query param can't even reach the client.
    monkeypatch.setattr(_GET_REDIS, lambda: (_ for _ in ()).throw(AssertionError("should not be called")))

    assert asyncio.run(SSO_TICKETS.redeem("", "any-guard-value")) is None


def test_issue_stores_under_prefixed_key_with_60s_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class _CapturingRedis:
        async def set(self, key: str, value: str, ex: int | None = None) -> None:
            captured.update(key=key, value=value, ex=ex)

    _use_redis(monkeypatch, _CapturingRedis())

    code = asyncio.run(SSO_TICKETS.issue(_sso_payload()))

    assert captured["key"] == f"sso:ticket:{code}"
    assert captured["ex"] == 60


def test_issue_raises_when_redis_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    # issue() has no safe fallback -- cookies can't cross the registrable
    # domain boundary, so a ticket nobody could ever redeem is worse than an
    # explicit failure. Must raise, not swallow.
    _use_redis(monkeypatch, _DownRedisClient())

    with pytest.raises(RedisConnectionError):
        asyncio.run(SSO_TICKETS.issue(_sso_payload()))


def test_redeem_fails_closed_when_redis_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_redis(monkeypatch, _DownRedisClient())

    assert asyncio.run(SSO_TICKETS.redeem("some-code", "any-guard-value")) is None


def test_redeem_discards_corrupted_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    class _CorruptRedis:
        async def getdel(self, key: str) -> str:
            return "definitely-not-json"

    _use_redis(monkeypatch, _CorruptRedis())

    assert asyncio.run(SSO_TICKETS.redeem("some-code", "any-guard-value")) is None
