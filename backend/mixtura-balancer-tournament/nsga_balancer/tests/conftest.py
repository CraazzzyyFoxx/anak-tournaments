# conftest.py
"""
Pytest configuration and shared fixtures for nsga_balancer tests.
"""

import uuid
import pytest
from nsga_balancer.models import (
    BalanceSettings,
    MathSettings,
    Player,
    PlayerRole,
    RoleSettings,
)


@pytest.fixture
def sample_roles():
    """Create sample role UUIDs for testing."""
    return {
        "carry": uuid.UUID("12345678-1234-5678-1234-567812345678"),
        "mid": uuid.UUID("87654321-4321-8765-4321-876543218765"),
        "support": uuid.UUID("11111111-2222-3333-4444-555555555555"),
        "tank": uuid.UUID("66666666-7777-8888-9999-000000000000"),
    }


@pytest.fixture
def math_settings():
    """Create default math settings for testing."""
    return MathSettings(
        population_size=50,
        generations=10,
        num_pareto_solutions=5,
        weight_team_variance=1.0,
        role_imbalance_blend=0.1,
        subrole_blend=0.1,
        penalty_invalid_role=10000.0,
        penalty_prio_1=10.0,
        penalty_prio_2=3.0,
        penalty_prio_3=0.0,
    )


@pytest.fixture
def role_settings(sample_roles):
    """Create role settings for a 5-player team."""
    return {
        sample_roles["carry"]: RoleSettings(count_in_team=1),
        sample_roles["mid"]: RoleSettings(count_in_team=1),
        sample_roles["support"]: RoleSettings(count_in_team=2),
        sample_roles["tank"]: RoleSettings(count_in_team=1),
    }


@pytest.fixture
def balance_settings(role_settings, math_settings):
    """Create balance settings."""
    return BalanceSettings(
        players_in_team=5,
        roles=role_settings,
        math=math_settings,
    )


@pytest.fixture
def sample_players(sample_roles):
    """Create sample players with various roles and ratings."""
    return [
        Player(
            member_id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            roles={
                sample_roles["carry"]: PlayerRole(rating=2500, priority=1),
                sample_roles["mid"]: PlayerRole(rating=2400, priority=2),
            },
        ),
        Player(
            member_id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            roles={
                sample_roles["mid"]: PlayerRole(rating=2600, priority=1),
                sample_roles["carry"]: PlayerRole(rating=2400, priority=2),
            },
        ),
        Player(
            member_id=uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc"),
            roles={
                sample_roles["support"]: PlayerRole(rating=2200, priority=1),
            },
        ),
        Player(
            member_id=uuid.UUID("dddddddd-dddd-dddd-dddd-dddddddddddd"),
            roles={
                sample_roles["support"]: PlayerRole(rating=2100, priority=1),
            },
        ),
        Player(
            member_id=uuid.UUID("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"),
            roles={
                sample_roles["tank"]: PlayerRole(rating=2300, priority=1),
            },
        ),
        Player(
            member_id=uuid.UUID("ffffffff-ffff-ffff-ffff-ffffffffffff"),
            roles={
                sample_roles["tank"]: PlayerRole(rating=2250, priority=1),
            },
        ),
        Player(
            member_id=uuid.UUID("10101010-1010-1010-1010-101010101010"),
            roles={
                sample_roles["carry"]: PlayerRole(rating=2350, priority=1),
            },
        ),
        Player(
            member_id=uuid.UUID("20202020-2020-2020-2020-202020202020"),
            roles={
                sample_roles["mid"]: PlayerRole(rating=2450, priority=1),
            },
        ),
        Player(
            member_id=uuid.UUID("30303030-3030-3030-3030-303030303030"),
            roles={
                sample_roles["support"]: PlayerRole(rating=2150, priority=1),
            },
        ),
        Player(
            member_id=uuid.UUID("40404040-4040-4040-4040-404040404040"),
            roles={
                sample_roles["tank"]: PlayerRole(rating=2200, priority=1),
            },
        ),
    ]
