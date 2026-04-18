# models.py
"""
Data models for NSGA Balancer.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field


@dataclass
class PlayerRole:
    priority: int
    rating: int
    subrole_ids: list[uuid.UUID] | None = None


@dataclass
class Player:
    member_id: uuid.UUID
    roles: dict[uuid.UUID, PlayerRole]


@dataclass
class SubroleSettings:
    capacity: int = 1


@dataclass
class RoleSettings:
    count_in_team: int
    subroles: dict[uuid.UUID, SubroleSettings] = field(default_factory=dict)


@dataclass
class MathSettings:
    population_size: int = 200
    generations: int = 1000
    num_pareto_solutions: int = 50
    weight_team_variance: float = 1.0
    role_imbalance_blend: float = 0.1
    subrole_blend: float = 0.1
    intra_team_std_blend: float = 0.0
    penalty_invalid_role: float = 10000.0
    penalty_prio_1: float = 10.0
    penalty_prio_2: float = 3.0
    penalty_prio_3: float = 0.0


@dataclass
class BalanceSettings:
    players_in_team: int
    roles: dict[uuid.UUID, RoleSettings] = field(default_factory=dict)
    math: MathSettings = field(default_factory=MathSettings)


@dataclass
class BalanceRequest:
    draft_id: uuid.UUID
    players: list[Player]
    balance_settings: BalanceSettings


@dataclass
class EngineSettings:
    num_workers: int = 0
    fallback_workers: int = 4
    seed: int = 42


@dataclass
class NSGASettings:
    population_size: int = 200
    generations: int = 1000
    num_pareto_solutions: int = 50
    weight_team_variance: float = 1.0
    role_imbalance_blend: float = 0.1
    subrole_blend: float = 0.1
    intra_team_std_blend: float = 0.0
    penalty_invalid_role: float = 10000.0
    penalty_prio_1: float = 10.0
    penalty_prio_2: float = 3.0
    penalty_prio_3: float = 0.0


@dataclass
class QualitySettings:
    max_priority: int = 3
    fairness_coef: float = 3.0
    role_fairness_coef: float = 1.0
    role_priority_coef: float = 80.0
    subrole_penalty_coef: float = 40.0
    role_priority_imbalance_coef: float = 0.2
    fairness_power_coef: float = 2.0
    uniformity_power_coef: float = 2.0
    role_priority_imbalance_threshold: int = 1


@dataclass
class QualityMetrics:
    dp_fairness: float
    dp_role_fairness: float
    vq_uniformity: float
    role_priority_points: float
    fitness_role_imbalance: float = 0.0
    fitness_subrole: float = 0.0
    role_subrole_penalty: float = 0.0

    @property
    def evaluation(self) -> float:
        return (
            self.dp_fairness
            + self.dp_role_fairness
            + self.vq_uniformity
            + self.role_priority_points
        )


@dataclass
class MetricSummary:
    min_value: float = 0.0
    avg_value: float = 0.0
    max_value: float = 0.0


@dataclass
class ProgressSnapshot:
    generation: int
    total_generations: int
    pareto_front_size: int
    fitness_balance: MetricSummary
    fitness_priority: MetricSummary
    fitness_role_imbalance: MetricSummary
    fitness_subrole: MetricSummary
    fitness_intra_team_std: MetricSummary = field(default_factory=MetricSummary)


@dataclass
class AssignedPlayer:
    member_id: uuid.UUID
    role_id: uuid.UUID
    rating: int
    priority: int


@dataclass
class Team:
    team_id: int
    players: list[AssignedPlayer]
    total_rating: int


@dataclass
class DraftSolution:
    solution_id: int
    fitness_balance: float
    fitness_priority: float
    fitness_role_imbalance: float = 0.0
    fitness_subrole: float = 0.0
    fitness_intra_team_std: float = 0.0
    quality: QualityMetrics | None = None
    teams: list[Team] = field(default_factory=list)

    @property
    def evaluation(self) -> float:
        if self.quality is not None:
            return self.quality.evaluation
        return (
            self.fitness_balance
            + self.fitness_priority
            + self.fitness_role_imbalance
            + self.fitness_subrole
        )


__all__ = [
    "AssignedPlayer",
    "BalanceRequest",
    "BalanceSettings",
    "DraftSolution",
    "EngineSettings",
    "MathSettings",
    "MetricSummary",
    "NSGASettings",
    "Player",
    "PlayerRole",
    "ProgressSnapshot",
    "QualityMetrics",
    "QualitySettings",
    "RoleSettings",
    "SubroleSettings",
    "Team",
]
