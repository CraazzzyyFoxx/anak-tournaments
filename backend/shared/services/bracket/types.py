"""The format-neutral shape of a bracket: seats and places, not sides.

An encounter seats ``slot_count`` participations (D55), so a pairing is a
sequence of team ids -- index ``i`` is slot ``i + 1`` -- and an edge between two
of them names the PLACE it moves (``source_position``: 1 is the old "winner", 2
the old "loser") and the SEAT it fills (``target_slot``). Nothing here knows
about home and away.
"""

from dataclasses import dataclass, field

__all__ = (
    "Pairing",
    "AdvancementEdge",
    "BracketSkeleton",
)


@dataclass(frozen=True)
class AdvancementEdge:
    """``source_position`` of ``source_local_id`` fills ``target_slot`` of
    ``target_local_id``, within one skeleton.

    ``local_id`` values are skeleton-local (0-based); the consumer translates
    them to real DB encounter ids when persisting the ``EncounterLink`` rows.
    """

    source_local_id: int
    #: Place in the source encounter's final standing; 1 is first.
    source_position: int
    target_local_id: int
    #: Seat of the target encounter, ``1..slot_count``.
    target_slot: int


@dataclass(frozen=True)
class Pairing:
    """One encounter: ``team_ids[i]`` is seeded into slot ``i + 1``, ``None``
    when the seat waits for an advancement edge."""

    team_ids: tuple[int | None, ...]
    round_number: int
    name: str = ""
    local_id: int = 0  # Position in the pairings list (bracket-local identity)

    @property
    def slot_count(self) -> int:
        return len(self.team_ids)


@dataclass(frozen=True)
class BracketSkeleton:
    """Complete bracket structure with all pairings and advancement edges."""

    pairings: list[Pairing]
    total_rounds: int
    advancement_edges: list[AdvancementEdge] = field(default_factory=list)
    bye_team_id: int | None = None
