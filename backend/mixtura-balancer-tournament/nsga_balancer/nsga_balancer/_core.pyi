# _core.pyi
"""
NSGA Balancer - C++ module type stubs.
"""

from collections.abc import Callable
from typing import Iterator, overload

class PlayerRoleInfo:
    role_id: int
    rating: int
    priority: int
    subrole_ids: list[int]

    @overload
    def __init__(self) -> None: ...
    @overload
    def __init__(self, role_id: int, rating: int, priority: int, subrole_ids: list[int] = ...) -> None: ...
    def __repr__(self) -> str: ...

class PlayerInfo:
    member_id: int
    roles: list[PlayerRoleInfo]

    @overload
    def __init__(self) -> None: ...
    @overload
    def __init__(self, member_id: int, roles: list[PlayerRoleInfo]) -> None: ...
    def can_play_role(self, role_id: int) -> bool: ...
    def get_rating_for_role(self, role_id: int) -> int: ...
    def get_priority_for_role(self, role_id: int) -> int: ...
    def __repr__(self) -> str: ...

class RoleSettings:
    count_in_team: int
    subrole_capacities: dict[int, int]

    @overload
    def __init__(self) -> None: ...
    @overload
    def __init__(self, count_in_team: int, subrole_capacities: dict[int, int] = ...) -> None: ...
    def __repr__(self) -> str: ...

class NSGASettings:
    population_size: int
    generations: int
    num_pareto_solutions: int
    weight_team_variance: float
    role_imbalance_blend: float
    subrole_blend: float
    intra_team_std_blend: float
    penalty_invalid_role: float
    penalty_prio_1: float
    penalty_prio_2: float
    penalty_prio_3: float

    def __init__(self) -> None: ...
    def __repr__(self) -> str: ...

class EngineSettings:
    num_workers: int
    fallback_workers: int
    seed: int

    def __init__(self) -> None: ...
    def __repr__(self) -> str: ...

class AssignedPlayer:
    member_id: int
    role_id: int
    rating: int
    priority: int

    @overload
    def __init__(self) -> None: ...
    @overload
    def __init__(self, member_id: int, role_id: int, rating: int, priority: int) -> None: ...
    def __repr__(self) -> str: ...

class TeamResult:
    team_id: int
    players: list[AssignedPlayer]
    total_rating: int

    @overload
    def __init__(self) -> None: ...
    @overload
    def __init__(self, team_id: int, players: list[AssignedPlayer], total_rating: int) -> None: ...
    def __repr__(self) -> str: ...

class DraftSolution:
    solution_id: int
    fitness_balance: float
    fitness_priority: float
    fitness_role_imbalance: float
    fitness_subrole: float
    fitness_intra_team_std: float
    teams: list[TeamResult]

    def __init__(self) -> None: ...
    def __repr__(self) -> str: ...

class MetricSummary:
    min_value: float
    avg_value: float
    max_value: float

    def __init__(self) -> None: ...
    def __repr__(self) -> str: ...

class ProgressSnapshot:
    generation: int
    total_generations: int
    pareto_front_size: int
    fitness_balance: MetricSummary
    fitness_priority: MetricSummary
    fitness_role_imbalance: MetricSummary
    fitness_subrole: MetricSummary
    fitness_intra_team_std: MetricSummary

    def __init__(self) -> None: ...
    def __repr__(self) -> str: ...

class NSGA2Engine:
    def __init__(
        self,
        nsga_settings: NSGASettings,
        role_ids: list[int],
        role_settings: dict[int, RoleSettings],
        players_in_team: int,
        engine_settings: EngineSettings = ...,
    ) -> None:
        """
        Create a new NSGA2Engine instance.
        """
        ...

    def run(
        self,
        players: list[PlayerInfo],
        progress_callback: Callable[[ProgressSnapshot], None] | None = ...,
        progress_every: int = ...,
    ) -> list[DraftSolution]:
        """
        Run NSGA-II optimization.

        GIL is released during computation.
        """
        ...

    @property
    def nsga_settings(self) -> NSGASettings: ...

    @property
    def engine_settings(self) -> EngineSettings: ...

    def __repr__(self) -> str: ...

def create_player(member_id: int, roles: list[tuple[int, int, int, list[int]]]) -> PlayerInfo:
    """
    Create a PlayerInfo from tuple data.
    """
    ...

def create_nsga_settings(
    population_size: int = 200,
    generations: int = 1000,
    num_pareto_solutions: int = 50,
    weight_team_variance: float = 1.0,
    role_imbalance_blend: float = 0.1,
    subrole_blend: float = 0.1,
    intra_team_std_blend: float = 0.0,
    penalty_invalid_role: float = 10000.0,
    penalty_prio_1: float = 10.0,
    penalty_prio_2: float = 3.0,
    penalty_prio_3: float = 0.0,
) -> NSGASettings:
    """
    Create NSGASettings with all parameters.
    """
    ...

def create_role_settings(
    count_in_team: int = 1,
    subrole_capacities: dict[int, int] = ...,
) -> RoleSettings:
    """
    Create RoleSettings with count_in_team.
    """
    ...

def create_engine_settings(
    num_workers: int = 0,
    fallback_workers: int = 4,
    seed: int = 42,
) -> EngineSettings:
    """
    Create EngineSettings with all parameters.
    """
    ...
