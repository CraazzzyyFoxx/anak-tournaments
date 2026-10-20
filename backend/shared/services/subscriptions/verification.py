"""Which mechanism is allowed to answer for a provider.

Every provider has two possible mechanisms:

- its **own live signal** — Discord roles for Boosty (assigned by Boosty's own
  bot), the Helix subscriptions endpoint for Twitch;
- a **challenge code** — a secret published inside a subscriber-only post.

They are not interchangeable; with both always on, two states are unreachable:

1. **Code-only.** An organizer with no Discord server leaves
   ``Workspace.discord_guild_id`` unset, the live path answers
   ``unknown("guild_not_configured")``, and ``unknown`` fails open — so the gate
   would admit *everybody*, including people who never redeemed anything.
2. **Live-only.** Codes left in the config stay redeemable, and an
   already-redeemed code counts forever (a redeemed code is deliberately never
   re-polled), so switching to roles could not revoke it.

Hence the method is authoritative over BOTH the live call and the stored verdict:
narrowing it must invalidate cached entitlements whose source it does not accept,
or yesterday's code would outlive the decision to stop accepting codes.

Source classification needs no provider table: a source either *is* the challenge
code or it is a live provider signal, so a new provider registers nothing here.
"""

from __future__ import annotations

from typing import Any, Final

from shared.services.subscriptions.types import SubscriptionSource

__all__ = (
    "VERIFICATION_METHODS",
    "VerificationMethod",
    "accepts_code",
    "accepts_live",
    "accepts_source",
    "normalize_verification_method",
    "parse_verification_method",
)


class VerificationMethod:
    """How a patron may prove their subscription.

    ``LIVE`` is deliberately provider-agnostic: it means "the provider's own
    signal", which is Discord roles for Boosty and Helix for Twitch. Naming it
    after either one would be a lie for the other, and naming it per provider
    would invite a Twitch config that says ``discord_role``.
    """

    LIVE: Final = "live"
    CODE: Final = "code"
    ANY: Final = "any"


VERIFICATION_METHODS: frozenset[str] = frozenset(
    {VerificationMethod.LIVE, VerificationMethod.CODE, VerificationMethod.ANY}
)


def normalize_verification_method(raw: Any) -> str:
    """Coerce a stored/submitted value to a known method.

    Defaults to ``ANY``: a config without the field accepts both mechanisms, and
    an unrecognised value must widen rather than lock people out.
    """
    text = str(raw or "").strip().lower()
    return text if text in VERIFICATION_METHODS else VerificationMethod.ANY


def parse_verification_method(config: dict[str, Any] | None) -> str:
    """Read ``verification_method`` out of a provider config blob."""
    return normalize_verification_method((config or {}).get("verification_method"))


def accepts_code(method: str) -> bool:
    """Whether a challenge code may be redeemed at all under ``method``."""
    return normalize_verification_method(method) in (
        VerificationMethod.CODE,
        VerificationMethod.ANY,
    )


def accepts_live(method: str) -> bool:
    """Whether the provider's own signal may be polled under ``method``."""
    return normalize_verification_method(method) in (
        VerificationMethod.LIVE,
        VerificationMethod.ANY,
    )


def accepts_source(method: str, source: str | None) -> bool:
    """Whether a verdict from ``source`` still counts under ``method``.

    Applied to STORED verdicts as well as fresh ones — that is what makes a
    narrowed method revoke a cached entitlement instead of silently honouring it.
    A ``None`` source (a row of unknown origin) is treated as a live signal, so
    only an explicit ``CODE`` restriction discards it.
    """
    if source == SubscriptionSource.CHALLENGE_CODE:
        return accepts_code(method)
    return accepts_live(method)
