"""Pure stage/Challonge-ref derivation. Zero session, zero await, zero asyncio —
see ``backend/ARCHITECTURE.md``'s ``domain/`` boundary. DB access and Challonge
round-trips around it stay in ``src.services.tournament.flows``.
"""

from __future__ import annotations

import typing

from shared.services.challonge_refs import ChallongeRef
from src import schemas

__all__ = ("_apply_stage_challonge",)


def _apply_stage_challonge(
    stage_read: schemas.StageRead,
    stage_id: int,
    stage_challonge_refs: typing.Mapping[int, ChallongeRef] | None,
) -> schemas.StageRead:
    """Override the KEPT ``challonge_id``/``challonge_slug`` fields with values
    DERIVED from ``challonge_source`` (never the legacy ``stage`` columns)."""
    challonge_id, challonge_slug = (
        stage_challonge_refs.get(stage_id, (None, None)) if stage_challonge_refs is not None else (None, None)
    )
    return stage_read.model_copy(update={"challonge_id": challonge_id, "challonge_slug": challonge_slug})
