from dataclasses import dataclass

from .types import BracketSkeleton, Pairing


@dataclass(frozen=True)
class SwissStanding:
    team_id: int
    points: float
    buchholz: float = 0.0


def generate_round(
    standings: list[SwissStanding],
    played_pairs: set[frozenset[int]],
    round_number: int,
) -> BracketSkeleton:
    """Generate pairings for one Swiss round using Monrad system.

    Teams are sorted by points (desc), then paired top-down.
    Avoids rematches when possible by swapping with the next available opponent.

    Args:
        standings: Current standings sorted by points descending.
        played_pairs: Set of frozensets of team_id pairs already played.
        round_number: The round number for the generated pairings.

    Returns:
        BracketSkeleton with pairings for this single round.
    """
    sorted_teams = sorted(
        standings, key=lambda s: (s.points, s.buchholz), reverse=True
    )
    team_ids = [s.team_id for s in sorted_teams]
    paired: set[int] = set()
    pairings: list[Pairing] = []
    match_idx = 0

    for i, home_id in enumerate(team_ids):
        if home_id in paired:
            continue

        # Find best available opponent (top-down, no rematch)
        away_id: int | None = None
        for j in range(i + 1, len(team_ids)):
            candidate = team_ids[j]
            if candidate in paired:
                continue
            pair_key = frozenset({home_id, candidate})
            if pair_key not in played_pairs:
                away_id = candidate
                break

        if away_id is None:
            # Fallback: allow rematch if no other option
            for j in range(i + 1, len(team_ids)):
                candidate = team_ids[j]
                if candidate not in paired:
                    away_id = candidate
                    break

        if away_id is None:
            # Odd team count — BYE
            continue

        paired.add(home_id)
        paired.add(away_id)
        match_idx += 1
        pairings.append(
            Pairing(
                home_team_id=home_id,
                away_team_id=away_id,
                round_number=round_number,
                name=f"Swiss R{round_number} Match {match_idx}",
            )
        )

    return BracketSkeleton(pairings=pairings, total_rounds=1)
