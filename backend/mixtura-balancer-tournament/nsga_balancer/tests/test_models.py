# test_models.py
"""
Tests for nsga_balancer models.
"""

import uuid
import pytest
from nsga_balancer.models import (
    PlayerRole,
    Player,
    RoleSettings,
    SubroleSettings,
    MathSettings,
    BalanceSettings,
    BalanceRequest,
    AssignedPlayer,
    Team,
    DraftSolution,
)


def test_player_role():
    role = PlayerRole(rating=2500, priority=1, subrole_ids=[])
    assert role.rating == 2500
    assert role.priority == 1
    assert role.subrole_ids == []


def test_player_with_roles():
    carry_id = uuid.uuid4()
    player = Player(
        member_id=uuid.uuid4(),
        roles={carry_id: PlayerRole(rating=2500, priority=3)},
    )
    assert carry_id in player.roles
    assert player.roles[carry_id].rating == 2500


def test_role_settings():
    settings = RoleSettings(count_in_team=2, subroles={uuid.uuid4(): SubroleSettings(capacity=1)})
    assert settings.count_in_team == 2
    assert len(settings.subroles) == 1


def test_math_settings_defaults():
    settings = MathSettings()
    assert settings.population_size == 200
    assert settings.generations == 1000
    assert settings.num_pareto_solutions == 50
    assert settings.penalty_invalid_role == 10000.0


def test_balance_settings():
    roles = {uuid.uuid4(): RoleSettings(count_in_team=1)}
    settings = BalanceSettings(
        players_in_team=5,
        roles=roles,
        math=MathSettings(population_size=100),
    )
    assert settings.players_in_team == 5
    assert len(settings.roles) == 1
    assert settings.math.population_size == 100


def test_assigned_player():
    player = AssignedPlayer(
        member_id=uuid.uuid4(),
        role_id=uuid.uuid4(),
        rating=2500,
        priority=2,
    )
    assert player.rating == 2500
    assert player.priority == 2


def test_team():
    players = [
        AssignedPlayer(uuid.uuid4(), uuid.uuid4(), 2500, 1),
        AssignedPlayer(uuid.uuid4(), uuid.uuid4(), 2400, 2),
    ]
    team = Team(team_id=1, players=players, total_rating=4900)
    assert team.team_id == 1
    assert len(team.players) == 2
    assert team.total_rating == 4900


def test_draft_solution():
    teams = [
        Team(team_id=1, players=[], total_rating=5000),
        Team(team_id=2, players=[], total_rating=5000),
    ]
    solution = DraftSolution(
        solution_id=1,
        fitness_balance=10.5,
        fitness_priority=50.0,
        fitness_role_imbalance=7.5,
        teams=teams,
    )
    assert solution.solution_id == 1
    assert solution.fitness_balance == 10.5
    assert solution.fitness_role_imbalance == 7.5
    assert len(solution.teams) == 2
