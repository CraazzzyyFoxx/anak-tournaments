"""The display name of an encounter: its seats, in slot order, joined by "vs".

An encounter seats ``slot_count`` participations, not two sides, so the name is
built from a sequence: a duel reads exactly as it always did ("A vs B") and a
lobby of four reads "A vs B vs C vs D". An empty seat is "TBD".
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

__all__ = (
    "build_encounter_name",
    "build_encounter_name_from_ids",
)

_SEPARATOR = " vs "
_UNKNOWN = "TBD"


def _normalize_team_name(name: str | None) -> str:
    if name is None:
        return _UNKNOWN
    normalized = name.strip()
    return normalized or _UNKNOWN


def build_encounter_name(team_names: Sequence[str | None]) -> str:
    return _SEPARATOR.join(_normalize_team_name(name) for name in team_names)


def build_encounter_name_from_ids(
    team_ids: Sequence[int | None],
    team_names_by_id: Mapping[int, str],
) -> str:
    return build_encounter_name([None if team_id is None else team_names_by_id.get(team_id) for team_id in team_ids])
