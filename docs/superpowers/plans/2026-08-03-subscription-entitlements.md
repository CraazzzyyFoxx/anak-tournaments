# Subscription Entitlements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a provider-agnostic subscription module that reports whether a site user has an active subscription to a workspace's author and at what tier, surface it as a first-class account row on the registration form, and hard-gate tournament check-in on a configurable requirement — one provider, all of several, or any one of several.

**Architecture:** A new `backend/shared/subscriptions/` package exposing a batched, tri-state resolver (`resolve_subscriptions`) behind a provider `Protocol`, plus a pure composition layer that folds per-provider verdicts into one admission outcome using **Kleene three-valued logic** (`any`/`all` over `{satisfied, refused, undetermined}`). Verdicts are persisted in a new `subscriptions` schema and read from the DB by list views; live provider calls happen on demand and on a TTL. Three providers: Boosty-via-Discord-roles (primary), Boosty-via-challenge-code (fallback), Twitch Helix. The check-in gate is bolted in beside the existing `require_open_profile` gate, whose tri-state fail-open contract this deliberately copies.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, Alembic, FastStream/RabbitMQ RPC, `discord.py`, `httpx`, pytest. Frontend: Next.js App Router, TanStack Query, next-intl, Tailwind.

**Design doc:** `docs/superpowers/specs/2026-08-03-subscription-entitlements-design.md` — read it first. It records the hard constraint (Boosty has no OAuth), the verified Discord/Twitch API facts, the requirement-composition truth table, and a 15-entry decision log.

---

## Orientation for the implementing engineer

Read this section before Task 1. It will save you from the mistakes this codebase punishes.

### The precedent you are copying

`backend/shared/services/profile_visibility.py` contains `resolve_profiles_open`. Read it — it is 77 lines and it is the template for this entire feature:

- Batched: takes a sequence, returns `dict[id, verdict]`. Never one call per row.
- Tri-state: `True` / `False` / `None`, where `None` means "unknown" and **fails open**.
- Consumed by both a hard gate (`public_rpc._reg_pub_check_in`) and a display badge (`ProfileStatusBadge`).

Your `resolve_subscriptions` mirrors this shape exactly. If you find yourself writing a boolean, stop — a provider outage must be distinguishable from a cancelled subscription.

### The exact file surface for a new form flag

`require_open_profile` is the precedent for the two new `registration_form` columns. Every file it touches, yours must touch:

| Layer | File |
|---|---|
| Migration | `backend/migrations/versions/openprof0001_add_registration_open_profile.py` |
| Model | `backend/shared/models/registration/registration.py:47` |
| Schemas | `backend/tournament-service/src/schemas/registration.py:56,70` |
| Read builder | `backend/tournament-service/src/schemas/registration_build.py:103` |
| Serializer | `backend/tournament-service/src/services/registration/serializers.py:114` |
| Service (upsert) | `backend/tournament-service/src/services/registration/service.py:832,842` |
| Public RPC | `backend/tournament-service/src/rpc/public_rpc.py:253,347` |
| FE admin types | `frontend/src/types/balancer-admin.types.ts:345,356` |
| FE form builder | `frontend/src/components/balancer/form/RegistrationFormBuilder.tsx:88,127` |
| FE wizard | `frontend/src/app/admin/tournaments/new/wizard-model.ts:46`, `steps/RegistrationStep.tsx:38`, `steps/ReviewStep.tsx:133`, `new/page.tsx:148` |
| FE participant table | `frontend/src/app/(site)/tournaments/[id]/_views/_components/participantsColumns.tsx:761,786`, `_views/TournamentParticipantsPage.tsx:1030` |
| FE admin table | `frontend/src/components/balancer/registrations/RegistrationsTable.tsx:346` |

Grep `require_open_profile` before you start and again before you finish. Anything it appears in and yours does not is a bug.

### Things that will bite you

- **Never hardcode `down_revision`, and never chain off an uncommitted revision.** Run `alembic heads` — it is authoritative. (An earlier draft of this plan claimed four heads based on a naive text scan of `down_revision` lines; alembic itself reported a single head, `logretry0001`, which turned out to be *uncommitted* local work. `subs0001` therefore chains off `statidx001`, the last committed revision on that lineage: referencing an untracked revision would leave the migration dangling for anyone checking out the commit without that WIP.) Apply with `alembic upgrade heads` (plural) — branched heads are normal here.
- **`SocialProvider.BOOSTY` must stay out of `OAUTH_PROVIDERS`.** `backend/shared/tests/test_social.py:19` asserts `not is_oauth_provider(SocialProvider.BOOSTY)`. That assertion is correct and stays. Boosty is not an OAuth provider and never will be.
- **The Discord bot must use `fetch_member`, not `get_member`.** `get_member` reads a cache that is only populated via the privileged `GUILD_MEMBERS` intent, which the bot does not have; it will silently return `None` for everyone. `fetch_member` is a REST call with no intent guard. This was verified against `discord.py` source — see the design doc's fact table.
- **Never fan out `fetch_member` across a list view.** Discord buckets rate limits per `guild_id`, so N users in one guild serialize behind one bucket. List views read the persisted `entitlement` table only.
- **Store challenge codes as `sha256` only.** Same rule the codebase already applies to `csrf` and `guard_hash` in `OAuthService.StatePayload`: raw secrets are never persisted.
- **Never coerce `unknown` to a boolean before composing a multi-provider requirement.** This is the single most likely bug in the whole feature. `any[refused, unknown]` must be `undetermined` (pass), and `all[refused, unknown]` must be `refused` (block). Reaching for `bool(...)` anywhere in `requirement.py` means you have lost the distinction. Task 4 exists to pin this down; do not shortcut it.
- **There is NO `pytest-asyncio` in this repo.** A bare `async def test_…` inside a plain class is collected and then silently NOT awaited — it reports as passing while asserting nothing. Async tests MUST subclass `unittest.IsolatedAsyncioTestCase`, the convention `shared/tests/test_rpc_crud.py` documents ("Runs under stdlib unittest (no pytest-asyncio needed), matching the repo's IsolatedAsyncioTestCase convention"). Every provider/resolver test in Phase 3 is affected.
- **`db.DateTime` is not mypy-legal.** `shared.core.db` does not list `DateTime` in `__all__`, so `--strict` rejects `db.DateTime` (88 pre-existing errors across 28 model files prove the point). Import `DateTime` straight from `sqlalchemy`, as `shared/models/tenancy/workspace.py` already does.

### Commands

```bash
# Backend tests, single file
cd backend && uv run pytest shared/tests/test_subscription_tiers.py -v

# Backend tests, one service
cd backend && uv run pytest tournament-service/tests -v

# Lint
cd backend && uv run ruff check . && uv run mypy shared/subscriptions

# Migration
cd backend && uv run alembic heads && uv run alembic upgrade heads

# Frontend — lint only, NEVER `next build` (see AGENTS.md)
cd frontend && pnpm lint
cd frontend && pnpm test
```

---

## Phase 1 — Pure core (no infrastructure)

Everything in this phase is unit-testable with no DB, no network, no Redis. Build it first so the semantics are locked before any provider exists.

### Task 1: Verdict type and tier normalization

**Files:**
- Create: `backend/shared/subscriptions/__init__.py`
- Create: `backend/shared/subscriptions/types.py`
- Test: `backend/shared/tests/test_subscription_tiers.py`

**Step 1: Write the failing test**

