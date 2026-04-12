import math

from .types import BracketSkeleton, Pairing


def generate(team_ids: list[int]) -> BracketSkeleton:
    """Generate single-elimination bracket.

    Supports non-power-of-2 team counts via byes in the first round.
    Teams are seeded in order (index 0 = seed 1).

    Returns a BracketSkeleton with pairings for all rounds.
    First round has concrete team_ids; subsequent rounds have None (TBD).
    """
    n = len(team_ids)
    if n < 2:
        return BracketSkeleton(pairings=[], total_rounds=0)

    bracket_size = 1 << math.ceil(math.log2(n))  # next power of 2
    total_rounds = int(math.log2(bracket_size))
    num_byes = bracket_size - n

    # Standard seeding order for bracket_size slots
    seeds = _seeding_order(bracket_size)

    # Map seeds to team_ids (BYE = None)
    seed_to_team: dict[int, int | None] = {}
    for i, tid in enumerate(team_ids):
        seed_to_team[i] = tid
    for i in range(n, bracket_size):
        seed_to_team[i] = None

    pairings: list[Pairing] = []
    match_counter = 0

    # Round 1: pair seeds according to bracket seeding
    round1_winners: list[int | None] = []
    for i in range(0, bracket_size, 2):
        home_seed = seeds[i]
        away_seed = seeds[i + 1]
        home = seed_to_team[home_seed]
        away = seed_to_team[away_seed]

        if home is None and away is None:
            round1_winners.append(None)
            continue

        # If one side is a BYE, the other gets a bye (auto-advance)
        if home is None:
            round1_winners.append(away)
            continue
        if away is None:
            round1_winners.append(home)
            continue

        match_counter += 1
        pairings.append(
            Pairing(
                home_team_id=home,
                away_team_id=away,
                round_number=1,
                name=f"R1 Match {match_counter}",
            )
        )
        round1_winners.append(None)  # TBD

    # Subsequent rounds: all TBD matches
    slots_in_round = bracket_size // 2
    for round_num in range(2, total_rounds + 1):
        slots_in_round //= 2
        for match_idx in range(slots_in_round):
            match_counter += 1
            pairings.append(
                Pairing(
                    home_team_id=None,
                    away_team_id=None,
                    round_number=round_num,
                    name=_round_name(round_num, total_rounds, match_idx + 1),
                )
            )

    return BracketSkeleton(pairings=pairings, total_rounds=total_rounds)


def _seeding_order(size: int) -> list[int]:
    """Generate standard tournament seeding order.

    For size=8: [0, 7, 3, 4, 1, 6, 2, 5]
    This ensures seed 1 vs seed 8, seed 4 vs seed 5, etc.
    """
    if size == 1:
        return [0]
    half = _seeding_order(size // 2)
    result = []
    for seed in half:
        result.append(seed)
        result.append(size - 1 - seed)
    return result


def _round_name(round_num: int, total_rounds: int, match_idx: int) -> str:
    rounds_from_end = total_rounds - round_num
    if rounds_from_end == 0:
        return "Grand Final"
    if rounds_from_end == 1:
        return f"Semifinal {match_idx}"
    if rounds_from_end == 2:
        return f"Quarterfinal {match_idx}"
    return f"R{round_num} Match {match_idx}"
