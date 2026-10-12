from .types import BracketSkeleton, Pairing


def generate(team_ids: list[int]) -> BracketSkeleton:
    """Generate round-robin pairings using the circle method.

    Each team plays every other team exactly once. If the number of teams is
    odd, a BYE (None) is added and matches against BYE are skipped.

    Round-robin does not produce advancement edges — standings are computed
    from scores.
    """
    teams = list(team_ids)
    has_bye = len(teams) % 2 != 0
    if has_bye:
        teams.append(-1)  # sentinel for BYE

    n = len(teams)
    total_rounds = n - 1
    pairings: list[Pairing] = []
    next_local_id = 0

    for round_num in range(total_rounds):
        for i in range(n // 2):
            first = teams[i]
            second = teams[n - 1 - i]

            if first == -1 or second == -1:
                continue

            pairings.append(
                Pairing(
                    team_ids=(first, second),
                    round_number=round_num + 1,
                    name=f"Round {round_num + 1}",
                    local_id=next_local_id,
                )
            )
            next_local_id += 1

        teams.insert(1, teams.pop())

    return BracketSkeleton(pairings=pairings, total_rounds=total_rounds)
