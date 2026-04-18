"""
NSGA Balancer - C++ NSGA-II team balancer.
"""

from __future__ import annotations

from .models import (
    AssignedPlayer,
    BalanceRequest,
    BalanceSettings,
    DraftSolution,
    EngineSettings,
    MathSettings,
    MetricSummary,
    NSGASettings,
    Player,
    PlayerRole,
    ProgressSnapshot,
    QualityMetrics,
    QualitySettings,
    RoleSettings,
    SubroleSettings,
    Team,
)
from .quality_evaluator import (
    evaluate_solution,
    evaluate_solutions,
    rank_solutions,
)
from .wrapper import NSGA2Balancer, balance_teams_nsga

try:
    from . import _core
except ImportError as e:
    import sys
    _import_error_msg = (
        f"Could not import the compiled C++ nsga_balancer module: {e}\n\n"
        "Possible solutions:\n"
        "  1. Rebuild the package:\n"
        "     pip install -e ./nsga_balancer --force-reinstall --no-cache-dir\n\n"
        "  2. Check if the correct Python version is used:\n"
        f"     Current: Python {sys.version_info.major}.{sys.version_info.minor}\n\n"
        "  3. Ensure all build dependencies are installed:\n"
        "     pip install pybind11 cmake ninja\n"
    )
    raise ImportError(_import_error_msg) from e

__version__ = "1.0.0"

__all__ = [
    "__version__",
    "_core",
    "AssignedPlayer",
    "balance_teams_nsga",
    "BalanceRequest",
    "BalanceSettings",
    "DraftSolution",
    "EngineSettings",
    "evaluate_solution",
    "evaluate_solutions",
    "MathSettings",
    "MetricSummary",
    "NSGA2Balancer",
    "NSGASettings",
    "Player",
    "PlayerRole",
    "ProgressSnapshot",
    "QualityMetrics",
    "QualitySettings",
    "rank_solutions",
    "RoleSettings",
    "SubroleSettings",
    "Team",
]
