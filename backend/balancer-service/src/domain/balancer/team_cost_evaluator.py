from __future__ import annotations

from src.core.config import AlgorithmConfig
from src.domain.balancer.entities import Team
from src.domain.balancer.statistics import _sample_stdev_from_sums, calculate_gap_penalty


def calculate_cost(teams: list[Team], config: AlgorithmConfig) -> float:
    """Calculate the scalar fitness value of a team configuration."""
    if not teams:
        return float("inf")

    team_count = len(teams)
    mask = config.role_mask

    sum_mmr = 0.0
    sum_mmr2 = 0.0
    sum_total = 0.0
    sum_total2 = 0.0
    sum_discomfort = 0.0
    sum_intra_std = 0.0
    sum_subrole_collisions = 0
    global_max_pain = 0

    min_team_total = float("inf")
    max_team_total = float("-inf")

    role_sums: dict[str, float] = {}
    role_sums2: dict[str, float] = {}
    role_counts: dict[str, int] = {}

    total_role_spread = 0.0
    counted_spread_teams = 0

    for team in teams:
        team.calculate_stats()

        team_mmr = team._cached_mmr
        team_total = team._cached_total_rating

        sum_mmr += team_mmr
        sum_mmr2 += team_mmr * team_mmr
        sum_total += team_total
        sum_total2 += team_total * team_total
        sum_discomfort += team._cached_discomfort
        sum_intra_std += team._cached_intra_std
        sum_subrole_collisions += team._cached_subrole_collisions

        if team_total < min_team_total:
            min_team_total = team_total
        if team_total > max_team_total:
            max_team_total = team_total

        if team._cached_max_pain > global_max_pain:
            global_max_pain = team._cached_max_pain

        for role, role_total in team._cached_role_totals.items():
            required = mask.get(role, 0)
            if required <= 0:
                continue
            role_avg = role_total / required
            if role in role_sums:
                role_sums[role] += role_avg
                role_sums2[role] += role_avg * role_avg
                role_counts[role] += 1
            else:
                role_sums[role] = role_avg
                role_sums2[role] = role_avg * role_avg
                role_counts[role] = 1

        if team._cached_role_spread_counted:
            total_role_spread += team._cached_role_spread_var
            counted_spread_teams += 1

    inter_team_std = _sample_stdev_from_sums(sum_mmr, sum_mmr2, team_count)
    total_rating_std = _sample_stdev_from_sums(sum_total, sum_total2, team_count)
    avg_discomfort = sum_discomfort / team_count
    avg_intra_std = sum_intra_std / team_count
    max_team_gap = max_team_total - min_team_total if team_count >= 2 else 0.0
    gap_penalty = calculate_gap_penalty(max_team_gap)

    total_role_balance = 0.0
    counted_roles = 0
    for role, count in role_counts.items():
        if count >= 2:
            total_role_balance += _sample_stdev_from_sums(role_sums[role], role_sums2[role], count)
            counted_roles += 1

    role_balance_penalty = total_role_balance / counted_roles if counted_roles else 0.0
    role_spread_penalty = total_role_spread / counted_spread_teams if counted_spread_teams else 0.0

    return (
        total_rating_std * config.team_total_balance_weight
        + gap_penalty * config.max_team_gap_weight
        + inter_team_std * config.average_mmr_balance_weight
        + avg_discomfort * config.role_discomfort_weight
        + avg_intra_std * config.intra_team_variance_weight
        + global_max_pain * config.max_role_discomfort_weight
        + role_balance_penalty * config.role_line_balance_weight
        + role_spread_penalty * config.role_spread_weight
        + sum_subrole_collisions * config.sub_role_collision_weight
    )


class TeamCostEvaluator:
    def calculate(self, teams: list[Team], config: AlgorithmConfig) -> float:
        return calculate_cost(teams, config)