```python
# backend/shared/tests/test_subscription_tiers.py
from datetime import UTC, datetime

import pytest

from shared.subscriptions import (
    SubscriptionState,
    SubscriptionVerdict,
    meets_min_tier,
    normalize_twitch_tier,
)


def _verdict(state: str, tier: int | None) -> SubscriptionVerdict:
    return SubscriptionVerdict(
        state=state,
        tier_rank=tier,
        tier_label=None,
        source="test",
        checked_at=datetime.now(UTC),
        expires_at=None,
    )


class TestMeetsMinTier:
    def test_active_at_or_above_min_passes(self):
        assert meets_min_tier(_verdict("active", 2), min_tier_rank=2) is True
        assert meets_min_tier(_verdict("active", 3), min_tier_rank=2) is True

    def test_active_below_min_fails(self):
        assert meets_min_tier(_verdict("active", 1), min_tier_rank=2) is False

    def test_inactive_fails_regardless_of_tier(self):
        assert meets_min_tier(_verdict("inactive", 5), min_tier_rank=1) is False

    def test_unknown_fails_open(self):
        """A provider outage must never block admission — mirrors resolve_profiles_open."""
        assert meets_min_tier(_verdict("unknown", None), min_tier_rank=3) is True

    def test_active_without_tier_satisfies_min_of_one(self):
        """Providers that prove a subscription but not its level (challenge code at
        the base level) report tier_rank=None; that is 'subscribed at level >= 1'."""
        assert meets_min_tier(_verdict("active", None), min_tier_rank=1) is True
        assert meets_min_tier(_verdict("active", None), min_tier_rank=2) is False


class TestNormalizeTwitchTier:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [("1000", 1), ("2000", 2), ("3000", 3)],
    )
    def test_maps_documented_tiers(self, raw, expected):
        assert normalize_twitch_tier(raw) == expected

    def test_unknown_tier_string_is_none(self):
        assert normalize_twitch_tier("9999") is None
        assert normalize_twitch_tier("") is None
        assert normalize_twitch_tier(None) is None


class TestSubscriptionVerdict:
    def test_is_frozen(self):
        v = _verdict("active", 1)
        with pytest.raises(Exception):
            v.state = "inactive"  # type: ignore[misc]

    def test_state_constants_match_literal(self):
        assert SubscriptionState.ACTIVE == "active"
        assert SubscriptionState.INACTIVE == "inactive"
        assert SubscriptionState.UNKNOWN == "unknown"
```

**Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest shared/tests/test_subscription_tiers.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'shared.subscriptions'`

**Step 3: Write minimal implementation**

```python
# backend/shared/subscriptions/types.py
"""Provider-agnostic subscription entitlement types.

Mirrors the tri-state contract of ``shared.services.profile_visibility``:
``unknown`` means "we could not determine this" and MUST fail open, so a
provider outage is never mistaken for a cancelled subscription.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal, Protocol

__all__ = (
    "SubscriptionSource",
    "SubscriptionState",
    "SubscriptionVerdict",
    "SubscriptionProvider",
    "meets_min_tier",
    "normalize_twitch_tier",
)


class SubscriptionState:
    ACTIVE: Final = "active"
    INACTIVE: Final = "inactive"
    UNKNOWN: Final = "unknown"


class SubscriptionSource:
    DISCORD_ROLE: Final = "discord_role"
    CHALLENGE_CODE: Final = "challenge_code"
    TWITCH_HELIX: Final = "twitch_helix"


@dataclass(frozen=True, slots=True)
class SubscriptionVerdict:
    """One resolved entitlement.

    ``tier_rank`` is normalized across providers so it can be compared against a
    tournament's ``min_tier_rank``. ``None`` on an ``active`` verdict means the
    provider proved a subscription but not its level — treated as level 1.
    ``tier_label`` is display-only and never compared.
    """

    state: Literal["active", "inactive", "unknown"]
    tier_rank: int | None
    tier_label: str | None
    source: str
    checked_at: datetime
    expires_at: datetime | None


class ResolveContext(Protocol):
    """What a provider needs to resolve one user. Deliberately narrow."""

    workspace_id: int
    auth_user_id: int
    config: dict


class SubscriptionProvider(Protocol):
    provider: str

    async def resolve(self, ctx: ResolveContext) -> SubscriptionVerdict: ...


def meets_min_tier(verdict: SubscriptionVerdict, *, min_tier_rank: int) -> bool:
    """Whether ``verdict`` satisfies a ``min_tier_rank`` admission requirement.

    ``unknown`` fails OPEN — identical to the ``require_open_profile`` gate, which
    blocks only on a *confirmed* closed profile.
    """
    if verdict.state == SubscriptionState.UNKNOWN:
        return True
    if verdict.state != SubscriptionState.ACTIVE:
        return False
    return (verdict.tier_rank or 1) >= min_tier_rank


_TWITCH_TIERS: Final[dict[str, int]] = {"1000": 1, "2000": 2, "3000": 3}


def normalize_twitch_tier(raw: str | None) -> int | None:
    """Map Twitch's documented ``tier`` strings to a comparable rank.

    Twitch documents exactly 1000/2000/3000; anything else is unmapped rather
    than guessed.
    """
    return _TWITCH_TIERS.get(raw or "")
```

```python
# backend/shared/subscriptions/__init__.py
from shared.subscriptions.types import (
    SubscriptionProvider,
    SubscriptionSource,
    SubscriptionState,
    SubscriptionVerdict,
    meets_min_tier,
    normalize_twitch_tier,
)

__all__ = (
    "SubscriptionProvider",
    "SubscriptionSource",
    "SubscriptionState",
    "SubscriptionVerdict",
    "meets_min_tier",
    "normalize_twitch_tier",
)
```

**Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest shared/tests/test_subscription_tiers.py -v
```
Expected: PASS, 11 tests.

**Step 5: Commit**

```bash
git add backend/shared/subscriptions backend/shared/tests/test_subscription_tiers.py
git commit -m "feat(subscriptions): add provider-agnostic verdict type and tier normalization"
```

---

### Task 2: Discord role → tier mapping (pure)

The role-id → tier resolution is pure logic and must be tested without Discord. Isolating it here means the provider in Task 7 is a thin I/O shell.

**Files:**
- Create: `backend/shared/subscriptions/discord_roles.py`
- Test: `backend/shared/tests/test_subscription_discord_roles.py`

**Step 1: Write the failing test**

```python
# backend/shared/tests/test_subscription_discord_roles.py
from shared.subscriptions.discord_roles import RoleTier, resolve_role_tier


TIERS = (
    RoleTier(role_id="100", tier_rank=1, tier_label="Уровень 1"),
    RoleTier(role_id="200", tier_rank=2, tier_label="Уровень 2"),
    RoleTier(role_id="300", tier_rank=3, tier_label="Уровень 3"),
)


class TestResolveRoleTier:
    def test_single_matching_role(self):
        assert resolve_role_tier(["200"], TIERS) == TIERS[1]

    def test_highest_tier_wins_when_several_roles_match(self):
        """Boosty leaves lower-level roles in place when a patron upgrades."""
        assert resolve_role_tier(["100", "300", "200"], TIERS) == TIERS[2]

    def test_no_matching_role_returns_none(self):
        assert resolve_role_tier(["999"], TIERS) is None

    def test_empty_roles_returns_none(self):
        assert resolve_role_tier([], TIERS) is None

    def test_empty_mapping_returns_none(self):
        assert resolve_role_tier(["100"], ()) is None

    def test_role_ids_compared_as_strings_not_ints(self):
        """Discord snowflakes exceed 2**53; they must never round-trip via float."""
        big = "1234567890123456789"
        tiers = (RoleTier(role_id=big, tier_rank=1, tier_label="L1"),)
        assert resolve_role_tier([big], tiers) == tiers[0]
```

**Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest shared/tests/test_subscription_discord_roles.py -v
```
Expected: FAIL — `ModuleNotFoundError`.

**Step 3: Write minimal implementation**

```python
# backend/shared/subscriptions/discord_roles.py
"""Map a Discord member's role ids to a subscription tier.

Boosty's own Discord integration assigns a role per subscription level. This
module is the pure half of the ``discord_role`` provider: no Discord client, no
DB, so the mapping rules are unit-testable in isolation.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

__all__ = ("RoleTier", "resolve_role_tier", "parse_role_tiers")


@dataclass(frozen=True, slots=True)
class RoleTier:
    """One configured ``discord role -> subscription tier`` mapping.

    ``role_id`` is a Discord snowflake and is kept as a STRING: snowflakes exceed
    2**53 and must never survive a float round-trip.
    """

    role_id: str
    tier_rank: int
    tier_label: str


def resolve_role_tier(role_ids: Iterable[str], tiers: Sequence[RoleTier]) -> RoleTier | None:
    """Highest-ranked configured tier among ``role_ids``, or ``None``.

    Highest wins because Boosty leaves the lower-level role attached when a
    patron upgrades, so a member legitimately holds several mapped roles.
    """
    held = {str(role_id) for role_id in role_ids}
    matches = [tier for tier in tiers if tier.role_id in held]
    if not matches:
        return None
    return max(matches, key=lambda tier: tier.tier_rank)


def parse_role_tiers(config: dict) -> tuple[RoleTier, ...]:
    """Read ``role_tiers`` out of a provider config blob, skipping malformed rows."""
    parsed: list[RoleTier] = []
    for row in config.get("role_tiers") or []:
        role_id = str(row.get("role_id") or "").strip()
        if not role_id:
            continue
        try:
            tier_rank = int(row.get("tier_rank"))
        except (TypeError, ValueError):
            continue
        parsed.append(
            RoleTier(role_id=role_id, tier_rank=tier_rank, tier_label=str(row.get("tier_label") or ""))
        )
    return tuple(parsed)
