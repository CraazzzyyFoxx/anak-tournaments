from __future__ import annotations

from typing import Literal

from cashews import cache

from src.core.caching import CACHE_PREFIXES

TournamentCacheInvalidationReason = Literal[
    "bracket_changed",
    "results_changed",
    "structure_changed",
    "registration_changed",
]


def _with_prefixes(*suffixes: str) -> tuple[str, ...]:
    """Expand each cache-key suffix to every configured backend prefix.

    cashews routes ``delete_match`` by key prefix and has no default backend, so
    a pattern that starts with no registered prefix raises ``NotConfiguredError``
    (and aborts the rest of the invalidation loop). Generating patterns from
    ``CACHE_PREFIXES`` keeps every pattern routable and in sync with
    ``configure_cache``.
    """
    return tuple(f"{prefix}{suffix}" for suffix in suffixes for prefix in CACHE_PREFIXES)


def tournament_cache_patterns(
    tournament_id: int,
    reason: TournamentCacheInvalidationReason,
) -> tuple[str, ...]:
    # Every id is followed by a literal ``:`` in the cache keys these patterns
    # target, and matching it is NOT cosmetic: a trailing bare ``*`` after the id
    # makes tournament 7 also purge 70, 72 and 700, so the busiest tournaments
    # (lowest ids) would evict everyone else's reads on every write.
    bracket_suffixes = (
        f"*encounters*:{tournament_id}:*",
        "*encounters*:None:*",
        # Standings embed `matches_history`, which is built from completed
        # encounters (standings/flows.py::get_by_tournament), so an encounter
        # write moves them even though the standings rows themselves only change
        # on a recalculation. The admin encounter endpoints emit bracket_changed
        # synchronously and only *enqueue* the recalculation that later emits
        # results_changed, so without this the client refetch that the
        # bracket_changed event triggers is served pre-write history.
        f"*standings*:{tournament_id}:*",
    )
    if reason == "bracket_changed":
        return _with_prefixes(*bracket_suffixes)
    if reason == "registration_changed":
        # No tournament-service-side cache backs the registration/participants
        # list itself today (only the gateway's own response cache, invalidated
        # separately off the same WS topic). But `tournaments/{id}:get_read`
        # IS cached (tournament/flows.py::get_read) and embeds live
        # participants_count/registrations_count, which DO change on every
        # registration write — teams/standings/encounters do not, so they stay
        # cached.
        return _with_prefixes(f"*tournaments/{tournament_id}:*")

    return _with_prefixes(
        f"*tournaments/{tournament_id}:*",
        f"*teams*:{tournament_id}:*",
        *bracket_suffixes,
    )


async def invalidate_tournament_cache(
    tournament_id: int,
    reason: TournamentCacheInvalidationReason,
) -> None:
    for pattern in tournament_cache_patterns(tournament_id, reason):
        await cache.delete_match(pattern)
