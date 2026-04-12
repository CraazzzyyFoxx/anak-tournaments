from dataclasses import dataclass


@dataclass(frozen=True)
class Pairing:
    """A single match pairing between two teams."""

    home_team_id: int | None
    away_team_id: int | None
    round_number: int
    name: str = ""


@dataclass(frozen=True)
class BracketSkeleton:
    """Complete bracket structure with all pairings across rounds."""

    pairings: list[Pairing]
    total_rounds: int
