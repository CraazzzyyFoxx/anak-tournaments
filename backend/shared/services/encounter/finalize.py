"""The single writer of an encounter's final score.

Every path that completes an encounter — captain auto-confirm, admin
resolution, Challonge import — goes through :func:`finalize_encounter_score`.
It is deliberately transaction-agnostic: the caller owns commit and publish, so
the source encounter update and every target-slot update it cascades into stay
in one transaction.

Veto-session upkeep is injected as ``post_advance`` rather than imported: it
lives in tournament-service (it registers realtime updates), while this module
must also be importable from parser-service.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status
from shared.core.enums import EncounterResultStatus, EncounterStatus, StageType
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.tournament.encounter import Encounter
from shared.models.tournament.stage import Stage
from shared.services.bracket import advancement

__all__ = (
    "FinalizeSource",
    "FinalizedEncounterScore",
    "PostAdvanceHook",
    "finalize_encounter_score",
)

FinalizeSource = Literal["captain", "admin", "challonge", "log"]

# Called once per encounter whose team slots the advancement just changed.
PostAdvanceHook = Callable[[AsyncSession, Encounter], Awaitable[None]]

# Stage types where a match MUST produce a winner: a drawn score would leave
# the advancement edges unfired and the bracket silently stuck.
_NO_DRAW_STAGE_TYPES = {StageType.SINGLE_ELIMINATION, StageType.DOUBLE_ELIMINATION}


@dataclass(frozen=True)
class FinalizedEncounterScore:
    encounter: Encounter
    advanced_encounters: Sequence[Encounter]
    source: FinalizeSource


async def finalize_encounter_score(
    session: AsyncSession,
    encounter_id: int,
    *,
    home_score: int,
    away_score: int,
    source: FinalizeSource,
    encounter: Encounter | None = None,
    status: EncounterStatus = EncounterStatus.COMPLETED,
    result_status: EncounterResultStatus | None = None,
    confirmed_by_id: int | None = None,
    confirmed_at: datetime | None = None,
    post_advance: PostAdvanceHook | None = None,
) -> FinalizedEncounterScore:
    """Finalize an encounter score and propagate bracket advancement.

    The caller owns commit/publish boundaries. This keeps the source encounter
    update and all target-slot updates in the caller's existing transaction.

    ``source`` is returned on the result so the caller can attribute the
    transition (audit trail, sync log) without re-deriving it.
    """
    locked_encounter = encounter or await _load_encounter_for_update(session, encounter_id)
    if locked_encounter.id != encounter_id:
        raise ValueError(f"Encounter id mismatch: expected {encounter_id}, got {locked_encounter.id}")

    if home_score == away_score and status == EncounterStatus.COMPLETED:
        stage_type = await _load_stage_type(session, locked_encounter.stage_id)
        if stage_type in _NO_DRAW_STAGE_TYPES:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=(
                    "An elimination-bracket match cannot be completed with a drawn score — "
                    "a winner is required to advance the bracket"
                ),
            )

    locked_encounter.home_score = home_score
    locked_encounter.away_score = away_score
    locked_encounter.status = status

    if result_status is not None:
        locked_encounter.result_status = result_status

    if confirmed_by_id is not None or confirmed_at is not None:
        locked_encounter.confirmed_by_id = confirmed_by_id
        locked_encounter.confirmed_at = confirmed_at or datetime.now(UTC)

    advanced_encounters = await advancement.advance_winner(session, locked_encounter)
    # Bracket propagation is THE write path where encounter team slots become
    # set (or change): keep each affected encounter's veto session in sync —
    # both teams known -> ensure a session; teams changed under an existing
    # session -> reset it (unless a map was already played). Runs in the
    # caller's transaction, like the advancement itself.
    if post_advance is not None:
        for advanced in advanced_encounters:
            await post_advance(session, advanced)
    return FinalizedEncounterScore(
        encounter=locked_encounter,
        advanced_encounters=advanced_encounters,
        source=source,
    )


async def _load_encounter_for_update(
    session: AsyncSession,
    encounter_id: int,
) -> Encounter:
    result = await session.execute(
        select(Encounter).where(Encounter.id == encounter_id).with_for_update(nowait=False)
    )
    encounter = result.scalar_one_or_none()
    if encounter is None:
        raise ValueError(f"Encounter {encounter_id} not found")
    return encounter


async def _load_stage_type(
    session: AsyncSession,
    stage_id: int | None,
) -> StageType | None:
    if stage_id is None:
        return None
    return await session.scalar(select(Stage.stage_type).where(Stage.id == stage_id))
