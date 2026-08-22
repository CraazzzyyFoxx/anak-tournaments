"""Pure tournament-group/stage derivation logic. Zero session, zero await,
zero asyncio — see ``backend/ARCHITECTURE.md``'s ``domain/`` boundary. DB
access and Challonge round-trips around these stay in
``src.services.tournament.flows``.
"""

from __future__ import annotations

import typing

from shared.services.challonge_refs import ChallongeRef
from src import schemas

__all__ = (
    "_apply_stage_challonge",
    "get_groups_from_matches",
)


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


def get_groups_from_matches(
    matches: list[schemas.ChallongeMatch],
) -> list[tuple[int, str]]:
    groups_ids: list[int] = []
    for match in matches:
        if match.group_id is None:
            continue
        if match.group_id not in groups_ids:
            groups_ids.append(match.group_id)

    groups: list[tuple[int, str]] = []
    for sym_index, group_id in enumerate(sorted(groups_ids), start=65):
        groups.append((group_id, chr(sym_index)))

    return groups
