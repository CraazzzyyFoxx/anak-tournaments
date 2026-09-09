# wrapper.py
"""
Balance Engine wrapper for C++ bindings.

This module provides a clean interface to the C++ balance engine.
It handles all UUID to int conversion internally (both role_id and member_id).

Users should only use BalanceEngine.find_balances() method.
All input and output uses plain Python dataclasses from models.py.
"""

from __future__ import annotations

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor

from . import _core
from .models import (
    BalanceResponse,
    BalanceResultData,
    EngineSettings,
    PlayerInfo,
    PlayerRoleInfo,
    QualityMetrics,
    QualitySettings,
    RoleConstraint,
    TeamPlayerResult,
    TeamResult,
)


class UUIDMapper:
    """
    Bidirectional UUID <-> int mapping.

    Used internally to convert Python UUIDs to C++ int identifiers
    and back. Handles both role_id and member_id mappings.
    """

    __slots__ = ("_uuid_to_int", "_int_to_uuid", "_next_id")

    def __init__(self) -> None:
        self._uuid_to_int: dict[uuid.UUID, int] = {}
        self._int_to_uuid: dict[int, uuid.UUID] = {}
        self._next_id: int = 0

    def register(self, uid: uuid.UUID) -> int:
        """Register a UUID and return its int mapping."""
        if uid in self._uuid_to_int:
            return self._uuid_to_int[uid]

        int_id = self._next_id
        self._uuid_to_int[uid] = int_id
        self._int_to_uuid[int_id] = uid
        self._next_id += 1
        return int_id

    def to_int(self, uid: uuid.UUID) -> int:
        """Convert UUID to int. Must be registered first."""
        return self._uuid_to_int[uid]

    def to_uuid(self, int_id: int) -> uuid.UUID:
        """Convert int back to UUID."""
        return self._int_to_uuid[int_id]

    def register_all(self, uids: list[uuid.UUID]) -> list[int]:
        """Register multiple UUIDs and return their int mappings."""
        return [self.register(uid) for uid in uids]

    def clear(self) -> None:
        """Clear all mappings."""
        self._uuid_to_int.clear()
        self._int_to_uuid.clear()
        self._next_id = 0


