"""Is this tournament a scrim container? — the predicate the tournament-wide
computation paths need.

A scrim container is a real ``Tournament`` row (it has to be — ``Encounter`` and
``Team`` both require one), but it is the *only* kind of tournament that has no
standings, no bracket and no rosters by construction: each of its ``Stage`` rows
is one ad-hoc room. Anything that computes tournament-wide results has to be
able to recognise it.

Not ``Tournament.is_hidden``: hidden means "visible to workspace admins and
preview-allowlisted users" (``tournament_visibility``), and hidden **preview**
tournaments are ordinary tournaments that legitimately do want standings,
brackets and achievements. Filtering a computation path on ``is_hidden`` would
silently stop preview standings from ever updating.

The container, not the individual encounter: the recalculation these guards
protect is tournament-scoped and rebuilds every stage of the tournament it is
handed, so one scrim encounter drags in every other room in the same container.
The container is created only by
``tournament-service/src/services/scrim/service.py:_ensure_container`` and holds
nothing but rooms, so container-level is exact, never over-broad.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.tournament.scrim import ScrimRoom

__all__ = ("is_scrim_container",)


async def is_scrim_container(session: AsyncSession, tournament_id: int | None) -> bool:
    """True when ``tournament_id`` is a workspace's scrim container.

    Keyed on ``ScrimRoom.tournament_id``, which is indexed, and capped at one row,
    so the cost is a single index probe however many rooms the container has
    accumulated.

    A plain ``SELECT id ... LIMIT 1`` rather than ``SELECT EXISTS(...)``: same
    cost against the index, and the in-memory session doubles in the test suite
    understand only this shape.
    """
    if tournament_id is None:
        return False
    found = await session.scalar(sa.select(ScrimRoom.id).where(ScrimRoom.tournament_id == tournament_id).limit(1))
    return found is not None