```

**Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest shared/tests/test_subscription_discord_roles.py -v
```
Expected: PASS, 6 tests.

**Step 5: Commit**

```bash
git add backend/shared/subscriptions/discord_roles.py backend/shared/tests/test_subscription_discord_roles.py
git commit -m "feat(subscriptions): map discord roles to subscription tiers"
```

---

### Task 3: Challenge-code hashing and redemption rules (pure)

**Files:**
- Create: `backend/shared/subscriptions/challenge_code.py`
- Test: `backend/shared/tests/test_subscription_challenge_code.py`

**Step 1: Write the failing test**

```python
# backend/shared/tests/test_subscription_challenge_code.py
from datetime import UTC, datetime, timedelta

from shared.subscriptions.challenge_code import (
    CodeTier,
    hash_code,
    match_code,
    parse_code_tiers,
)

NOW = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)


def _tier(code: str, rank: int, expires: datetime | None = None) -> CodeTier:
    return CodeTier(code_sha256=hash_code(code), tier_rank=rank, tier_label=f"L{rank}", expires_at=expires)


class TestHashCode:
    def test_is_stable_hex_sha256(self):
        assert hash_code("abc") == hash_code("abc")
        assert len(hash_code("abc")) == 64

    def test_is_case_and_whitespace_insensitive(self):
        """Patrons paste codes out of a post; casing and stray spaces are noise."""
        assert hash_code("  AbC ") == hash_code("abc")

    def test_different_codes_differ(self):
        assert hash_code("abc") != hash_code("abd")


class TestMatchCode:
    def test_matching_code_returns_tier(self):
        tiers = (_tier("secret", 2),)
        assert match_code("secret", tiers, now=NOW) == tiers[0]

    def test_normalizes_submitted_code(self):
        tiers = (_tier("secret", 2),)
        assert match_code(" SECRET ", tiers, now=NOW) == tiers[0]

    def test_wrong_code_returns_none(self):
        assert match_code("nope", (_tier("secret", 2),), now=NOW) is None

    def test_expired_code_returns_none(self):
        expired = (_tier("secret", 2, expires=NOW - timedelta(seconds=1)),)
        assert match_code("secret", expired, now=NOW) is None

    def test_code_expiring_in_future_still_matches(self):
        live = (_tier("secret", 2, expires=NOW + timedelta(days=1)),)
        assert match_code("secret", live, now=NOW) is not None

    def test_empty_submission_never_matches(self):
        assert match_code("", (_tier("secret", 2),), now=NOW) is None
        assert match_code("   ", (_tier("secret", 2),), now=NOW) is None

    def test_highest_tier_wins_on_duplicate_code(self):
        """A misconfigured config must not silently downgrade a patron."""
        tiers = (_tier("secret", 1), _tier("secret", 3))
        assert match_code("secret", tiers, now=NOW).tier_rank == 3


class TestParseCodeTiers:
    def test_skips_rows_without_hash(self):
        assert parse_code_tiers({"codes": [{"tier_rank": 1}]}) == ()

    def test_skips_rows_with_unparseable_rank(self):
        assert parse_code_tiers({"codes": [{"code_sha256": "x" * 64, "tier_rank": "abc"}]}) == ()

    def test_missing_codes_key_yields_empty(self):
        assert parse_code_tiers({}) == ()
```

**Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest shared/tests/test_subscription_challenge_code.py -v
```
Expected: FAIL — `ModuleNotFoundError`.

**Step 3: Write minimal implementation**

```python
# backend/shared/subscriptions/challenge_code.py
"""Challenge-code fallback for providers with no API (Boosty).

The author publishes a secret code inside a post restricted to a subscription
level; redeeming the code proves the patron can read that level. Only the
SHA-256 digest is ever persisted -- the same discipline the OAuth state applies
to ``csrf``/``guard_hash``.

This proves ACCESS TO A LEVEL, not identity: a code is shareable. Rotate codes
per tournament.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

__all__ = ("CodeTier", "hash_code", "match_code", "parse_code_tiers")


@dataclass(frozen=True, slots=True)
class CodeTier:
    code_sha256: str
    tier_rank: int
    tier_label: str
    expires_at: datetime | None


def _normalize(code: str | None) -> str:
    return (code or "").strip().casefold()


def hash_code(code: str) -> str:
    """SHA-256 hex of the normalized code. Casing/whitespace are noise."""
    return hashlib.sha256(_normalize(code).encode("utf-8")).hexdigest()


def match_code(submitted: str | None, tiers: Sequence[CodeTier], *, now: datetime) -> CodeTier | None:
    """Highest live tier whose code matches ``submitted``, or ``None``.

    Highest wins so a duplicated code in config cannot silently downgrade a patron.
    """
    normalized = _normalize(submitted)
    if not normalized:
        return None
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    live = [
        tier
        for tier in tiers
        if tier.code_sha256 == digest and (tier.expires_at is None or tier.expires_at > now)
    ]
    if not live:
        return None
    return max(live, key=lambda tier: tier.tier_rank)


def parse_code_tiers(config: dict) -> tuple[CodeTier, ...]:
    """Read ``codes`` out of a provider config blob, skipping malformed rows."""
    parsed: list[CodeTier] = []
    for row in config.get("codes") or []:
        digest = str(row.get("code_sha256") or "").strip()
        if not digest:
            continue
        try:
            tier_rank = int(row.get("tier_rank"))
        except (TypeError, ValueError):
            continue
        parsed.append(
            CodeTier(
                code_sha256=digest,
                tier_rank=tier_rank,
                tier_label=str(row.get("tier_label") or ""),
                expires_at=row.get("expires_at"),
            )
        )
    return tuple(parsed)
```

**Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest shared/tests/test_subscription_challenge_code.py -v
```
Expected: PASS, 13 tests.

**Step 5: Commit**

```bash
git add backend/shared/subscriptions/challenge_code.py backend/shared/tests/test_subscription_challenge_code.py
git commit -m "feat(subscriptions): add challenge-code hashing and redemption rules"
```

---

### Task 4: Requirement composition — Kleene three-valued logic (pure)

**This is the task most likely to be got subtly wrong, so it is pure and tested exhaustively.**

A tournament can require a subscription on one provider, on **all** of several, or on **any one of** several, each with its own `min_tier_rank`. Composing tri-state verdicts is not boolean logic: `unknown` must not be coerced to either side before combining, or fail-open breaks in one direction and fails *closed* in the other. See "Composing requirements" in the design doc.

**Files:**
- Create: `backend/shared/subscriptions/requirement.py`
- Modify: `backend/shared/subscriptions/__init__.py` (re-export)
- Test: `backend/shared/tests/test_subscription_requirement.py`

**Step 1: Write the failing test**

```python
# backend/shared/tests/test_subscription_requirement.py
from datetime import UTC, datetime

import pytest

from shared.subscriptions import SubscriptionVerdict
from shared.subscriptions.requirement import (
    Outcome,
    ProviderRequirement,
    SubscriptionRequirement,
    evaluate_requirement,
    parse_requirement,
)


def _v(state: str, tier: int | None = None) -> SubscriptionVerdict:
    return SubscriptionVerdict(
        state=state,
        tier_rank=tier,
        tier_label=None,
        source="test",
        checked_at=datetime.now(UTC),
        expires_at=None,
    )


T = _v("active", 3)      # satisfies min_tier_rank <= 3
F = _v("inactive")       # confirmed refusal
U = _v("unknown")        # undetermined


def _req(mode: str, *providers: str, min_tier: int = 1) -> SubscriptionRequirement:
    return SubscriptionRequirement(
        mode=mode,
        requirements=tuple(
            ProviderRequirement(provider=p, min_tier_rank=min_tier) for p in providers
        ),
    )


class TestSingleProvider:
    """One requirement: both modes must agree — no special-casing in the code."""

    @pytest.mark.parametrize("mode", ["any", "all"])
    def test_satisfied(self, mode):
        assert evaluate_requirement(_req(mode, "boosty"), {"boosty": T}) is Outcome.SATISFIED

    @pytest.mark.parametrize("mode", ["any", "all"])
    def test_refused(self, mode):
        assert evaluate_requirement(_req(mode, "boosty"), {"boosty": F}) is Outcome.REFUSED

    @pytest.mark.parametrize("mode", ["any", "all"])
    def test_undetermined(self, mode):
        assert evaluate_requirement(_req(mode, "boosty"), {"boosty": U}) is Outcome.UNDETERMINED


class TestAllMode:
    def test_all_satisfied(self):
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": T, "twitch": T}) is Outcome.SATISFIED

    def test_any_refusal_refuses(self):
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": T, "twitch": F}) is Outcome.REFUSED

    def test_refusal_beats_undetermined(self):
        """F dominates in `all` — certainty of failure outranks uncertainty."""
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": F, "twitch": U}) is Outcome.REFUSED

    def test_undetermined_without_refusal_is_undetermined(self):
        """A Boosty outage must not block a patron who is verified on Twitch."""
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": U, "twitch": T}) is Outcome.UNDETERMINED


class TestAnyMode:
    def test_one_satisfied_is_enough(self):
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": F, "twitch": T}) is Outcome.SATISFIED

    def test_satisfied_beats_undetermined(self):
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": U, "twitch": T}) is Outcome.SATISFIED

    def test_all_refused_refuses(self):
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": F, "twitch": F}) is Outcome.REFUSED

    def test_undetermined_rescues_a_refusal(self):
        """THE regression this task exists to prevent: coercing U to False here would
        block every Boosty-less patron whenever Twitch is down."""
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": F, "twitch": U}) is Outcome.UNDETERMINED

    def test_all_undetermined_is_undetermined(self):
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": U, "twitch": U}) is Outcome.UNDETERMINED


class TestThresholds:
    def test_tier_below_threshold_is_a_refusal_not_undetermined(self):
        req = _req("all", "boosty", min_tier=3)
        assert evaluate_requirement(req, {"boosty": _v("active", 1)}) is Outcome.REFUSED

    def test_per_provider_thresholds_are_independent(self):
        """Boosty 'Уровень 2' and Twitch 'Tier 2' are unrelated scales."""
        req = SubscriptionRequirement(
            mode="all",
            requirements=(
                ProviderRequirement(provider="boosty", min_tier_rank=3),
                ProviderRequirement(provider="twitch", min_tier_rank=1),
            ),
        )
        verdicts = {"boosty": _v("active", 3), "twitch": _v("active", 1)}
        assert evaluate_requirement(req, verdicts) is Outcome.SATISFIED

    def test_active_without_tier_meets_min_of_one(self):
        assert evaluate_requirement(_req("all", "boosty", min_tier=1), {"boosty": _v("active", None)}) is Outcome.SATISFIED


class TestMissingVerdicts:
    def test_absent_provider_is_undetermined_not_refused(self):
        """An unconfigured/disabled provider is the organizer's problem, not the
        patron's — it must never read as 'not subscribed'."""
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": T}) is Outcome.UNDETERMINED

    def test_empty_requirement_list_is_satisfied(self):
        """Nothing required means nothing to block on."""
        assert evaluate_requirement(_req("all"), {}) is Outcome.SATISFIED
        assert evaluate_requirement(_req("any"), {}) is Outcome.SATISFIED


