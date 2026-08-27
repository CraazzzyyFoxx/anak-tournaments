# models.py
"""
Data models for Balance Engine.

These are plain Python dataclasses used for input/output.
The wrapper handles conversion to/from C++ types.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field


@dataclass
class PlayerRoleInfo:
    """Player's rating and priority for a specific role."""

    role_id: uuid.UUID
    rating: int
    priority: int  # 1-3, higher = more preferred


@dataclass
class PlayerInfo:
    """Information about a player."""

    member_id: uuid.UUID
    roles: list[PlayerRoleInfo]
    is_flex: bool = False  # Can play any role (reserved for future use)


@dataclass
class RoleConstraint:
    """Constraints for role distribution in a team."""

    min_in_team: int
    max_in_team: int


@dataclass
class QualitySettings:
    """Settings for balance quality calculations."""

    fairness_coef: float = 1.0  # Weight for fairness metric
    role_fairness_coef: float = 1.0  # Weight for role fairness metric
    role_priority_coef: float = 1.0  # Weight for role priority metric
    imbalance_role_priority_coef: float = 0.2  # Weight for role priority imbalance penalty
    fairness_power: float = 1.0  # Power for fairness norm
    uniformity_power: float = 1.0  # Power for uniformity norm
    role_fairness_power: float = 1.0  # Power for role fairness norm
    max_priority: int = 3  # Maximum role priority value
    role_weights: dict[uuid.UUID, float] | None = None  # Role weight multipliers


@dataclass
class EngineSettings:
    """Settings for engine threading and memory tuning."""

    num_workers: int = 0  # 0 = auto-detect
    fallback_workers: int = 4  # Fallback if auto-detect fails
    worker_result_buffer: int = 1000  # Extra buffer per worker for results
    max_players: int = 32  # Maximum players supported (bitmask limit)
    mask_reserve_limit: int = 20  # Limit for mask pre-allocation exponent
    priority_imbalance_threshold: int = 1  # Imbalance must exceed this to apply penalty


@dataclass
class QualityMetrics:
    """Quality metrics for a balance result."""

    fairness: float  # Team skill fairness score
    role_fairness: float  # Role-based fairness score
    role_points: float  # Role priority satisfaction score
    uniformity: float  # Skill distribution uniformity score

    @property
    def total(self) -> float:
        """Calculate total quality score (lower is better)."""
        return self.fairness + self.role_fairness + self.role_points + self.uniformity

    # Backwards compatibility
    @property
    def evaluation(self) -> float:
        """Alias for total (backwards compatibility)."""
        return self.total


@dataclass
class TeamPlayerResult:
    """Result of player assignment to a team and role."""

    member_id: uuid.UUID
    game_role_id: uuid.UUID  # Role UUID
    rating: int


@dataclass
class TeamResult:
    """Result containing team composition."""

    team_id: uuid.UUID
    players: list[TeamPlayerResult]


@dataclass
class BalanceResultData:
    """Single balance result with quality metrics and team compositions."""

    quality: QualityMetrics
    teams: list[TeamResult]

    def to_dict(self) -> dict:
        """Convert to dictionary format matching legacy output."""
        return {
            "dpFairness": round(self.quality.fairness, 2),
            "rgRolesFairness": round(self.quality.role_fairness, 2),
            "teamRolePriority": round(self.quality.role_points, 2),
            "vqUniformity": round(self.quality.uniformity, 2),
            "result": round(self.quality.total, 2),
        }


@dataclass
class BalanceResponse:
    """Response from balance search."""

    result_code: int
    status: str
    balances: list[BalanceResultData] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """Check if response is successful."""
        return self.result_code == 200

    def __bool__(self) -> bool:
        return self.ok and len(self.balances) > 0

    def __len__(self) -> int:
        return len(self.balances)

    def __iter__(self):
        return iter(self.balances)

    def __getitem__(self, index: int) -> BalanceResultData:
        return self.balances[index]

    def to_dict(self) -> dict:
        """Convert to dictionary format matching legacy output."""
        return {
            "result": self.result_code,
            "status": self.status,
            "active": [b.to_dict() for b in self.balances],
        }


__all__ = [
    "PlayerRoleInfo",
    "PlayerInfo",
    "RoleConstraint",
    "QualitySettings",
    "EngineSettings",
    "QualityMetrics",
    "TeamPlayerResult",
    "TeamResult",
    "BalanceResultData",
    "BalanceResponse",
]
