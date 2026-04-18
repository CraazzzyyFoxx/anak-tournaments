# quality_evaluator.py
"""
Quality metrics evaluation for tournament-style team balancing.

This module provides evaluation functions for balance solutions
using mathematical formulas adapted for multiple teams (tournament).
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from .models import QualityMetrics, QualitySettings, Team

if TYPE_CHECKING:
    from .models import DraftSolution


def calculate_p_norm(values: list[float], power: float) -> float:
    """Calculate p-norm of a list of values."""
    if power == 0:
        return max(abs(v) for v in values)
    if power == 1:
        return sum(abs(v) for v in values)
    if power == float("inf"):
        return max(abs(v) for v in values)
    
    sum_pow = sum(abs(v) ** power for v in values)
    return sum_pow ** (1.0 / power)


def dp_fairness(teams: list[Team], settings: QualitySettings) -> float:
    """
    Calculate dpFairness - measures difference in total team ratings.
    
    For multiple teams, calculates the spread (max - min) of team p-norms
    normalized by the mean.
    
    dpFairness = alpha * (max(team_norms) - min(team_norms)) / mean(team_norms)
    
    Or simpler: alpha * std(team_norms)
    """
    if not teams:
        return 0.0
    
    team_norms = []
    for team in teams:
        if settings.fairness_power_coef == 1.0:
            team_norms.append(float(team.total_rating))
        elif settings.fairness_power_coef == 2.0:
            team_norms.append(float(team.total_rating) ** 2)
        else:
            team_norms.append(calculate_p_norm([float(team.total_rating)], settings.fairness_power_coef))
    
    if len(teams) == 1:
        return 0.0
    
    mean_norm = sum(team_norms) / len(team_norms)
    if mean_norm == 0:
        return 0.0
    
    max_norm = max(team_norms)
    min_norm = min(team_norms)
    
    spread = max_norm - min_norm
    
    if settings.fairness_power_coef > 0:
        spread = spread / (mean_norm ** (1.0 - 1.0 / settings.fairness_power_coef))
    
    return settings.fairness_coef * spread


def dp_role_fairness(
    teams: list[Team],
    role_ids: list[uuid.UUID],
    role_counts: dict[uuid.UUID, int],
    settings: QualitySettings,
) -> float:
    """
    Calculate dpRoleFairness - measures difference in role-specific ratings between teams.
    
    For each role position, calculate the spread of ratings across all teams
    that have that role, then average and weight.
    """
    if not teams or not role_ids:
        return 0.0
    
    role_positions = []
    for role_id, count in role_counts.items():
        for _ in range(count):
            role_positions.append(role_id)
    
    if not role_positions:
        return 0.0
    
    role_rating_spreads = []
    
    for pos_idx, role_id in enumerate(role_positions):
        ratings = []
        for team in teams:
            for player in team.players:
                if player.role_id == role_id:
                    ratings.append(float(player.rating))
                    break
        
        if len(ratings) >= 2:
            spread = max(ratings) - min(ratings)
            mean_rating = sum(ratings) / len(ratings)
            if mean_rating > 0:
                normalized_spread = spread / mean_rating
                role_rating_spreads.append(normalized_spread)
    
    if not role_rating_spreads:
        return 0.0
    
    avg_spread = sum(role_rating_spreads) / len(role_rating_spreads)
    
    return settings.role_fairness_coef * avg_spread


def vq_uniformity(teams: list[Team], settings: QualitySettings) -> float:
    """
    Calculate vqUniformity - measures how evenly ratings are distributed.
    
    For each team, calculate the deviation from the global mean rating.
    Then calculate the spread of these deviations across teams.
    """
    if not teams:
        return 0.0
    
    all_ratings = []
    for team in teams:
        for player in team.players:
            all_ratings.append(float(player.rating))
    
    if not all_ratings:
        return 0.0
    
    global_mean = sum(all_ratings) / len(all_ratings)
    
    team_uniformities = []
    for team in teams:
        if len(team.players) <= 1:
            team_uniformities.append(0.0)
            continue
        
        ratings = [float(p.rating) for p in team.players]
        deviations = [abs(r - global_mean) for r in ratings]
        
        if settings.uniformity_power_coef == 1.0:
            mean_dev = sum(deviations) / len(deviations)
        elif settings.uniformity_power_coef == 2.0:
            variance = sum(d ** 2 for d in deviations) / len(deviations)
            mean_dev = variance ** 0.5
        else:
            mean_dev = calculate_p_norm(deviations, settings.uniformity_power_coef) / len(deviations)
        
        if global_mean > 0:
            mean_dev = mean_dev / global_mean
        team_uniformities.append(mean_dev)
    
    if len(team_uniformities) <= 1:
        return 0.0
    
    return max(team_uniformities) - min(team_uniformities)


def role_priority_points(teams: list[Team], settings: QualitySettings) -> float:
    """
    Calculate RolePriorityPoints - measures role assignment quality.
    
    Lower priority values mean better role assignment (1 = main role).
    Sum all priorities and add imbalance penalty if teams have unequal totals.
    """
    if not teams:
        return 0.0
    
    lost_points = 0
    team_points = []
    
    for team in teams:
        team_lost = 0
        for player in team.players:
            lost_points += settings.max_priority - player.priority
            team_lost += settings.max_priority - player.priority
        team_points.append(team_lost)
    
    imbalance = 0
    if len(team_points) >= 2:
        max_points = max(team_points)
        min_points = min(team_points)
        imbalance = max_points - min_points
    
    total = float(lost_points)
    if imbalance > settings.role_priority_imbalance_threshold:
        total += settings.role_priority_imbalance_coef * float(imbalance)
    
    return settings.role_priority_coef * total


def role_subrole_penalty(solution: "DraftSolution", settings: QualitySettings) -> float:
    """
    Convert NSGA subrole objective into weighted quality metric.
    """
    return settings.subrole_penalty_coef * float(solution.fitness_subrole)


def evaluate_solution(
    solution: DraftSolution,
    role_ids: list[uuid.UUID],
    role_counts: dict[uuid.UUID, int],
    settings: QualitySettings | None = None,
) -> QualityMetrics:
    """
    Calculate quality metrics for a draft solution.
    
    Args:
        solution: The draft solution to evaluate
        role_ids: List of role UUIDs in order
        role_counts: Dict mapping role_id to count per team
        settings: Quality settings with coefficient values
    
    Returns:
        QualityMetrics with all calculated values
    """
    if settings is None:
        settings = QualitySettings()
    
    teams = solution.teams
    
    fairness = dp_fairness(teams, settings)
    role_fairness = dp_role_fairness(teams, role_ids, role_counts, settings)
    uniformity = vq_uniformity(teams, settings)
    priority_points = role_priority_points(teams, settings)
    subrole_penalty = role_subrole_penalty(solution, settings)
    
    return QualityMetrics(
        dp_fairness=round(fairness, 2),
        dp_role_fairness=round(role_fairness, 2),
        vq_uniformity=round(uniformity, 2),
        role_priority_points=round(priority_points, 2),
        fitness_role_imbalance=round(float(solution.fitness_role_imbalance), 2),
        fitness_subrole=round(float(solution.fitness_subrole), 2),
        role_subrole_penalty=round(subrole_penalty, 2),
    )


def evaluate_solutions(
    solutions: list[DraftSolution],
    role_ids: list[uuid.UUID],
    role_counts: dict[uuid.UUID, int],
    settings: QualitySettings | None = None,
) -> list[DraftSolution]:
    """
    Calculate quality metrics for all solutions and sort by evaluation.
    
    Args:
        solutions: List of draft solutions to evaluate
        role_ids: List of role UUIDs in order
        role_counts: Dict mapping role_id to count per team
        settings: Quality settings with coefficient values
    
    Returns:
        List of solutions with quality metrics, sorted by evaluation (lower is better)
    """
    if settings is None:
        settings = QualitySettings()
    
    for solution in solutions:
        solution.quality = evaluate_solution(solution, role_ids, role_counts, settings)
    
    return sorted(solutions, key=lambda s: s.evaluation)


def rank_solutions(
    solutions: list[DraftSolution],
) -> list[tuple[int, DraftSolution]]:
    """
    Rank solutions by evaluation score.
    
    Returns list of (rank, solution) tuples where rank starts at 1.
    """
    sorted_solutions = sorted(solutions, key=lambda s: s.evaluation)
    return [(i + 1, sol) for i, sol in enumerate(sorted_solutions)]


__all__ = [
    "calculate_p_norm",
    "dp_fairness",
    "dp_role_fairness",
    "evaluate_solution",
    "evaluate_solutions",
    "QualityMetrics",
    "QualitySettings",
    "rank_solutions",
    "role_priority_points",
    "role_subrole_penalty",
    "vq_uniformity",
]
