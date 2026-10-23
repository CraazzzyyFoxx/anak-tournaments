"""Single source of truth for what invalidates the workspace-scoped ``/users/*`` read caches.

The contract between the reader and the writers: stats-service keys every ``@versioned`` read of its
``services.user.service`` / ``services.map.service`` / ``services.achievement_reads`` by these generations
(``shared.services.cache_generations``), app-service bumps the user generations after a profile/identity edit, and every
tournament writer bumps the tournament-resource generations through ``emit``:

* :data:`TOURNAMENT_DATA` — any tournament write that can move a user aggregate. The event does not name the users a
  tournament touched and the aggregates (tournaments, heroes, encounters, maps, teammates, ...) fan across
  tournaments, so every user's reads miss; staleness is bounded by ``users_cache_ttl`` regardless. A score report or a
  registration moves none of them, so their resources are not listed.
* the subject user's generation (:func:`user_generations`) — a profile/identity edit of that user (name, avatar,
  socials, merge); cross-user cosmetic staleness (this user's name or avatar embedded in *other* users' cached
  teammate/opponent lists) is left to the TTL;
* or, for the compare caches (:data:`COMPARE_GENERATIONS`), which depend on *other* users too (target-user / cohort
  baselines), any user's edit.
"""

from __future__ import annotations

from loguru import logger

from shared.services.cache_generations import bump
from shared.services.realtime import Resource, resource_generation

__all__ = ("COMPARE_GENERATIONS", "TOURNAMENT_DATA", "invalidate_user_caches", "user_generations")

TOURNAMENT_DATA: tuple[str, ...] = tuple(
    resource_generation(resource)
    for resource in (
        Resource.TOURNAMENT_STANDINGS,
        Resource.TOURNAMENT_TEAMS,
        Resource.TOURNAMENT_STRUCTURE,
        Resource.TOURNAMENT_DETAIL,
        Resource.TOURNAMENT_STAGES,
    )
)
_ANY_USER = "app.user:*"
COMPARE_GENERATIONS: tuple[str, ...] = (*TOURNAMENT_DATA, _ANY_USER)


def _user(user_id: int | str) -> str:
    return f"app.user:{user_id}"


def user_generations(user_id: str) -> tuple[str, ...]:
    """A read about one user; ``user_id`` is a template over the cached call (``"{id}"``)."""
    return (*TOURNAMENT_DATA, _user(user_id))


async def invalidate_user_caches(*user_ids: int) -> None:
    """Miss every read cache scoped to ``user_ids``, and every compare cache, after a profile/identity edit.

    Runs after the write committed, so a failure is logged rather than raised: the caller's write stands either way.
    """
    try:
        await bump(*(_user(user_id) for user_id in user_ids), _ANY_USER)
    except Exception:
        logger.exception("User cache invalidation failed", user_ids=user_ids)
