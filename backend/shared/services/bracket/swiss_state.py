"""The Swiss generator's own bookkeeping: byes handed out, scopes out of pairings.

Rows in ``tournament.swiss_bye`` and ``tournament.swiss_stopped_scope``, never
the organizer's regulation -- nothing an admin edits can reach them. A scope is
one stage item, or the whole stage when it has none (``stage_item_id`` NULL).

:func:`played_pairs` lives here too: "who has already met" is the other half of
what the generator needs from the database, and it is read off the live
participations (D55) rather than two columns on the encounter.

Writes go through the caller's session and are flushed with it; nothing here
commits.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Collection
from itertools import combinations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.encounter.team import EncounterTeam
from shared.models.tournament.stage import SwissBye, SwissStoppedScope

__all__ = (
    "bye_counts_by_scope",
    "clear_swiss_byes",
    "clear_swiss_scope_stopped",
    "mark_swiss_scope_stopped",
    "played_pairs",
    "record_swiss_bye",
    "remove_swiss_bye_round",
    "stopped_scopes",
    "swiss_bye_team_ids",
)

Scope = tuple[int, int | None]


def _in_scope(model: type[SwissBye] | type[SwissStoppedScope], stage_id: int, stage_item_id: int | None) -> tuple:
    return model.stage_id == stage_id, model.stage_item_id.is_not_distinct_from(stage_item_id)


async def played_pairs(session: AsyncSession, encounter_ids: Collection[int]) -> set[frozenset[int]]:
    """Every pair of source teams the given encounters have put together.

    Read off the ACTIVE participations: a seat that changed hands was replaced
    because the pairing was wrong, so the retired occupant never met anyone.
    An encounter seating more than two takes every pair in it, which keeps the
    rematch rule honest if a Swiss scope ever holds a lobby.
    """
    if not encounter_ids:
        return set()
    rows = await session.execute(
        sa.select(EncounterTeam.encounter_id, EncounterTeam.team_id).where(
            EncounterTeam.encounter_id.in_(tuple(encounter_ids)),
            EncounterTeam.active.is_(True),
            EncounterTeam.team_id.is_not(None),
        )
    )
    seated: defaultdict[int, list[int]] = defaultdict(list)
    for encounter_id, team_id in rows.all():
        seated[encounter_id].append(team_id)
    return {frozenset(pair) for team_ids in seated.values() for pair in combinations(team_ids, 2)}


async def swiss_bye_team_ids(session: AsyncSession, stage_id: int, stage_item_id: int | None) -> list[int]:
    """Every team that had a bye in the scope, once per bye, oldest first."""
    result = await session.execute(
        sa.select(SwissBye.team_id).where(*_in_scope(SwissBye, stage_id, stage_item_id)).order_by(SwissBye.id)
    )
    return list(result.scalars().all())


async def bye_counts_by_scope(session: AsyncSession, stage_ids: Collection[int]) -> dict[Scope, dict[int, int]]:
    """``(stage_id, stage_item_id) -> {team_id: byes}`` for every given stage."""
    if not stage_ids:
        return {}
    result = await session.execute(
        sa.select(SwissBye.stage_id, SwissBye.stage_item_id, SwissBye.team_id).where(SwissBye.stage_id.in_(stage_ids))
    )
    counts: defaultdict[Scope, Counter[int]] = defaultdict(Counter)
    for stage_id, stage_item_id, team_id in result.all():
        counts[(stage_id, stage_item_id)][team_id] += 1
    return {scope: dict(counter) for scope, counter in counts.items()}


async def record_swiss_bye(
    session: AsyncSession, stage_id: int, stage_item_id: int | None, team_id: int, *, round_number: int
) -> None:
    session.add(SwissBye(stage_id=stage_id, stage_item_id=stage_item_id, team_id=team_id, round=round_number))


async def remove_swiss_bye_round(
    session: AsyncSession, stage_id: int, stage_item_id: int | None, round_number: int
) -> None:
    """Revoke the byes recorded for one round, e.g. when that round is deleted.

    A bye stored without a round predates round tracking: there is no way to tell
    which round it belonged to, so it is kept.
    """
    await session.execute(
        sa.delete(SwissBye).where(*_in_scope(SwissBye, stage_id, stage_item_id), SwissBye.round == round_number)
    )


async def clear_swiss_byes(session: AsyncSession, stage_id: int, stage_item_id: int | None) -> None:
    await session.execute(sa.delete(SwissBye).where(*_in_scope(SwissBye, stage_id, stage_item_id)))


async def stopped_scopes(session: AsyncSession, stage_ids: Collection[int]) -> set[Scope]:
    """Every scope of the given stages that ran out of rematch-free pairings."""
    if not stage_ids:
        return set()
    result = await session.execute(
        sa.select(SwissStoppedScope.stage_id, SwissStoppedScope.stage_item_id).where(
            SwissStoppedScope.stage_id.in_(stage_ids)
        )
    )
    return {(stage_id, stage_item_id) for stage_id, stage_item_id in result.all()}


async def mark_swiss_scope_stopped(session: AsyncSession, stage_id: int, stage_item_id: int | None) -> None:
    exists = await session.scalar(
        sa.select(SwissStoppedScope.id).where(*_in_scope(SwissStoppedScope, stage_id, stage_item_id))
    )
    if exists is None:
        session.add(SwissStoppedScope(stage_id=stage_id, stage_item_id=stage_item_id))


async def clear_swiss_scope_stopped(session: AsyncSession, stage_id: int, stage_item_id: int | None) -> None:
    await session.execute(sa.delete(SwissStoppedScope).where(*_in_scope(SwissStoppedScope, stage_id, stage_item_id)))
