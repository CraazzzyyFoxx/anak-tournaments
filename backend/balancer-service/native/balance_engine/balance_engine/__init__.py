"""
Balance Engine - Fast C++ team balancer for games.

This module provides a high-performance C++ implementation of team balancing
algorithms, exposed through a clean Python interface.

Features:
    - Optimized O(n) direct assignment (no backtracking)
    - Pre-filtering of valid role masks
    - Zero heap allocations in hot loop
    - Automatic UUID <-> int conversion
    - Both sync and async APIs

Simple API:
    # One-shot usage
    response = BalanceEngine.quick_find(players, role_ids, constraints, team_size, limit)

    # Reusable engine (recommended for repeated calls)
    engine = BalanceEngine(settings, role_ids, constraints)
    response = engine.find_balances(players, team_size, limit)

    # Async usage
    response = await async_find_balances(players, role_ids, constraints, team_size, limit)

All input/output uses plain Python dataclasses with UUID role identifiers.
UUID conversion to/from int is handled internally.
"""

from __future__ import annotations

from uuid import UUID

__version__ = "2.0.0"
__author__ = "Balance Engine Team"

# Import the compiled C++ extension module
try:
    from . import _core
except ImportError as e:
    import sys

    _import_error_msg = (
        f"Could not import the compiled C++ balance_engine module: {e}\n\n"
        "Possible solutions:\n"
        "  1. Rebuild the package:\n"
        "     pip install -e ./cpp_balancer --force-reinstall --no-cache-dir\n\n"
        "  2. Check if the correct Python version is used:\n"
        f"     Current: Python {sys.version_info.major}.{sys.version_info.minor}\n\n"
        "  3. Ensure all build dependencies are installed:\n"
        "     pip install pybind11 cmake ninja\n\n"
        "  4. On Linux, ensure libstdc++ is up to date:\n"
        "     sudo apt-get install libstdc++6"
    )
    raise ImportError(_import_error_msg) from e

# Import data models
from .models import (
    BalanceResponse,
    BalanceResultData,
    PlayerInfo,
    PlayerRoleInfo,
    QualityMetrics,
    QualitySettings,
    RoleConstraint,
    TeamPlayerResult,
    TeamResult,
)

# Import main wrapper
from .wrapper import BalanceEngine, UUIDMapper


def get_version() -> str:
    """Return the package version string."""
    return __version__


def get_cpp_version() -> str:
    """
    Return the C++ module version if available.

    Returns:
        Version string or 'unknown' if not available.
    """
    return getattr(_core, "__version__", "unknown")


def check_installation() -> dict[str, bool | str]:
    """
    Check if the package is properly installed.

    Returns:
        Dict with installation status information.
    """
    result = {
        "installed": True,
        "python_version": __version__,
        "cpp_module_loaded": False,
        "cpp_version": "unknown",
        "error": None,
    }

    try:
        # Try to use the C++ module
        _ = _core.QualitySettings()
        result["cpp_module_loaded"] = True
        result["cpp_version"] = get_cpp_version()
    except Exception as e:
        result["cpp_module_loaded"] = False
        result["error"] = str(e)

    return result


# Convenience factory functions (re-exported from wrapper for easy access)
def create_player(
    member_id: UUID,
    roles: list[tuple],  # [(role_uuid, rating, priority), ...]
    is_flex: bool = False,
) -> PlayerInfo:
    """
    Create a PlayerInfo from tuple data.

    Args:
        member_id: Player's unique ID
        roles: List of (role_uuid, rating, priority) tuples
        is_flex: Whether player can play any role

    Returns:
        PlayerInfo instance

    Example:
        >>> import uuid
        >>> TANK = uuid.uuid4()
        >>> player = create_player(1, [(TANK, 2500, 3)], False)
    """
    return PlayerInfo(
        member_id=member_id,
        roles=[PlayerRoleInfo(role_id=r[0], rating=r[1], priority=r[2]) for r in roles],
        is_flex=is_flex,
    )


def create_settings(
    alpha: float = 1.0,
    beta: float = 1.0,
    gamma: float = 1.0,
    p: float = 1.0,
    q: float = 1.0,
    g: float = 1.0,
    max_priority: int = 3,
    role_weights: dict | None = None,
) -> QualitySettings:
    """
    Create QualitySettings with all parameters.

    Args:
        alpha: Weight for fairness metric (default: 1.0)
        beta: Weight for role fairness metric (default: 1.0)
        gamma: Weight for role priority metric (default: 1.0)
        p: Power for fairness norm calculation (default: 1.0)
        q: Power for uniformity norm calculation (default: 1.0)
        g: Power for role fairness norm calculation (default: 1.0)
        max_priority: Maximum role priority value (default: 3)
        role_weights: Weight multipliers for each role {role_uuid: weight}

    Returns:
        QualitySettings instance
    """
    return QualitySettings(
        fairness_coef=alpha,
        role_fairness_coef=beta,
        role_priority_coef=gamma,
        fairness_power=p,
        uniformity_power=q,
        role_fairness_power=g,
        max_priority=max_priority,
        role_weights=role_weights,
    )


__all__ = [
    # Version info
    "__version__",
    "get_version",
    "get_cpp_version",
    "check_installation",
    # Main API
    "BalanceEngine",
    "UUIDMapper",
    # Data models
    "PlayerRoleInfo",
    "PlayerInfo",
    "RoleConstraint",
    "TeamPlayerResult",
    "TeamResult",
    "QualityMetrics",
    "BalanceResultData",
    "BalanceResponse",
    "QualitySettings",
    # Factory functions
    "create_player",
    "create_settings",
    # Low-level C++ module (for advanced usage)
    "_core",
]
