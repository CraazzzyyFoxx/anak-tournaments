"""Is this tournament a scrim container? — the predicate the tournament-wide
computation paths need.

Design: ``docs/plans/2026-08-12-scrim-rooms.md`` (§4.1 for the container shape,
§5 for the exclusion list this backs).

A scrim container is a real ``Tournament`` row (it has to be — ``Encounter`` and
``Team`` both require one), but it is the *only* kind of tournament that has no
standings, no bracket and no rosters by construction: each of its ``Stage`` rows
is one ad-hoc room. Anything that computes tournament-wide results has to be
able to recognise it.

Why not ``Tournament.is_hidden``. Hidden means "visible to workspace admins and
preview-allowlisted users" (``tournament_visibility``), and hidden **preview**
tournaments are ordinary tournaments that legitimately do want standings,
brackets and achievements. Filtering a computation path on ``is_hidden`` would
silently stop preview standings from ever updating — a much worse bug than the
one it fixed.

Why the container and not the individual encounter. The recalculation these
guards protect is tournament-scoped: it rebuilds every stage of the tournament
it is handed. "Is this encounter a scrim?" cannot answer that — one scrim
encounter drags in every other room in the same container. The container is
created only by ``services/scrim/service.py:_ensure_container`` and holds
nothing but rooms, so container-level is exact, never over-broad.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.tournament.scrim import ScrimRoom

__all__ = ("is_scrim_container",)


async def is_scrim_container(session: AsyncSession, tournament_id: int | None) -> bool:
    """True when ``tournament_id`` is a workspace's scrim container.

    Keyed on ``ScrimRoom.tournament_id``, which is indexed, and answered with an
    EXISTS so the cost is one index probe regardless of how many rooms the
    container has accumulated.
    """
    if tournament_id is None:
        return False
    return bool(
        await session.scalar(
            sa.select(sa.literal(True)).where(sa.exists().where(ScrimRoom.tournament_id == tournament_id))
        )
    )
