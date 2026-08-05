"""Cached read access to the two stored roster-slot levels.

The only place in the codebase that reads ``tournament.roster_slots_json`` and
``workspace.default_roster_slots_json`` from the database. Everything else asks
:func:`get_effective_roster_shape` and gets a validated
:class:`~shared.domain.roster_shape.RosterShape`. The fallback chain itself is
not reimplemented here -- it lives in
:func:`~shared.domain.roster_shape.resolve_roster_shape`.

Modelled on ``division_grid_access`` / ``division_grid_cache`` (same
``CACHE_KEY_PREFIX``, same TTL, same best-effort cache wrappers), with two
deliberate departures worth stating so they are not "simplified" away:

**1. The cache holds the raw per-level maps, not the resolved shape.**
``division_grid_cache`` caches the *effective* version per tournament, so
changing a workspace default forces
``delete_match("...division_grid:tournament:*:effective_version")`` -- a
key-space scan that also drops every other workspace's tournaments. Caching the
raw levels instead means a workspace default change invalidates exactly one key.
Assembling the shape from those levels is arithmetic over three to six small
integers; there is nothing there worth caching.

**2. A ``NULL`` column is cached as ``{}``, never as ``None``.**
Redis cannot distinguish "key absent" from "key holds ``None``" -- both read
back as ``None``. Since the overwhelming majority of tournaments will never
carry an override, caching ``None`` would mean a database round-trip on every
single read of the most common case, i.e. no cache at all. ``{}`` needs no new
sentinel concept: an empty map is not a valid roster shape, and
``resolve_roster_shape`` already treats ``{}`` exactly like ``None`` -- "no
value at this level, keep looking". The public getters still return ``None``
for an absent value, so ``{}`` stays an internal cache representation and never
leaks into the API.
"""

from __future__ import annotations

import logging
from typing import Any

import sqlalchemy as sa
from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.roster_shape import RosterShape, resolve_roster_shape
from shared.models.tenancy.workspace import Workspace
from shared.models.tournament import Tournament

ROSTER_SLOTS_CACHE_TTL_SECONDS = 60 * 60
CACHE_KEY_PREFIX = "backend:"
logger = logging.getLogger(__name__)


def _tournament_key(tournament_id: int) -> str:
    return f"{CACHE_KEY_PREFIX}roster_slots:tournament:{tournament_id}"


def _workspace_key(workspace_id: int) -> str:
    return f"{CACHE_KEY_PREFIX}roster_slots:workspace:{workspace_id}"


async def _get(key: str) -> Any | None:
    if not cache.is_setup():
        return None
    try:
        return await cache.get(key)
    except Exception as exc:
        logger.debug("Roster shape cache get failed for %s: %s", key, exc)
        return None


async def _set(key: str, value: Any, ttl: int = ROSTER_SLOTS_CACHE_TTL_SECONDS) -> None:
    if not cache.is_setup():
        return
    try:
        await cache.set(key, value, expire=ttl)
    except Exception as exc:
        logger.debug("Roster shape cache set failed for %s: %s", key, exc)


async def _delete(key: str) -> None:
    if not cache.is_setup():
        return
    try:
        await cache.delete(key)
    except Exception as exc:
        logger.debug("Roster shape cache invalidation failed for %s: %s", key, exc)


async def _load_level_slots(
    session: AsyncSession,
    cache_key: str,
    statement: sa.Select[Any],
) -> dict[str, int] | None:
    """Cache -> database -> cache, with ``{}`` standing in for a ``NULL`` column.

    The stored value is passed through unvalidated: corrupt configuration must
    surface as a ``RosterShapeError`` from the parser, identically on a cold and
    a warm read, rather than being silently swallowed here.
    """
    cached = await _get(cache_key)
    if cached is not None:
        return None if cached == {} else cached

    stored = await session.scalar(statement)
    await _set(cache_key, {} if stored is None else stored)
    return stored


async def get_tournament_roster_slots(
    session: AsyncSession,
    tournament_id: int | None,
) -> dict[str, int] | None:
    """The tournament's slot override, or ``None`` when it has none."""
    if tournament_id is None:
        return None
    return await _load_level_slots(
        session,
        _tournament_key(tournament_id),
        sa.select(Tournament.roster_slots_json).where(Tournament.id == tournament_id),
    )


async def get_workspace_roster_slots(
    session: AsyncSession,
    workspace_id: int | None,
) -> dict[str, int] | None:
    """The workspace's default slot map, or ``None`` when it has none."""
    if workspace_id is None:
        return None
    return await _load_level_slots(
        session,
        _workspace_key(workspace_id),
        sa.select(Workspace.default_roster_slots_json).where(Workspace.id == workspace_id),
    )


async def get_effective_roster_shape(
    session: AsyncSession,
    *,
    tournament_id: int | None,
    workspace_id: int | None,
) -> RosterShape:
    """Resolve the shape a team has in this tournament.

    Both levels are read and handed to ``resolve_roster_shape``, which owns the
    precedence rules; this function deliberately knows none of them. Both reads
    are cache-backed, and the workspace key is shared by every tournament of the
    workspace, so the second read is a hot hit rather than a database probe.
    """
    tournament_slots = await get_tournament_roster_slots(session, tournament_id)
    workspace_slots = await get_workspace_roster_slots(session, workspace_id)
    return resolve_roster_shape(tournament_slots, workspace_slots)


async def invalidate_roster_shape_cache(
    *,
    tournament_id: int | None = None,
    workspace_id: int | None = None,
) -> None:
    """Drop the cached level(s) after a write. Never a wildcard delete.

    Because the cache holds raw per-level maps rather than the resolved shape,
    a workspace default change needs exactly its own key dropped -- no scan
    over the tournaments of the workspace. See the module docstring.
    """
    if tournament_id is not None:
        await _delete(_tournament_key(tournament_id))
    if workspace_id is not None:
        await _delete(_workspace_key(workspace_id))
