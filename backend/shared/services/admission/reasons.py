"""Reason code -> who can fix it.

One static map over both taxonomies. The subscription codes already existed
(``SubscriptionVerdict.evidence["reason"]``, written by the providers in
``shared/services/subscriptions/providers/``); the profile codes are new, because
``resolve_profiles_open`` used to collapse seven ``RankCollectionStatus`` values
plus "no BattleTag at all" into ``bool | None`` and lose the why entirely.

An unrecognised code resolves to :attr:`ReasonActor.system` rather than raising.
A provider added later stays explainable -- just less precisely -- and one unknown
string never turns a participants list into a 500. Same discipline as
``shared.services.admission.gates.describe_requirement``, which falls back to the
raw provider key rather than dropping an unnamed provider out of its sentence.
"""

from __future__ import annotations

from typing import Final

from shared.services.admission.types import AdmissionReason, ReasonActor

__all__ = (
    "PROFILE_REASON_CODES",
    "REASON_ACTORS",
    "SUBSCRIPTION_REASON_CODES",
    "actor_for",
    "reason",
)

#: Profile-visibility codes, derived from ``overwatch_rank.battle_tag_state.status``
#: plus the two cases that have no row at all. ``profile_private`` /
#: ``profile_not_found`` are the only BLOCKING ones -- everything else is an
#: unfinished or failed collection, which must fail open.
PROFILE_REASON_CODES: Final[dict[str, ReasonActor]] = {
    # The registration carries no BattleTag, so there is nothing to check. The
    # player fixes it by filling the field in.
    "no_battle_tag": ReasonActor.player,
    # A tag nobody has polled yet: the row is simply absent.
    "never_fetched": ReasonActor.system,
    "collection_pending": ReasonActor.system,
    "collection_failed": ReasonActor.system,
    # ``disabled`` means an organizer switched rank collection off for the tag.
    "collection_disabled": ReasonActor.organizer,
    "profile_private": ReasonActor.player,
    "profile_not_found": ReasonActor.player,
}

#: Subscription codes as the providers already emit them.
SUBSCRIPTION_REASON_CODES: Final[dict[str, ReasonActor]] = {
    # ── the registrant's move ────────────────────────────────────────────────
    "no_linked_discord_account": ReasonActor.player,
    "no_linked_twitch_account": ReasonActor.player,
    "missing_scope": ReasonActor.player,
    "not_subscribed": ReasonActor.player,
    "not_a_member": ReasonActor.player,
    "no_mapped_role": ReasonActor.player,
    "no_code_redeemed": ReasonActor.player,
    # ── the organizer's configuration ────────────────────────────────────────
    "guild_not_configured": ReasonActor.organizer,
    "no_role_tiers_configured": ReasonActor.organizer,
    "role_mapping_drift": ReasonActor.organizer,
    "broadcaster_not_configured": ReasonActor.organizer,
    "twitch_client_not_configured": ReasonActor.organizer,
    "broadcaster_not_eligible": ReasonActor.organizer,
    # ── nobody in the product ────────────────────────────────────────────────
    "provider_unavailable": ReasonActor.system,
    "guild_not_accessible": ReasonActor.system,
    # Deliberately SYSTEM, not organizer: this is a missing ``DISCORD_TOKEN`` in
    # the environment. A tournament organizer cannot deploy a secret.
    "bot_not_configured": ReasonActor.system,
    # Reserved for the Discord-cache transport (RPC into discord-service): a cold
    # cache right after a restart must read as an outage, never as "not
    # subscribed", or a five-second pod restart becomes a mass refusal.
    "cache_not_ready": ReasonActor.system,
}

REASON_ACTORS: Final[dict[str, ReasonActor]] = {
    **PROFILE_REASON_CODES,
    **SUBSCRIPTION_REASON_CODES,
}


def actor_for(code: str | None) -> ReasonActor:
    """Who can fix ``code``. Unknown or missing codes are the system's problem."""
    if not code:
        return ReasonActor.system
    return REASON_ACTORS.get(code, ReasonActor.system)


def reason(code: str | None, *, subject: str | None = None) -> AdmissionReason:
    """Build a reason with its actor resolved. ``None`` becomes ``"unknown"``.

    A verdict without a reason is a provider bug (``SubscriptionVerdict`` says so
    in its docstring), and it must surface as one rather than as an empty reason
    list that reads like "no problem here".
    """
    return AdmissionReason(code=code or "unknown", actor=actor_for(code), subject=subject)
