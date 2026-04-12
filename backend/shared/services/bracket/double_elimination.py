import math

from .types import BracketSkeleton, Pairing


def generate(team_ids: list[int]) -> BracketSkeleton:
    """Generate double-elimination bracket.

    Convention (matching existing codebase):
      round > 0  = upper (winners) bracket
      round < 0  = lower (losers) bracket
      Final rounds use the highest positive round numbers.

    Supports non-power-of-2 team counts via byes.
    """
    n = len(team_ids)
    if n < 2:
        return BracketSkeleton(pairings=[], total_rounds=0)

    bracket_size = 1 << math.ceil(math.log2(n))
    upper_rounds = int(math.log2(bracket_size))
    # Lower bracket has (upper_rounds - 1) * 2 rounds
    # Plus grand finals = 1-2 rounds
    lower_rounds = (upper_rounds - 1) * 2
    total_rounds = upper_rounds + lower_rounds + 2  # +2 for grand finals

    seeds = _seeding_order(bracket_size)
    seed_to_team: dict[int, int | None] = {}
    for i, tid in enumerate(team_ids):
        seed_to_team[i] = tid
    for i in range(n, bracket_size):
        seed_to_team[i] = None

    pairings: list[Pairing] = []

    # --- Upper bracket ---
    match_counter = 0

    # Upper R1
    for i in range(0, bracket_size, 2):
        home_seed = seeds[i]
        away_seed = seeds[i + 1]
        home = seed_to_team[home_seed]
        away = seed_to_team[away_seed]

        if home is None and away is None:
            continue
        if home is None or away is None:
            continue  # bye — auto-advance, no match needed

        match_counter += 1
        pairings.append(
            Pairing(
                home_team_id=home,
                away_team_id=away,
                round_number=1,
                name=f"UB R1 Match {match_counter}",
            )
        )

    # Upper R2+
    matches_in_round = bracket_size // 4
    for round_num in range(2, upper_rounds + 1):
        for match_idx in range(matches_in_round):
            pairings.append(
                Pairing(
                    home_team_id=None,
                    away_team_id=None,
                    round_number=round_num,
                    name=f"UB R{round_num} Match {match_idx + 1}",
                )
            )
        matches_in_round = max(1, matches_in_round // 2)

    # --- Lower bracket ---
    # Lower bracket round numbering: -1, -2, -3, ...
    # Pattern: pairs of rounds — first round receives dropdowns, second is internal
    lb_matches = bracket_size // 4  # initial lower bracket size
    lb_round = 1
    for phase in range(upper_rounds - 1):
        # Dropout round (losers from upper bracket drop down)
        for match_idx in range(lb_matches):
            pairings.append(
                Pairing(
                    home_team_id=None,
                    away_team_id=None,
                    round_number=-lb_round,
                    name=f"LB R{lb_round} Match {match_idx + 1}",
                )
            )
        lb_round += 1

        # Reduction round (winners of dropout round play each other)
        lb_matches = max(1, lb_matches // 2) if phase < upper_rounds - 2 else lb_matches
        for match_idx in range(lb_matches):
            pairings.append(
                Pairing(
                    home_team_id=None,
                    away_team_id=None,
                    round_number=-lb_round,
                    name=f"LB R{lb_round} Match {match_idx + 1}",
                )
            )
        lb_round += 1
        lb_matches = max(1, lb_matches // 2)

    # --- Grand Finals ---
    gf_round = upper_rounds + 1
    pairings.append(
        Pairing(
            home_team_id=None,
            away_team_id=None,
            round_number=gf_round,
            name="Grand Final",
        )
    )
    # Optional reset match
    pairings.append(
        Pairing(
            home_team_id=None,
            away_team_id=None,
            round_number=gf_round + 1,
            name="Grand Final Reset",
        )
    )

    return BracketSkeleton(pairings=pairings, total_rounds=total_rounds)


def _seeding_order(size: int) -> list[int]:
    if size == 1:
        return [0]
    half = _seeding_order(size // 2)
    result = []
    for seed in half:
        result.append(seed)
        result.append(size - 1 - seed)
    return result