class TestBlocksCheckIn:
    """The gate's only question. Blocks IFF the outcome is REFUSED."""

    def test_only_refused_blocks(self):
        assert Outcome.REFUSED.blocks_check_in is True
        assert Outcome.UNDETERMINED.blocks_check_in is False
        assert Outcome.SATISFIED.blocks_check_in is False


class TestParseRequirement:
    def test_reads_mode_and_requirements(self):
        req = parse_requirement(
            {"mode": "any", "requirements": [{"provider": "boosty", "min_tier_rank": 2}]}
        )
        assert req.mode == "any"
        assert req.requirements == (ProviderRequirement(provider="boosty", min_tier_rank=2),)

    def test_defaults_mode_to_all(self):
        assert parse_requirement({"requirements": []}).mode == "all"

    def test_rejects_unknown_mode(self):
        with pytest.raises(ValueError, match="mode"):
            parse_requirement({"mode": "most", "requirements": []})

    def test_defaults_min_tier_rank_to_one(self):
        req = parse_requirement({"requirements": [{"provider": "boosty"}]})
        assert req.requirements[0].min_tier_rank == 1

    def test_skips_rows_without_provider(self):
        assert parse_requirement({"requirements": [{"min_tier_rank": 2}]}).requirements == ()

    def test_deduplicates_provider_keeping_strictest_threshold(self):
        req = parse_requirement(
            {
                "requirements": [
                    {"provider": "boosty", "min_tier_rank": 1},
                    {"provider": "boosty", "min_tier_rank": 3},
                ]
            }
        )
        assert req.requirements == (ProviderRequirement(provider="boosty", min_tier_rank=3),)

    def test_providers_property_lists_distinct_providers(self):
        req = parse_requirement(
            {"requirements": [{"provider": "boosty"}, {"provider": "twitch"}]}
        )
        assert set(req.providers) == {"boosty", "twitch"}

    def test_empty_blob_yields_empty_requirement(self):
        assert parse_requirement({}).requirements == ()
        assert parse_requirement(None).requirements == ()
```

**Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest shared/tests/test_subscription_requirement.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'shared.subscriptions.requirement'`

**Step 3: Write minimal implementation**

```python
# backend/shared/subscriptions/requirement.py
"""Compose per-provider subscription verdicts into one admission answer.

A tournament may require a subscription on one provider, on ALL of several, or on
ANY ONE of several, each with its own ``min_tier_rank`` (Boosty "Уровень 2" and
Twitch "Tier 2" are unrelated scales).

Composition uses **Kleene three-valued logic**, NOT boolean logic with ``unknown``
coerced to a side. Coercing ``unknown`` to false would make ``any[refused,
unknown]`` block, so one provider's outage would lock out every patron subscribed
via the other. Coercing it to true would make ``all[refused, unknown]`` pass,
admitting a confirmed non-subscriber. Kleene is the only mapping that preserves
"block only on certainty" in both modes.

The gate blocks IFF the composed outcome is ``REFUSED``.
"""

from __future__ import annotations

import enum
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, Literal

from shared.subscriptions.types import SubscriptionState, SubscriptionVerdict, meets_min_tier

__all__ = (
    "Outcome",
    "ProviderRequirement",
    "SubscriptionRequirement",
    "evaluate_requirement",
    "parse_requirement",
)

MODE_ALL: Final = "all"
MODE_ANY: Final = "any"
_MODES: Final = frozenset({MODE_ALL, MODE_ANY})


class Outcome(enum.Enum):
    """Kleene truth value of a composed requirement."""

    SATISFIED = "satisfied"        # T
    REFUSED = "refused"            # F
    UNDETERMINED = "undetermined"  # U

    @property
    def blocks_check_in(self) -> bool:
        """Only certainty of failure blocks. ``UNDETERMINED`` fails open."""
        return self is Outcome.REFUSED


@dataclass(frozen=True, slots=True)
class ProviderRequirement:
    provider: str
    min_tier_rank: int = 1


@dataclass(frozen=True, slots=True)
class SubscriptionRequirement:
    mode: Literal["any", "all"]
    requirements: tuple[ProviderRequirement, ...]

    @property
    def providers(self) -> tuple[str, ...]:
        return tuple(req.provider for req in self.requirements)


def _evaluate_one(req: ProviderRequirement, verdict: SubscriptionVerdict | None) -> Outcome:
    # No verdict at all: the provider is unconfigured, disabled, or was not
    # resolved. That is the organizer's problem, never read as "not subscribed".
    if verdict is None or verdict.state == SubscriptionState.UNKNOWN:
        return Outcome.UNDETERMINED
    # meets_min_tier already fails open on unknown, which is handled above; here
    # it is a pure active/threshold comparison.
    return Outcome.SATISFIED if meets_min_tier(verdict, min_tier_rank=req.min_tier_rank) else Outcome.REFUSED


def evaluate_requirement(
    requirement: SubscriptionRequirement,
    verdicts: Mapping[str, SubscriptionVerdict],
) -> Outcome:
    """Compose ``requirement`` over ``verdicts`` keyed by provider."""
    if not requirement.requirements:
        return Outcome.SATISFIED

    outcomes = [_evaluate_one(req, verdicts.get(req.provider)) for req in requirement.requirements]

    if requirement.mode == MODE_ALL:
        # Kleene AND: F dominates, then U.
        if any(o is Outcome.REFUSED for o in outcomes):
            return Outcome.REFUSED
        if any(o is Outcome.UNDETERMINED for o in outcomes):
            return Outcome.UNDETERMINED
        return Outcome.SATISFIED

    # Kleene OR: T dominates, then U.
    if any(o is Outcome.SATISFIED for o in outcomes):
        return Outcome.SATISFIED
    if any(o is Outcome.UNDETERMINED for o in outcomes):
        return Outcome.UNDETERMINED
    return Outcome.REFUSED


def parse_requirement(blob: dict | None) -> SubscriptionRequirement:
    """Read ``subscription_requirement_json`` into a validated requirement.

    Malformed rows are skipped rather than raising: a bad config row must not 500
    the check-in endpoint. An unknown ``mode``, however, IS an error — silently
    picking a mode would change the admission rule.
    """
    blob = blob or {}
    mode = str(blob.get("mode") or MODE_ALL)
    if mode not in _MODES:
        raise ValueError(f"Unsupported subscription requirement mode: {mode!r}")

    # Deduplicate by provider, keeping the strictest threshold, so a duplicated
    # config row cannot accidentally loosen the rule.
    strictest: dict[str, int] = {}
    for row in blob.get("requirements") or []:
        provider = str(row.get("provider") or "").strip()
        if not provider:
            continue
        try:
            min_tier_rank = int(row.get("min_tier_rank", 1))
        except (TypeError, ValueError):
            min_tier_rank = 1
        min_tier_rank = max(min_tier_rank, 1)
        strictest[provider] = max(strictest.get(provider, 0), min_tier_rank)

    return SubscriptionRequirement(
        mode=mode,  # type: ignore[arg-type]
        requirements=tuple(
            ProviderRequirement(provider=p, min_tier_rank=r) for p, r in strictest.items()
        ),
    )
```

