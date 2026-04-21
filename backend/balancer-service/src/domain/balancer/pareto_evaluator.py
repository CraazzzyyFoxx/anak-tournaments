from __future__ import annotations

import math

from src.core.config import AlgorithmConfig
from src.domain.balancer.entities import Team
from src.domain.balancer.statistics import _sample_stdev_from_sums, calculate_gap_penalty


def calculate_objectives(teams: list[Team], config: AlgorithmConfig) -> tuple[float, float]:
    """Split scalar fitness into balance and comfort objectives."""
    if not teams:
        return (float("inf"), float("inf"))

    team_count = len(teams)
    mask = config.role_mask

    sum_mmr = 0.0
    sum_mmr2 = 0.0
    sum_total = 0.0
    sum_total2 = 0.0

    min_team_total = float("inf")
    max_team_total = float("-inf")

    team_max_ratings: list[int] = []
    team_min_ratings: list[int] = []
    role_line_avgs: dict[str, list[float]] = {}

    sum_discomfort = 0.0
    global_max_pain = 0
    sum_subrole_collisions = 0

    for team in teams:
        team.calculate_stats()

        team_mmr = team._cached_mmr
        team_total = team._cached_total_rating

        sum_mmr += team_mmr
        sum_mmr2 += team_mmr * team_mmr
        sum_total += team_total
        sum_total2 += team_total * team_total

        if team_total < min_team_total:
            min_team_total = team_total
        if team_total > max_team_total:
            max_team_total = team_total

        sum_discomfort += team._cached_discomfort
        if team._cached_max_pain > global_max_pain:
            global_max_pain = team._cached_max_pain
        sum_subrole_collisions += team._cached_subrole_collisions

        all_ratings_in_team: list[int] = []
        for role, players in team.roster.items():
            for player in players:
                all_ratings_in_team.append(player.get_rating(role))

        if all_ratings_in_team:
            team_max_ratings.append(max(all_ratings_in_team))
            team_min_ratings.append(min(all_ratings_in_team))

        for role, players in team.roster.items():
            if not players:
                continue
            required = mask.get(role, 0)
            if required <= 0:
                continue

            role_sum = sum(player.get_rating(role) for player in players)
            role_avg = role_sum / len(players)
            role_line_avgs.setdefault(role, []).append(role_avg)

    total_rating_std = _sample_stdev_from_sums(sum_total, sum_total2, team_count)
    max_team_gap = max_team_total - min_team_total if team_count >= 2 else 0.0
    gap_penalty = calculate_gap_penalty(max_team_gap)
    inter_team_std = _sample_stdev_from_sums(sum_mmr, sum_mmr2, team_count)

    quantile_gap_penalty = 0.0
    if team_count >= 2 and team_max_ratings and team_min_ratings:
        top_gap = max(team_max_ratings) - min(team_max_ratings)
        bottom_gap = max(team_min_ratings) - min(team_min_ratings)
        quantile_gap_penalty = (top_gap * 1.5) + bottom_gap

    role_line_penalty = 0.0
    counted_roles = 0
    for averages in role_line_avgs.values():
        if len(averages) < 2:
            continue
        mean_avg = sum(averages) / len(averages)
        variance = sum((value - mean_avg) ** 2 for value in averages) / len(averages)
        std_dev = math.sqrt(variance) if variance > 0 else 0.0
        role_line_penalty += std_dev
        counted_roles += 1

    if counted_roles > 0:
        role_line_penalty /= counted_roles

    objective_balance = (
        total_rating_std * config.team_total_balance_weight
        + gap_penalty * config.max_team_gap_weight
        + inter_team_std * config.average_mmr_balance_weight
        + quantile_gap_penalty * getattr(config, "QUANTILE_GAP_WEIGHT", 1.0)
        + role_line_penalty * getattr(config, "role_line_balance_weight", 1.0)
    )

    avg_discomfort = sum_discomfort / team_count if team_count > 0 else 0.0
    objective_comfort = (
        avg_discomfort * config.role_discomfort_weight
        + global_max_pain * config.max_role_discomfort_weight
        + sum_subrole_collisions * config.sub_role_collision_weight
    )

    return (objective_balance, objective_comfort)


class ParetoEvaluator:
    def calculate(self, teams: list[Team], config: AlgorithmConfig) -> tuple[float, float]:
        return calculate_objectives(teams, config)