class BalanceEngine:
    """
    High-level interface to the C++ balance engine.

    Handles UUID to int mapping automatically for both role_id and member_id.

    Usage:
        engine = BalanceEngine(quality_settings, role_ids, role_constraints)
        response = engine.find_balances(players, team_size, balance_limit)

        # Or one-shot:
        response = BalanceEngine.quick_find(
            players, role_ids, constraints,
            team_size, balance_limit, quality_settings
        )
    """

    def __init__(
        self,
        quality_settings: QualitySettings,
        role_ids: list[uuid.UUID],
        role_constraints: dict[uuid.UUID, RoleConstraint],
        engine_settings: EngineSettings | None = None,
    ) -> None:
        """
        Create a new BalanceEngine instance.

        Args:
            quality_settings: QualitySettings object with calculation parameters
            role_ids: List of all available role UUIDs
            role_constraints: Dict mapping role UUID to RoleConstraint
            engine_settings: EngineSettings for threading/memory tuning (optional)
        """
        self._quality_settings = quality_settings
        self._engine_settings = engine_settings or EngineSettings()
        self._role_ids = role_ids
        self._role_constraints = role_constraints

        # Create separate mappers for roles and members
        # Role mapper is persistent (roles don't change)
        self._role_mapper = UUIDMapper()

        # Register all role IDs
        self._cpp_role_ids = self._role_mapper.register_all(role_ids)

        # Ensure constraint roles are also registered
        for role_uuid in role_constraints.keys():
            self._role_mapper.register(role_uuid)

        # Create C++ settings
        cpp_quality_settings = self._convert_quality_settings(quality_settings)
        cpp_engine_settings = self._convert_engine_settings(self._engine_settings)

        # Create C++ constraints
        cpp_constraints = self._convert_constraints(role_constraints)

        # Create C++ engine instance
        self._cpp_engine = _core.BalanceEngine(
            cpp_quality_settings, self._cpp_role_ids, cpp_constraints, cpp_engine_settings
        )

    def _convert_quality_settings(self, settings: QualitySettings) -> _core.QualitySettings:
        """Convert Python QualitySettings to C++ format."""
        cpp_settings = _core.QualitySettings()
        cpp_settings.alpha = settings.fairness_coef
        cpp_settings.beta = settings.role_fairness_coef
        cpp_settings.gamma = settings.role_priority_coef
        cpp_settings.xi = settings.imbalance_role_priority_coef
        cpp_settings.p = settings.fairness_power
        cpp_settings.q = settings.uniformity_power
        cpp_settings.g = settings.role_fairness_power
        cpp_settings.max_priority = settings.max_priority

        # Convert role weights (UUID keys -> int keys)
        if settings.role_weights:
            cpp_settings.role_weights = {
                self._role_mapper.to_int(uid): weight for uid, weight in settings.role_weights.items()
            }

        return cpp_settings

    def _convert_engine_settings(self, settings: EngineSettings) -> _core.EngineSettings:
        """Convert Python EngineSettings to C++ format."""
        cpp_settings = _core.EngineSettings()
        cpp_settings.num_workers = settings.num_workers
        cpp_settings.fallback_workers = settings.fallback_workers
        cpp_settings.worker_result_buffer = settings.worker_result_buffer
        cpp_settings.max_players = settings.max_players
        cpp_settings.mask_reserve_limit = settings.mask_reserve_limit
        cpp_settings.priority_imbalance_threshold = settings.priority_imbalance_threshold
        return cpp_settings

    def _convert_constraints(self, constraints: dict[uuid.UUID, RoleConstraint]) -> dict[int, _core.RoleConstraint]:
        """Convert Python RoleConstraints to C++ format."""
        return {
            self._role_mapper.to_int(role_uuid): _core.RoleConstraint(constraint.min_in_team, constraint.max_in_team)
            for role_uuid, constraint in constraints.items()
        }

    def _convert_players(
        self,
        players: list[PlayerInfo],
        member_mapper: UUIDMapper,
    ) -> list[_core.PlayerInfo]:
        """Convert Python PlayerInfo list to C++ format."""
        cpp_players = []

        for player in players:
            # Register and convert member_id UUID -> int
            member_int_id = member_mapper.register(player.member_id)

            cpp_roles = []
            for role_info in player.roles:
                role_int_id = self._role_mapper.to_int(role_info.role_id)
                cpp_role = _core.RoleRating(role_int_id, role_info.rating, role_info.priority)
                cpp_roles.append(cpp_role)

            cpp_player = _core.PlayerInfo(member_int_id, cpp_roles)
            cpp_players.append(cpp_player)

        return cpp_players

    def _convert_results(
        self,
        cpp_response: _core.BalanceResponse,
        member_mapper: UUIDMapper,
    ) -> BalanceResponse:
        """Convert C++ BalanceResponse to Python format."""
        python_results: list[BalanceResultData] = []

        for cpp_result in cpp_response.balances:
            # Convert quality metrics
            quality = QualityMetrics(
                fairness=cpp_result.quality.fairness,
                role_fairness=cpp_result.quality.role_fairness,
                role_points=cpp_result.quality.role_points,
                uniformity=cpp_result.quality.uniformity,
            )

            # Convert teams
            teams: list[TeamResult] = []
            for cpp_team in cpp_result.teams:
                python_players: list[TeamPlayerResult] = []

                for cpp_player in cpp_team.players:
                    # Convert back: int -> UUID for both member_id and role_id
                    member_uuid = member_mapper.to_uuid(cpp_player.member_id)
                    role_uuid = self._role_mapper.to_uuid(cpp_player.role_id)

                    python_player = TeamPlayerResult(
                        member_id=member_uuid, game_role_id=role_uuid, rating=cpp_player.rating
                    )
                    python_players.append(python_player)

                team = TeamResult(team_id=uuid.uuid4(), players=python_players)
                teams.append(team)

            result = BalanceResultData(quality=quality, teams=teams)
            python_results.append(result)

        return BalanceResponse(
            result_code=cpp_response.result_code,
            status=cpp_response.status,
            balances=python_results,
        )

    def find_balances(
        self,
        players: list[PlayerInfo],
        team_size: int,
        balance_limit: float,
        max_results: int = 1000,
    ) -> BalanceResponse:
        """
        Find optimal team balances.

        Args:
            players: List of PlayerInfo objects with Python UUID member_id and role_ids
            team_size: Size of each team
            balance_limit: Maximum quality score threshold
            max_results: Maximum number of results to return

        Returns:
            BalanceResponse with result code, status, and list of BalanceResultData
        """
        # Create fresh member mapper for this call
        # (members can change between calls)
        member_mapper = UUIDMapper()

        # Convert players to C++ format
        cpp_players = self._convert_players(players, member_mapper)

        # Call C++ engine
        cpp_response = self._cpp_engine.find_balances(cpp_players, team_size, balance_limit, max_results)

        # Convert results back to Python format
        return self._convert_results(cpp_response, member_mapper)

    @property
    def quality_settings(self) -> QualitySettings:
        """Get quality settings."""
        return self._quality_settings

    @property
    def engine_settings(self) -> EngineSettings:
        """Get engine settings."""
        return self._engine_settings

    @staticmethod
    def quick_find(
        players: list[PlayerInfo],
        role_ids: list[uuid.UUID],
        role_constraints: dict[uuid.UUID, RoleConstraint],
        team_size: int,
        balance_limit: float,
        quality_settings: QualitySettings | None = None,
        engine_settings: EngineSettings | None = None,
        max_results: int = 1000,
    ) -> BalanceResponse:
        """
        One-shot balance finding (convenience method).

        Creates a temporary engine and finds balances.
        For repeated calls with same settings, prefer creating
        a BalanceEngine instance.

        Args:
            players: List of PlayerInfo objects
            role_ids: List of all available role UUIDs
            role_constraints: Dict mapping role UUID to RoleConstraint
            team_size: Size of each team
            balance_limit: Maximum quality score threshold
            quality_settings: QualitySettings (uses defaults if None)
            engine_settings: EngineSettings (uses defaults if None)
            max_results: Maximum number of results to return

        Returns:
            BalanceResponse with results
        """
        if quality_settings is None:
            quality_settings = QualitySettings()

        engine = BalanceEngine(quality_settings, role_ids, role_constraints, engine_settings)
        return engine.find_balances(players, team_size, balance_limit, max_results)

    # Legacy static method for backwards compatibility
    @staticmethod
    def find_balances_static(
        players: list[PlayerInfo],
        role_ids: list[uuid.UUID],
        role_constraints: dict[uuid.UUID, RoleConstraint],
        team_size: int,
        balance_limit: float,
        quality_settings: QualitySettings | None = None,
    ) -> list[BalanceResultData]:
        """
        Legacy static method for backwards compatibility.

        Deprecated: Use BalanceEngine instance or quick_find() instead.
        """
        response = BalanceEngine.quick_find(
            players, role_ids, role_constraints, team_size, balance_limit, quality_settings
        )
        return response.balances

    @staticmethod
    async def async_quick_find_balances(
        players: list[PlayerInfo],
        role_ids: list[uuid.UUID],
        role_constraints: dict[uuid.UUID, RoleConstraint],
        team_size: int,
        balance_limit: float,
        quality_settings: QualitySettings | None = None,
        engine_settings: EngineSettings | None = None,
        max_results: int = 1000,
    ) -> BalanceResponse:
        """
        Async version of quick_find.

        Runs the balance finding in a thread pool to avoid blocking the event loop.

        Args:
            players: List of PlayerInfo objects
            role_ids: List of all available role UUIDs
            role_constraints: Dict mapping role UUID to RoleConstraint
            team_size: Size of each team
            balance_limit: Maximum quality score threshold
            quality_settings: QualitySettings (uses defaults if None)
            engine_settings: EngineSettings (uses defaults if None)
            max_results: Maximum number of results to return
        Returns:
            BalanceResponse with results
        """
        loop = asyncio.get_running_loop()
        executor = _get_default_executor()

        return await loop.run_in_executor(
            executor,
            lambda: BalanceEngine.quick_find(
                players,
                role_ids,
                role_constraints,
                team_size,
                balance_limit,
                quality_settings,
                engine_settings,
                max_results,
            ),
        )

    async def async_find_balances(
        self,
        players: list[PlayerInfo],
        team_size: int,
        balance_limit: float,
        max_results: int = 1000,
    ) -> BalanceResponse:
        """
        Async version using existing BalanceEngine instance.

        More efficient for repeated calls with same settings.

        Args:
            players: List of PlayerInfo objects with UUID member_id
            team_size: Size of each team
            balance_limit: Maximum quality score threshold
            max_results: Maximum number of results to return

        Returns:
            BalanceResponse with results
        """
        loop = asyncio.get_running_loop()
        executor = _get_default_executor()

        return await loop.run_in_executor(
            executor, lambda: self.find_balances(players, team_size, balance_limit, max_results)
        )


