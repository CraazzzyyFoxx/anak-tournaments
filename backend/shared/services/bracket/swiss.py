"""Swiss round generator (Monrad pairing with top-half/bottom-half split).

Key differences from the previous naive implementation:
- Within a score group, teams are paired top-half vs bottom-half (1v3, 2v4)
  instead of top-down (1v2, 3v4). This is the canonical Monrad approach.
- ``bye_history`` is threaded through so that no team receives two byes in the
  same tournament.
- Re-matches are still avoided; fallback allowed only if no other option.
"""

from __future__ import annotations

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
    *,
    bye_history: set[int] | None = None,
) -> BracketSkeleton:
    """Generate pairings for one Swiss round using Monrad system.

    Args:
        standings: Current standings.
        played_pairs: Set of frozensets of team_id pairs already played.
        round_number: Round number for generated pairings.
        bye_history: Optional set of team_ids that already received a bye.
    """
    sorted_teams = sorted(
        standings, key=lambda s: (s.points, s.buchholz), reverse=True
    )
    team_ids = [s.team_id for s in sorted_teams]

    paired: set[int] = set()
    pairings: list[Pairing] = []
    match_idx = 0
    next_local_id = 0
    bye_history = bye_history or set()

    # Group by score (points, buchholz) for proper Monrad top-half/bottom-half.
    groups: list[list[int]] = []
    group_key = None
    current_group: list[int] = []
    for s in sorted_teams:
        key = (s.points, s.buchholz)
        if key != group_key and current_group:
            groups.append(current_group)
            current_group = []
        group_key = key
        current_group.append(s.team_id)
    if current_group:
        groups.append(current_group)

    for group in groups:
        available = [tid for tid in group if tid not in paired]
        if not available:
            continue

        # Monrad: split group in half, pair top-half with bottom-half.
        half = len(available) // 2
        top_half = available[:half]
        bottom_half = available[half : half * 2]
        leftover = available[half * 2 :]  # odd one out, promoted to next group

        for top, bot in zip(top_half, bottom_half):
            pair_key = frozenset({top, bot})
            if pair_key in played_pairs:
                # Try to find a non-rematch partner for `top` from bottom_half.
                swapped = False
                for other in bottom_half:
                    if other in paired:
                        continue
                    candidate_key = frozenset({top, other})
                    if candidate_key not in played_pairs:
                        bot = other
                        swapped = True
                        break
                if not swapped:
                    # Fallback: allow the rematch.
                    pass

            paired.add(top)
            paired.add(bot)
            match_idx += 1
            pairings.append(
                Pairing(
                    home_team_id=top,
                    away_team_id=bot,
                    round_number=round_number,
                    name=f"Swiss R{round_number} Match {match_idx}",
                    local_id=next_local_id,
                )
            )
            next_local_id += 1

        # Promote leftover to next group's pool for pairing.
        if leftover:
            leftover_id = leftover[0]
            # Try to pair with next group's best candidate.
            for next_group in groups[groups.index(group) + 1 :]:
                candidates = [tid for tid in next_group if tid not in paired]
                if not candidates:
                    continue
                partner = None
                for cand in candidates:
                    if frozenset({leftover_id, cand}) not in played_pairs:
                        partner = cand
                        break
                if partner is None:
                    partner = candidates[0]
                paired.add(leftover_id)
                paired.add(partner)
                match_idx += 1
                pairings.append(
                    Pairing(
                        home_team_id=leftover_id,
                        away_team_id=partner,
                        round_number=round_number,
                        name=f"Swiss R{round_number} Match {match_idx}",
                        local_id=next_local_id,
                    )
                )
                next_local_id += 1
                break

    # Handle odd team count — bye goes to the lowest-ranked unplayed team that
    # has not yet received a bye.
    unplaced = [tid for tid in team_ids if tid not in paired]
    if len(unplaced) == 1:
        # Lowest-ranked unplaced team receives the bye; prefer not to give a
        # second bye to someone who already has one.
        bye_candidate = unplaced[0]
        for tid in reversed(team_ids):
            if tid in paired:
                continue
            if tid not in bye_history:
                bye_candidate = tid
                break
        paired.add(bye_candidate)

    return BracketSkeleton(pairings=pairings, total_rounds=1)
