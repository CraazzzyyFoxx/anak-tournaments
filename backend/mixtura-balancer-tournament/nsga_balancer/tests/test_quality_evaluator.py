# test_quality_evaluator.py
"""
Tests for quality evaluation metrics.
"""

import uuid
import pytest
from nsga_balancer.models import (
    AssignedPlayer,
    DraftSolution,
    QualityMetrics,
    QualitySettings,
    Team,
)
from nsga_balancer.quality_evaluator import (
    dp_fairness,
    dp_role_fairness,
    evaluate_solution,
    evaluate_solutions,
    rank_solutions,
    vq_uniformity,
    role_priority_points,
)


@pytest.fixture
def sample_teams():
    role_a = uuid.uuid4()
    role_b = uuid.uuid4()
    
    team1 = Team(
        team_id=1,
        players=[
            AssignedPlayer(uuid.uuid4(), role_a, 1000, 1),
            AssignedPlayer(uuid.uuid4(), role_b, 900, 1),
        ],
        total_rating=1900,
    )
    team2 = Team(
        team_id=2,
        players=[
            AssignedPlayer(uuid.uuid4(), role_a, 950, 2),
            AssignedPlayer(uuid.uuid4(), role_b, 850, 1),
        ],
        total_rating=1800,
    )
    return [team1, team2], role_a, role_b


def test_dp_fairness_balanced(sample_teams):
    teams, _, _ = sample_teams
    settings = QualitySettings(fairness_coef=3.0)
    
    fairness = dp_fairness(teams, settings)
    
    assert fairness >= 0
    assert fairness < 100


def test_dp_fairness_identical_teams():
    role = uuid.uuid4()
    teams = [
        Team(1, [AssignedPlayer(uuid.uuid4(), role, 1000, 1)], 1000),
        Team(2, [AssignedPlayer(uuid.uuid4(), role, 1000, 1)], 1000),
    ]
    settings = QualitySettings()
    
    fairness = dp_fairness(teams, settings)
    
    assert fairness == 0.0


def test_role_priority_points(sample_teams):
    teams, _, _ = sample_teams
    settings = QualitySettings(role_priority_coef=80.0)
    
    points = role_priority_points(teams, settings)
    
    assert points > 0
    assert points == 80.0 * (1 + 1 + 2 + 1)


def test_vq_uniformity(sample_teams):
    teams, _, _ = sample_teams
    settings = QualitySettings()
    
    uniformity = vq_uniformity(teams, settings)
    
    assert uniformity >= 0


def test_dp_role_fairness(sample_teams):
    teams, role_a, role_b = sample_teams
    role_counts = {role_a: 1, role_b: 1}
    settings = QualitySettings()
    
    role_fairness = dp_role_fairness(teams, [role_a, role_b], role_counts, settings)
    
    assert role_fairness >= 0


def test_evaluate_solution(sample_teams):
    teams, role_a, role_b = sample_teams
    role_counts = {role_a: 1, role_b: 1}
    
    solution = DraftSolution(
        solution_id=1,
        fitness_balance=10.0,
        fitness_priority=50.0,
        teams=teams,
    )
    
    quality = evaluate_solution(solution, [role_a, role_b], role_counts)
    
    assert isinstance(quality, QualityMetrics)
    assert quality.dp_fairness >= 0
    assert quality.dp_role_fairness >= 0
    assert quality.vq_uniformity >= 0
    assert quality.role_priority_points >= 0
    assert quality.fitness_role_imbalance == 0.0
    assert quality.role_subrole_penalty >= 0


def test_subrole_penalty_from_fitness(sample_teams):
    teams, role_a, role_b = sample_teams
    role_counts = {role_a: 1, role_b: 1}

    solution = DraftSolution(
        solution_id=10,
        fitness_balance=5.0,
        fitness_priority=8.0,
        fitness_subrole=2.0,
        teams=teams,
    )
    settings = QualitySettings(subrole_penalty_coef=40.0)

    quality = evaluate_solution(solution, [role_a, role_b], role_counts, settings)

    assert quality.fitness_role_imbalance == 0.0
    assert quality.fitness_subrole == 2.0
    assert quality.role_subrole_penalty == 80.0


def test_evaluate_solutions(sample_teams):
    teams, role_a, role_b = sample_teams
    role_counts = {role_a: 1, role_b: 1}
    
    solution1 = DraftSolution(1, 10.0, 50.0, teams=teams)
    solution2 = DraftSolution(2, 20.0, 40.0, teams=teams)
    
    solutions = evaluate_solutions(
        [solution1, solution2],
        [role_a, role_b],
        role_counts,
    )
    
    assert len(solutions) == 2
    assert solutions[0].evaluation <= solutions[1].evaluation


def test_rank_solutions(sample_teams):
    teams, role_a, role_b = sample_teams
    role_counts = {role_a: 1, role_b: 1}
    
    solution1 = DraftSolution(1, 20.0, 50.0, teams=teams)
    solution2 = DraftSolution(2, 10.0, 40.0, teams=teams)
    
    solutions = [solution1, solution2]
    evaluated = evaluate_solutions(solutions, [role_a, role_b], role_counts)
    ranked = rank_solutions(evaluated)
    
    assert len(ranked) == 2
    assert ranked[0][0] == 1
    assert ranked[1][0] == 2


def test_draft_solution_evaluation():
    solution = DraftSolution(
        solution_id=1,
        fitness_balance=10.0,
        fitness_priority=50.0,
        fitness_role_imbalance=5.0,
        teams=[],
    )

    assert solution.evaluation == 65.0

    solution.quality = QualityMetrics(
        dp_fairness=5.0,
        dp_role_fairness=3.0,
        vq_uniformity=1.0,
        role_priority_points=20.0,
        fitness_role_imbalance=4.0,
    )

    assert solution.quality.evaluation == 29.0
    assert solution.evaluation == 29.0


def test_quality_metrics_defaults():
    quality = QualityMetrics(
        dp_fairness=1.0,
        dp_role_fairness=2.0,
        vq_uniformity=0.5,
        role_priority_points=10.0,
        fitness_role_imbalance=4.0,
    )

    assert quality.evaluation == 13.5


def test_empty_teams():
    settings = QualitySettings()
    
    fairness = dp_fairness([], settings)
    uniformity = vq_uniformity([], settings)
    priority = role_priority_points([], settings)
    
    assert fairness == 0.0
    assert uniformity == 0.0
    assert priority == 0.0
