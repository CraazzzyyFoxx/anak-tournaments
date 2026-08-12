"""Provider-agnostic subscription entitlements.

Answers one question: does this site user have an active subscription to a
workspace's author, and at what tier? Providers (Boosty via Discord roles, Boosty
via challenge code, Twitch Helix) sit behind a single ``Protocol``.

The tri-state contract copied from ``shared.services.profile_visibility`` is
load-bearing: ``unknown`` fails open so a provider outage is never mistaken for a
cancelled subscription. See ``requirement`` for how several providers compose.
"""

from shared.subscriptions.requirement import (
    MODE_ALL,
    MODE_ANY,
    Outcome,
    ProviderRequirement,
    SubscriptionRequirement,
    evaluate_requirement,
    parse_requirement,
)
from shared.subscriptions.types import (
    ResolveContext,
    SubscriptionProvider,
    SubscriptionSource,
    SubscriptionState,
    SubscriptionVerdict,
    meets_min_tier,
    normalize_twitch_tier,
)
from shared.subscriptions.verification import (
    VERIFICATION_METHODS,
    VerificationMethod,
    accepts_code,
    accepts_live,
    accepts_source,
    normalize_verification_method,
    parse_verification_method,
)

__all__ = (
    "MODE_ALL",
    "MODE_ANY",
    "VERIFICATION_METHODS",
    "Outcome",
    "ProviderRequirement",
    "ResolveContext",
    "SubscriptionProvider",
    "SubscriptionRequirement",
    "SubscriptionSource",
    "SubscriptionState",
    "SubscriptionVerdict",
    "VerificationMethod",
    "accepts_code",
    "accepts_live",
    "accepts_source",
    "evaluate_requirement",
    "meets_min_tier",
    "normalize_twitch_tier",
    "normalize_verification_method",
    "parse_requirement",
    "parse_verification_method",
)