Re-export `Outcome`, `ProviderRequirement`, `SubscriptionRequirement`, `evaluate_requirement`, `parse_requirement` from `backend/shared/subscriptions/__init__.py`.

**Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest shared/tests/test_subscription_requirement.py -v
```
Expected: PASS, 29 tests.

**Step 5: Commit**

```bash
git add backend/shared/subscriptions/requirement.py backend/shared/subscriptions/__init__.py backend/shared/tests/test_subscription_requirement.py
git commit -m "feat(subscriptions): compose multi-provider requirements with kleene logic"
```

---

## Phase 2 — Persistence

### Task 5: Models for `provider_config` and `entitlement`

**Files:**
- Create: `backend/shared/models/subscriptions/__init__.py`
- Create: `backend/shared/models/subscriptions/subscription.py`
- Modify: `backend/shared/models/__init__.py` (export the two models beside the existing model exports)
- Test: `backend/shared/tests/test_subscription_models.py`

**Step 1: Write the failing test**

Model-shape tests in this repo assert table/constraint metadata without a live DB — follow `backend/shared/tests/test_balancer_registration_member.py` for the established style.

```python
# backend/shared/tests/test_subscription_models.py
from shared import models


class TestProviderConfig:
    def test_lives_in_subscriptions_schema(self):
        assert models.SubscriptionProviderConfig.__table__.schema == "subscriptions"

    def test_workspace_provider_is_unique(self):
        uniques = {
            tuple(c.name for c in constraint.columns)
            for constraint in models.SubscriptionProviderConfig.__table__.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
        }
        assert ("workspace_id", "provider") in uniques

    def test_workspace_fk_cascades(self):
        fk = next(iter(models.SubscriptionProviderConfig.__table__.c.workspace_id.foreign_keys))
        assert fk.ondelete == "CASCADE"


class TestEntitlement:
    def test_lives_in_subscriptions_schema(self):
        assert models.SubscriptionEntitlement.__table__.schema == "subscriptions"

    def test_one_row_per_workspace_user_provider(self):
        uniques = {
            tuple(c.name for c in constraint.columns)
            for constraint in models.SubscriptionEntitlement.__table__.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
        }
        assert ("workspace_id", "auth_user_id", "provider") in uniques

    def test_auth_user_fk_cascades(self):
        fk = next(iter(models.SubscriptionEntitlement.__table__.c.auth_user_id.foreign_keys))
        assert fk.ondelete == "CASCADE"

    def test_state_defaults_to_unknown(self):
        assert models.SubscriptionEntitlement.__table__.c.state.server_default.arg == "unknown"

    def test_tier_rank_is_nullable(self):
        """An active-but-levelless verdict (base challenge code) has no rank."""
        assert models.SubscriptionEntitlement.__table__.c.tier_rank.nullable is True

    def test_has_index_for_bulk_workspace_reads(self):
        """List views read every registrant's verdict for one workspace+provider."""
        indexed = {tuple(c.name for c in idx.columns) for idx in models.SubscriptionEntitlement.__table__.indexes}
        assert ("workspace_id", "provider") in indexed
```

**Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest shared/tests/test_subscription_models.py -v
```
Expected: FAIL — `AttributeError: module 'shared.models' has no attribute 'SubscriptionProviderConfig'`.

**Step 3: Write minimal implementation**

```python
# backend/shared/models/subscriptions/subscription.py
"""Persisted subscription entitlements and per-workspace provider config.

Verdicts are persisted, not Redis-only, for three reasons: admin list views must
render hundreds of verdicts without a live provider call each (Discord rate-limits
per guild, so a fan-out serializes); admission decisions need an audit trail; and
this mirrors how ``overwatch_rank.battle_tag_state`` backs ``resolve_profiles_open``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("SubscriptionProviderConfig", "SubscriptionEntitlement")

SUBSCRIPTIONS_SCHEMA = "subscriptions"


class SubscriptionProviderConfig(db.TimeStampIntegerMixin):
    """How one workspace verifies subscriptions with one provider.

    ``config_json`` is provider-shaped:
    - ``discord_role``:   ``{guild_id, role_tiers: [{role_id, tier_rank, tier_label}]}``
    - ``challenge_code``: ``{codes: [{code_sha256, tier_rank, tier_label, expires_at}]}``
    - ``twitch_helix``:   ``{broadcaster_login, broadcaster_id}``

    Challenge codes are stored as SHA-256 digests only -- never plaintext.
    """

    __tablename__ = "provider_config"
    __table_args__ = (
        UniqueConstraint("workspace_id", "provider", name="uq_subscription_config_workspace_provider"),
        {"schema": SUBSCRIPTIONS_SCHEMA},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="false", default=False)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, server_default="{}", default=dict)


class SubscriptionEntitlement(db.TimeStampIntegerMixin):
    """Last-known subscription verdict for one (workspace, user, provider).

    ``state`` is the tri-state contract from ``shared.subscriptions``:
    ``active`` / ``inactive`` / ``unknown``, where ``unknown`` fails open.
    ``tier_rank`` is nullable: a provider can prove a subscription without
    proving its level.
    """

    __tablename__ = "entitlement"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "auth_user_id", "provider", name="uq_subscription_entitlement_scope"
        ),
        Index("ix_subscription_entitlement_workspace_provider", "workspace_id", "provider"),
        {"schema": SUBSCRIPTIONS_SCHEMA},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    auth_user_id: Mapped[int] = mapped_column(ForeignKey("auth.user.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)

    state: Mapped[str] = mapped_column(String(16), nullable=False, server_default="unknown", default="unknown")
    tier_rank: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    tier_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)

    checked_at: Mapped[datetime | None] = mapped_column(db.DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(db.DateTime(timezone=True), nullable=True)
    evidence_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
```

```python
# backend/shared/models/subscriptions/__init__.py
from shared.models.subscriptions.subscription import (
    SubscriptionEntitlement,
    SubscriptionProviderConfig,
)

__all__ = ("SubscriptionEntitlement", "SubscriptionProviderConfig")
```

Then add both names to `backend/shared/models/__init__.py`, matching how the neighbouring model packages are re-exported there (import + `__all__` entry).

**Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest shared/tests/test_subscription_models.py -v
```
Expected: PASS, 9 tests.

**Step 5: Commit**

```bash
git add backend/shared/models/subscriptions backend/shared/models/__init__.py backend/shared/tests/test_subscription_models.py
git commit -m "feat(subscriptions): add provider_config and entitlement models"
```

---

### Task 6: Alembic migration

**Files:**
- Create: `backend/migrations/versions/subs0001_add_subscription_tables.py`

**Step 1: Find the real head — do not guess**

```bash
cd backend && uv run alembic heads
```
Do not trust a text scan of the migration files for this — `alembic heads` is the only
authoritative answer, and it may report a head that is not committed yet. Chain off the newest
**committed** revision on the lineage you are extending, never off someone's uncommitted WIP,
and record the choice and the reason in the docstring.

**Step 2: Write the migration**

```python
"""add_subscription_tables

Creates the ``subscriptions`` schema with ``provider_config`` (per-workspace
provider setup) and ``entitlement`` (last-known verdict per workspace+user+provider).

Revision ID: subs0001
Revises: <PUT THE REVISION FROM `alembic heads` HERE>
Create Date: 2026-08-03
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "subs0001"
down_revision: str | None = None  # <-- replace with the id from `alembic heads`
branch_labels = None
depends_on = None

SCHEMA = "subscriptions"


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")

    op.create_table(
        "provider_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("config_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("workspace_id", "provider", name="uq_subscription_config_workspace_provider"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_subscriptions_provider_config_workspace_id",
        "provider_config",
        ["workspace_id"],
        schema=SCHEMA,
    )

    op.create_table(
        "entitlement",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("auth_user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("tier_rank", sa.Integer(), nullable=True),
        sa.Column("tier_label", sa.String(64), nullable=True),
        sa.Column("source", sa.String(32), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evidence_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "workspace_id", "auth_user_id", "provider", name="uq_subscription_entitlement_scope"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_subscription_entitlement_workspace_provider",
        "entitlement",
        ["workspace_id", "provider"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_subscriptions_entitlement_auth_user_id", "entitlement", ["auth_user_id"], schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_table("entitlement", schema=SCHEMA)
    op.drop_table("provider_config", schema=SCHEMA)
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
```

Confirm the `created_at`/`updated_at` column spelling against `db.TimeStampIntegerMixin` before running — if the mixin names them differently, match the mixin, not this snippet.

**Step 3: Apply and verify**

```bash
cd backend && uv run alembic upgrade heads
```
Expected: no error. Verify: `\dt subscriptions.*` in psql lists both tables.

**Step 4: Verify the downgrade actually reverses**

```bash
cd backend && uv run alembic downgrade -1 && uv run alembic upgrade heads
```
Expected: both directions clean. A migration whose downgrade is untested is not finished.

**Step 5: Commit**

```bash
git add backend/migrations/versions/subs0001_add_subscription_tables.py
git commit -m "feat(subscriptions): add subscriptions schema migration"
```

---

## Phase 3 — Providers and resolver

### Task 7: Discord role provider

**Files:**
- Create: `backend/shared/subscriptions/providers/__init__.py`
- Create: `backend/shared/subscriptions/providers/discord_role.py`
- Test: `backend/shared/tests/test_subscription_provider_discord.py`

Depends on Task 2. The provider is a thin I/O shell over `resolve_role_tier`; inject the member-fetch as a callable so tests need no Discord.

Required behaviour, one test each:

| Situation | Verdict |
|---|---|
| Member holds a mapped role | `active`, tier from `resolve_role_tier` |
| Member holds several mapped roles | `active`, highest tier |
| Member exists, holds no mapped role | `inactive` |
| Member not in guild (`404`/`NotFound`) | `inactive` — a non-member is not subscribed, and 404s do not count toward Discord's invalid-request ban budget |
| Bot lacks guild access (`403`/`Forbidden`) | `unknown` — misconfiguration, must fail open |
| Discord `5xx` / timeout | `unknown` |
| User has no linked verified Discord account | `unknown`, without any HTTP call |
| Config has no `guild_id` | `unknown`, without any HTTP call |
| A mapped `role_id` is absent from the guild's role list | `unknown` — mapping drift must not read as "not subscribed" (design doc, Risks) |

`source` is always `SubscriptionSource.DISCORD_ROLE`. `evidence_json` records the matched `role_id` and the raw role-id list.

Commit: `feat(subscriptions): add discord-role provider for boosty tiers`

---

### Task 8: Twitch Helix provider

**Files:**
- Create: `backend/shared/subscriptions/providers/twitch_helix.py`
- Modify: `backend/identity-service/src/services/oauth_service.py` — add `user:read:subscriptions` to `TwitchOAuthProvider.get_authorization_url` scope
- Test: `backend/shared/tests/test_subscription_provider_twitch.py`
- Test: `backend/identity-service/tests/test_oauth_providers.py` — extend with a scope assertion

Reuse the `_http_client()` + `PROXY_CONF` pattern from `oauth_service.py`; do not open a second connection-pool style.

Required behaviour:

| Situation | Verdict |
|---|---|
| `200` with a subscription row | `active`, `normalize_twitch_tier(tier)`; `is_gift` into `evidence_json` |
| `404` (documented "not subscribed") | `inactive` |
| `401` | refresh the token via the stored `refresh_token`, retry once; still `401` → `unknown` |
| Token lacks `user:read:subscriptions` | `unknown` with `evidence_json.reason = "missing_scope"` so the UI can render the reconnect CTA |
| No Twitch `OAuthConnection` | `unknown`, no HTTP call |
| Broadcaster not Affiliate/Partner (`400`) | `unknown` with a distinguishing reason — an organizer configuration problem, not a patron problem |
| `5xx` / timeout | `unknown` |

Also add a test asserting `user:read:subscriptions` is present in the Twitch authorize URL, and one asserting the existing `user:read:email` was not dropped.

Commit: `feat(subscriptions): add twitch helix provider and request subscription scope`

---

### Task 9: The resolver

**Files:**
- Create: `backend/shared/services/subscription_entitlements.py`
- Test: `backend/shared/tests/test_resolve_subscriptions.py`

This is the module's raw-verdict face. Signature mirrors `resolve_profiles_open`, widened by
one dimension because a tournament may require several providers at once:

```python
async def resolve_subscriptions(
    session: AsyncSession,
    *,
    workspace_id: int,
    auth_user_ids: Sequence[int],
    providers: Sequence[str],
    force_refresh: bool = False,
) -> dict[int, dict[str, SubscriptionVerdict]]:
```

Outer key is the user, inner key the provider.

Required behaviour:

- A provider that is not configured or has `enabled=False` maps to `unknown` for every id. No provider calls for it. Other requested providers still resolve normally — one misconfigured provider must not blank out the rest.
- Fresh persisted rows (`checked_at` within TTL, `expires_at` in the future) are returned as-is. **No provider calls** — assert this with a fetch-callable that raises if invoked.
- Stale or missing rows are resolved live, then upserted.
- `force_refresh=True` ignores freshness. Used only for the single acting user at check-in, never for a list.
- A single user's provider failure yields `unknown` for that `(user, provider)` and does not abort the batch, nor affect that user's other providers.
- Empty `auth_user_ids` **or** empty `providers` returns `{}` and touches neither DB nor provider.
- Every requested id appears in the outer dict, and every requested provider in each inner dict — no silent omissions. This total-coverage guarantee is what lets `evaluate_requirement` treat a missing key as a genuine `UNDETERMINED` rather than a resolver bug.
- **One `entitlement` query for all providers** (`provider.in_(providers)`), not one per provider. Add a test asserting the query count does not grow with the provider count.

Add `SUBSCRIPTION_TTL_SECONDS = 15 * 60` as a module constant.

Also add the thin composition wrapper the gate and the read path both use, so neither
re-implements the two-step:

```python
async def evaluate_subscription_requirement(
    session: AsyncSession,
    *,
    workspace_id: int,
    auth_user_ids: Sequence[int],
    requirement: SubscriptionRequirement,
    force_refresh: bool = False,
) -> dict[int, tuple[Outcome, dict[str, SubscriptionVerdict]]]:
```

It resolves `requirement.providers` once and folds each user's verdicts through
`evaluate_requirement`. Returning the per-provider verdicts alongside the composed `Outcome`
is deliberate: the UI needs per-row chips, and re-resolving for display would double every
provider call.

Commit: `feat(subscriptions): add batched tri-state resolve_subscriptions`

---

## Phase 4 — Form config and the check-in gate

### Task 10: Subscription requirement on `registration_form`

**Files:**
- Create: `backend/migrations/versions/subs0002_add_registration_form_subscription.py`
- Modify: `backend/shared/models/registration/registration.py` (beside `require_open_profile`, line 47)
- Modify: `backend/tournament-service/src/schemas/registration.py` (both classes, ~56 and ~70)
- Modify: `backend/tournament-service/src/schemas/registration_build.py` (~103)
- Modify: `backend/tournament-service/src/services/registration/serializers.py` (~114)
- Modify: `backend/tournament-service/src/services/registration/service.py` (upsert, ~832 and ~842)
- Test: `backend/tournament-service/tests/test_registration_form_subscription.py`

Two columns — a master toggle plus the requirement structure. Scalar `subscription_provider` /
`min_tier_rank` columns are **not** enough: they cannot express "any one of N", and each
provider needs its own threshold because Boosty "Уровень 2" and Twitch "Tier 2" are unrelated
scales (design decision 12).

```python
require_subscription: bool = False                    # server_default "false"
subscription_requirement_json: dict[str, Any] = {}    # JSON, server_default "{}"
```

```json
{
  "mode": "any",
  "requirements": [
    { "provider": "boosty", "min_tier_rank": 2 },
    { "provider": "twitch", "min_tier_rank": 1 }
  ]
}
```

The toggle is kept separate from the JSON on purpose, mirroring `Workspace.branding_enabled`
("master toggle so a workspace can turn branding off without losing its saved colours"):
disabling the gate mid-tournament must not destroy the organizer's thresholds and role
mappings (design decision 14).

Validate the blob on write with `parse_requirement` from Task 4 so a bad `mode` is rejected at
the API boundary, not at check-in time.

Tests: round-trip through form upsert → read preserves the toggle and the blob verbatim;
defaults are `False` / `{}`; an unknown `mode` is rejected with `422`; `min_tier_rank` below 1
is clamped to 1; a requirement listing the same provider twice keeps the strictest threshold.

Commit: `feat(subscriptions): add subscription requirement to registration form config`

---

### Task 11: The check-in gate

**Files:**
- Modify: `backend/tournament-service/src/rpc/public_rpc.py` (`_reg_pub_check_in`, ~334-372)
- Test: `backend/tournament-service/tests/test_check_in_subscription_gate.py`

Insert directly after the existing `require_open_profile` block, matching its shape. All the
subtlety lives in Task 4's pure logic, so the gate itself stays four lines of decision:

```python
if form is not None and form.require_subscription:
    requirement = parse_requirement(form.subscription_requirement_json)
    if requirement.requirements:
        outcome, _verdicts = (
            await evaluate_subscription_requirement(
                session,
                workspace_id=form.workspace_id,
                auth_user_ids=[user.id],
                requirement=requirement,
                force_refresh=True,
            )
        )[user.id]
        if outcome.blocks_check_in:
            raise HTTPException(
                status_code=400,
                detail=_subscription_refusal_detail(requirement),
            )
```

`force_refresh=True` is deliberate and load-bearing: check-in is exactly the moment a stale
`active` must not be trusted, and it is one user, not a list.

`_subscription_refusal_detail` must name the actual rule — "Требуется активная подписка на
Boosty или Twitch" for `any`, "…на Boosty и Twitch" for `all`. A generic message leaves a
patron who satisfies one of two `any` providers with no idea why they were refused.

Tests — the whole point of the task, one per row:

| Setup | Expectation |
|---|---|
| `require_subscription=False`, no subscription | succeeds; resolver never called |
| `require_subscription=True`, empty `requirements` | succeeds; resolver never called |
| single provider, `active` at/above threshold | succeeds |
| single provider, `active` below threshold | `400` |
| single provider, `inactive` | `400` |
| single provider, `unknown` | **succeeds** — fails open |
| `all`, both `active` | succeeds |
| `all`, one `active` one `inactive` | `400` |
| `all`, one `inactive` one `unknown` | `400` — refusal dominates |
| `all`, one `active` one `unknown` | **succeeds** — outage must not punish the patron |
| `any`, one `active` one `inactive` | succeeds |
| `any`, both `inactive` | `400` |
| `any`, one `inactive` one `unknown` | **succeeds** — the regression this whole design guards against |
| `any`, both `unknown` | **succeeds** |
| requirement names an unconfigured provider | **succeeds** — organizer error, not patron error |
| refusal message for `any` | contains "или"; for `all` contains "и" |
| gate passes but check-in window closed | still `409` — gate does not mask existing errors |
| registration not `approved` | still `409` — ordering of existing guards preserved |

Commit: `feat(subscriptions): gate public check-in on active subscription`

---

### Task 12: Expose verdicts on registration reads

**Files:**
- Modify: `backend/tournament-service/src/schemas/registration.py` — add `subscription_outcome` plus a per-provider `subscription_verdicts` map to the read model
- Modify: `backend/tournament-service/src/services/registration/service.py` — `build_public_registration_list`, beside the existing `resolve_profiles_open` call (~774)
- Test: `backend/tournament-service/tests/test_registration_list_subscription.py`

Call `evaluate_subscription_requirement` once for the whole list with `force_refresh=False`,
and expose both the composed outcome (drives the admin column and `isAdmitted`) and the
per-provider verdicts (drive the per-row chips on the form). Resolving twice — once for the
outcome, once for display — would double every provider call.

Tests must assert the list path issues **no** provider calls when rows are fresh, and that the
`entitlement` query count is independent of how many providers the requirement names. That is
the guarantee protecting Discord's per-guild rate-limit bucket.

Commit: `feat(subscriptions): surface subscription verdicts on registration reads`

---

### Task 13: Code redemption + own-status RPC

**Files:**
- Modify: `backend/tournament-service/src/rpc/public_rpc.py` — add `rpc.tournament.sub_redeem_code` and `rpc.tournament.sub_me`
- Modify: `backend/tournament-service/src/openapi_docs.py` and `src/openapi_schemas.py` — register both, following the neighbouring `reg_pub_*` entries
- Modify: `gateway/internal/tournament/public_routes.go` — add the two routes beside the `check-in` route at line 39, `Auth: edge.AuthRequired`
- Test: `backend/tournament-service/tests/test_subscription_redeem.py`

Routes:
- `POST /api/v1/tournaments/{tournament_id}/subscription/redeem-code`
- `GET  /api/v1/tournaments/{tournament_id}/subscription/me`

Redemption tests: valid code → `active` entitlement at the code's tier; wrong code → `400`, no row written; expired code → `400`; redeeming a higher-tier code upgrades an existing row; redeeming a lower-tier code does **not** downgrade. Rate-limit redemption attempts per user — this endpoint is a guessing oracle.

Commit: `feat(subscriptions): add code redemption and own-status endpoints`

---

## Phase 5 — Frontend

### Task 14: Types and service layer

**Files:**
- Modify: `frontend/src/types/registration.types.ts`, `frontend/src/types/balancer-admin.types.ts` (~345, ~356)
- Modify: `frontend/src/services/registration.service.ts`
- Modify: `frontend/src/lib/tournament-query-keys.ts` — add a `subscription` key beside `registrationForm`

Commit: `feat(subscriptions): add frontend types and service calls`

---

### Task 15: `SubscriptionStatusBadge`

**Files:**
- Modify: `frontend/src/components/status/RegistrationBadges.tsx`
- Modify: same file — extend `isAdmitted()` with `requireSubscription` / `subscriptionOutcome`
- Create: `frontend/src/lib/subscription-requirement.ts` — the TS mirror of Task 4's composition
- Test: `frontend/src/components/status/RegistrationBadges.behavior.test.tsx`
- Test: `frontend/src/lib/subscription-requirement.test.ts`

The badge renders the **composed** outcome (`satisfied` / `refused` / `undetermined`), modelled
on the existing `ProfileStatusBadge` (line 137). `isAdmitted` gains a single
`subscriptionOutcome !== "refused"` check, mirroring the existing `profilesOpen === false`
check at line 81 — **only a confirmed refusal blocks**.

Because the server already sends the composed outcome (Task 12), the frontend does **not**
re-derive it for the admission decision. `subscription-requirement.ts` exists only for
rendering the per-provider chips and the rule summary line, and it must be a faithful port of
the Kleene table — port the parametrized cases from
`test_subscription_requirement.py::TestAnyMode`/`TestAllMode` so the two implementations cannot
drift.

Tests: `refused` → not admitted; `undetermined` → **admitted** (fails open, matching the server
gate); `satisfied` → admitted; `requireSubscription=false` → outcome ignored entirely; the
`any[refused, undetermined]` case renders as not-blocking.

Commit: `feat(subscriptions): add subscription status badge and admission rule`

---

### Task 16: Boosty row in `AccountStep`

**Files:**
- Modify: `frontend/src/components/balancer/form/_components/formConfig.ts` — add a `boosty` entry to `BUILT_IN_FIELDS` (~line 119). Set `supportsValidation: true`, and **`supportsVerified: false`** — see below.
- Modify: `frontend/src/components/registration/AccountStep.tsx` — add the Boosty row after the Twitch block (~186), and a rule-summary line above the account rows
- Modify: `frontend/src/components/registration/UnifiedRegistrationForm.tsx` — add `boostyNick` to `UnifiedFormState` (~40) and to the submit payload
- Modify: `frontend/messages/*.json` — add `registration.accounts.boosty*` and `registration.subscription.*` keys

**`supportsVerified: false` is not an oversight.** Neither viable Boosty path reveals the handle, so the handle is self-declared and the `SocialAccount` stays `is_verified=False`. Offering a "Verified" toggle here would promise a guarantee that cannot be delivered. The trust lives in the entitlement chip beside the input, not in the handle. See decision 9 in the design doc.

Chips are **per provider row**, not one global chip: the Boosty row carries the Boosty verdict,
the Twitch row the Twitch verdict, so a patron can see exactly which side is missing.

Above the rows, render one summary line stating the actual rule — *"Требуется подписка на
Boosty **или** Twitch"* for `any`, *"…**и** Twitch"* for `all`, driven by `mode`. **Without
this line an `any` requirement reads as two independent failures** and a patron who satisfies
one provider sees a red chip on the other and assumes they are blocked. Interpolate the
provider list; do not hardcode two providers.

The row renders: an optional handle input (icon `/boosty.svg`, add the asset) plus the
provider's `<SubscriptionStatusBadge>` and a provider-dependent CTA — Discord: reuse the
existing `onLinkAccounts` when no Discord is linked; `challenge_code`: a code input posting to
the redeem endpoint; `twitch_helix` with `reason=missing_scope`: a "reconnect Twitch" link.

A provider named in the requirement but with no corresponding account row (e.g. Twitch
disabled as a form field) still needs its chip somewhere — render it in the summary block
rather than dropping it, or the patron cannot see why they are refused.

Commit: `feat(subscriptions): show boosty as a first-class account row with subscription status`

---

### Task 17: Admin config UI

**Files:**
- Modify: `frontend/src/components/balancer/form/RegistrationFormBuilder.tsx` (~88, ~127) — the master toggle plus the requirement editor
- Create: `frontend/src/components/admin/subscriptions/SubscriptionRequirementEditor.tsx` — `mode` selector (`any`/`all`) plus repeatable `{provider, min_tier_rank}` rows
- Create: `frontend/src/components/admin/subscriptions/SubscriptionProviderCard.tsx` — per-workspace provider config
- Modify: `frontend/src/app/admin/tournaments/new/wizard-model.ts` (~46), `steps/RegistrationStep.tsx` (~38), `steps/ReviewStep.tsx` (~133), `new/page.tsx` (~148)

The requirement editor must:
- hide the `mode` selector when only one provider is configured — with a single requirement `any` and `all` are the same answer, and offering the choice invites a meaningless decision;
- offer only providers that are **configured and enabled** for the workspace, and warn when an existing requirement names one that is not (it resolves to `undetermined`, so the gate silently stops enforcing);
- render `min_tier_rank` with the provider's own tier labels, never a bare integer — "Уровень 2" and "Tier 2" are different scales and a shared numeric spinner implies they are comparable;
- show a plain-language preview of the composed rule, e.g. "Игрок должен иметь подписку Boosty Уровень 2 **или** Twitch Tier 1".

`ReviewStep` must show the composed rule, not just "Yes/No" — an organizer reviewing a wizard
draft needs to see which providers and thresholds they picked.

The provider card must **validate that every mapped Discord role still exists in the guild** and warn loudly otherwise — silent mapping drift makes every patron read `inactive` (design doc, Risks).

Commit: `feat(subscriptions): add admin subscription provider configuration`

---

### Task 18: Admin tables

**Files:**
- Modify: `frontend/src/app/(site)/tournaments/[id]/_views/_components/participantsColumns.tsx` (~761, ~786)
- Modify: `frontend/src/app/(site)/tournaments/[id]/_views/TournamentParticipantsPage.tsx` (~1030)
- Modify: `frontend/src/components/balancer/registrations/RegistrationsTable.tsx` (~346)
- Modify: `frontend/src/components/balancer/registrations/_components/balancerRegistrationColumns.tsx`

Add **one** subscription column showing the composed outcome, gated on
`form.require_subscription` exactly as the profile column is gated on
`form.require_open_profile`. Put the per-provider breakdown in the row detail — one column per
provider would not scale as providers are added, and with `any` mode a red per-provider cell
next to a green one reads as a failure when it is not.

Commit: `feat(subscriptions): show subscription status in registration tables`

---

## Phase 6 — Verification

### Task 19: Full verification sweep

```bash
cd backend && uv run pytest shared/tests tournament-service/tests identity-service/tests -v
cd backend && uv run ruff check . && uv run mypy shared/subscriptions shared/services/subscription_entitlements.py
cd frontend && pnpm lint && pnpm test
cd gateway && go build ./... && go test ./internal/tournament/...
```

**Then grep for completeness — this is the real check:**

```bash
# Every layer require_open_profile reaches, require_subscription must reach too.
grep -rn "require_open_profile" backend frontend/src --include=*.py --include=*.ts --include=*.tsx | grep -v __pycache__
grep -rn "require_subscription" backend frontend/src --include=*.py --include=*.ts --include=*.tsx | grep -v __pycache__
```

Any file in the first list and absent from the second is an unfinished layer.

```bash
# The Boosty-is-not-OAuth invariant must still hold.
cd backend && uv run pytest shared/tests/test_social.py -v
```

**Then assert the two Kleene implementations agree.** The Python and TypeScript composition are
the same table written twice, which is exactly how they drift:

```bash
cd backend && uv run pytest shared/tests/test_subscription_requirement.py -v
cd frontend && pnpm test subscription-requirement
```

Both suites must cover the same **twelve** `mode × {T,F,U}` combinations — six unordered pairs
per mode (`TT TF TU FF FU UU`), two modes. If one suite has a case the other lacks, add it
before moving on.

This task produces no commit: it changes nothing, it only proves the previous eighteen did.

---

### Task 20: Smoke test the real thing

Tests are not the proof. Exercise the actual path:

1. Configure a `discord_role` provider on a dev workspace pointing at a guild the bot is in, mapping one real role to `tier_rank=1`.
2. Link a Discord account that holds that role; open the registration form; confirm the Boosty row shows `active` with the right label.
3. Set `require_subscription=True` with `{mode: "all", requirements: [{provider: "boosty", min_tier_rank: 2}]}`; attempt check-in; confirm it is refused and the message names Boosty.
4. Lower `min_tier_rank` to 1; confirm check-in succeeds.
5. Point `guild_id` at a guild the bot is **not** in; confirm the verdict is `unknown` and check-in **succeeds** — the fail-open guarantee, verified live rather than only in a unit test.
6. Redeem a challenge code on a `challenge_code` workspace; confirm the entitlement row and the chip.
7. **`any` across two providers, one of them refusing.** Configure `{mode: "any", requirements: [boosty, twitch]}`. Be subscribed on Twitch only. Confirm: the Boosty chip is red, the Twitch chip is green, the summary line reads "или", and check-in **succeeds**.
8. **`any` with one refusal and one outage.** Same requirement; be subscribed on neither, and break the Twitch config so it resolves `unknown`. Confirm check-in **succeeds** — this is the exact regression the Kleene logic exists to prevent, and a boolean implementation would block here.
9. **`all` across two providers.** Same two providers with `mode: "all"`, subscribed on Twitch only. Confirm check-in is **refused** and the message reads "и".
10. **Single-provider requirement under both modes.** Confirm `any` and `all` give identical results — no special-casing crept in.

Record the outcome of each step. Steps 5 and 8 are the ones that matter most: if either blocks,
the fail-open contract is broken and a provider outage will lock out a live tournament. Step 7's
summary line matters nearly as much — without it, a patron who legitimately passed sees a red
chip and files a support ticket.

Commit: `test(subscriptions): verify end-to-end subscription gating`

---

## Deferred, deliberately

- **Boosty subscriber-list sync** (design decision 3) — rejected, not postponed.
- **Boosty via Telegram** — a fourth provider behind the same `Protocol`; nothing in this plan blocks it.
- **Background refresh sweep** — on-demand plus TTL is sufficient at current volume. Add a sweep only if the per-guild bucket becomes a measured problem.
- **Push invalidation from Discord** — impossible without the privileged `GUILD_MEMBERS` intent. If subscription revocation ever needs to be instant, that intent (and its approval process) is the prerequisite.