def _get_default_executor() -> ThreadPoolExecutor:
    """Get or create default thread pool executor."""
    global _executor
    if _executor is None:
        # Use engine settings default for fallback workers
        _executor = ThreadPoolExecutor(max_workers=EngineSettings().fallback_workers)
    return _executor


# Thread pool for async operations (lazy init)
_executor: ThreadPoolExecutor | None = None


def configure_thread_pool(max_workers: int) -> None:
    """
    Configure the thread pool used for async operations.

    Must be called before any async_find_balances calls.

    Args:
        max_workers: Maximum number of worker threads
    """
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=False)
    _executor = ThreadPoolExecutor(max_workers=max_workers)


def shutdown_thread_pool(wait: bool = True) -> None:
    """
    Shutdown the thread pool.

    Args:
        wait: Whether to wait for pending tasks to complete
    """
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=wait)
        _executor = None


__all__ = [
    # Main classes
    "BalanceEngine",
    "UUIDMapper",
    # Thread pool management (the async API is BalanceEngine.async_find_balances,
    # a method -- there is no module-level async helper to export)
    "configure_thread_pool",
    "shutdown_thread_pool",
    # Re-export models for convenience
    "PlayerRoleInfo",
    "PlayerInfo",
    "RoleConstraint",
    "QualitySettings",
    "EngineSettings",
    "TeamPlayerResult",
    "TeamResult",
    "QualityMetrics",
    "BalanceResultData",
    "BalanceResponse",
]
