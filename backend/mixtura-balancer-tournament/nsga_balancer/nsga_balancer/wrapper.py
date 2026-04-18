# wrapper.py
"""
NSGA Balancer wrapper for C++ bindings.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from . import _core
from .models import (
    AssignedPlayer,
    BalanceRequest,
    DraftSolution,
    MathSettings,
    MetricSummary,
    ProgressSnapshot,
    RoleSettings,
    Team,
)


class UUIDMapper:
    __slots__ = ("_uuid_to_int", "_int_to_uuid", "_next_id")

    def __init__(self) -> None:
        self._uuid_to_int: dict[uuid.UUID, int] = {}
        self._int_to_uuid: dict[int, uuid.UUID] = {}
        self._next_id: int = 0

    def register(self, uid: uuid.UUID) -> int:
        if uid in self._uuid_to_int:
            return self._uuid_to_int[uid]
        int_id = self._next_id
        self._uuid_to_int[uid] = int_id
        self._int_to_uuid[int_id] = uid
        self._next_id += 1
        return int_id

    def to_int(self, uid: uuid.UUID) -> int:
        return self._uuid_to_int[uid]

    def to_uuid(self, int_id: int) -> uuid.UUID:
        return self._int_to_uuid[int_id]

    def register_all(self, uids: list[uuid.UUID]) -> list[int]:
        return [self.register(uid) for uid in uids]


class NSGA2Balancer:
    def __init__(self, request: BalanceRequest) -> None:
        self.request = request
        self.settings = request.balance_settings.math
        self.players_in_team = request.balance_settings.players_in_team

        self._role_mapper = UUIDMapper()
        self._subrole_mapper = UUIDMapper()
        self._player_uuids = [p.member_id for p in request.players]
        self._role_uuids = list(request.balance_settings.roles.keys())
        self._cpp_role_ids = self._role_mapper.register_all(self._role_uuids)
        self._role_subroles: dict[uuid.UUID, list[uuid.UUID]] = {
            role_uuid: list(role_settings.subroles.keys())
            for role_uuid, role_settings in request.balance_settings.roles.items()
        }

        all_subroles: list[uuid.UUID] = []
        for subroles in self._role_subroles.values():
            all_subroles.extend(subroles)
        unique_subroles = list(dict.fromkeys(all_subroles))
        self._subrole_mapper.register_all(unique_subroles)

        cpp_nsga_settings = self._convert_nsga_settings(self.settings)
        cpp_engine_settings = _core.create_engine_settings(0, 4, 42)
        cpp_role_settings = self._convert_role_settings(request.balance_settings.roles)

        self._cpp_engine = _core.NSGA2Engine(
            cpp_nsga_settings,
            self._cpp_role_ids,
            cpp_role_settings,
            self.players_in_team,
            cpp_engine_settings,
        )

    def _convert_nsga_settings(self, settings: MathSettings) -> _core.NSGASettings:
        cpp_settings = _core.NSGASettings()
        cpp_settings.population_size = settings.population_size
        cpp_settings.generations = settings.generations
        cpp_settings.num_pareto_solutions = settings.num_pareto_solutions
        cpp_settings.weight_team_variance = settings.weight_team_variance
        cpp_settings.role_imbalance_blend = settings.role_imbalance_blend
        cpp_settings.subrole_blend = settings.subrole_blend
        cpp_settings.intra_team_std_blend = settings.intra_team_std_blend
        cpp_settings.penalty_invalid_role = settings.penalty_invalid_role
        cpp_settings.penalty_prio_1 = settings.penalty_prio_1
        cpp_settings.penalty_prio_2 = settings.penalty_prio_2
        cpp_settings.penalty_prio_3 = settings.penalty_prio_3
        return cpp_settings

    def _convert_role_settings(
        self, roles: dict[uuid.UUID, RoleSettings]
    ) -> dict[int, _core.RoleSettings]:
        return {
            self._role_mapper.to_int(role_uuid): _core.create_role_settings(
                role_settings.count_in_team,
                {
                    self._subrole_mapper.to_int(subrole_uuid): subrole_settings.capacity
                    for subrole_uuid, subrole_settings in role_settings.subroles.items()
                },
            )
            for role_uuid, role_settings in roles.items()
        }

    def _convert_players(
        self, players: list, member_mapper: UUIDMapper
    ) -> list[_core.PlayerInfo]:
        cpp_players = []
        for player in players:
            member_int_id = member_mapper.register(player.member_id)
            cpp_roles = []
            for role_uuid, role_info in player.roles.items():
                role_int_id = self._role_mapper.to_int(role_uuid)
                role_subroles = self._role_subroles.get(role_uuid, [])
                if role_subroles:
                    if role_info.subrole_ids:
                        effective_subroles = list(dict.fromkeys(role_info.subrole_ids))
                    else:
                        effective_subroles = role_subroles
                    cpp_subroles = [self._subrole_mapper.to_int(subrole_id) for subrole_id in effective_subroles]
                else:
                    cpp_subroles = []

                cpp_roles.append((role_int_id, role_info.rating, role_info.priority, cpp_subroles))
            cpp_players.append(_core.create_player(member_int_id, cpp_roles))
        return cpp_players

    def _convert_results(
        self, cpp_solutions: list, member_mapper: UUIDMapper
    ) -> list[DraftSolution]:
        solutions = []
        for cpp_sol in cpp_solutions:
            teams = []
            for cpp_team in cpp_sol.teams:
                team_players = []
                for cpp_player in cpp_team.players:
                    team_players.append(
                        AssignedPlayer(
                            member_id=member_mapper.to_uuid(cpp_player.member_id),
                            role_id=self._role_mapper.to_uuid(cpp_player.role_id),
                            rating=cpp_player.rating,
                            priority=cpp_player.priority,
                        )
                    )
                teams.append(
                    Team(
                        team_id=cpp_team.team_id,
                        players=team_players,
                        total_rating=cpp_team.total_rating,
                    )
                )
            solutions.append(
                DraftSolution(
                    solution_id=cpp_sol.solution_id,
                    fitness_balance=cpp_sol.fitness_balance,
                    fitness_priority=cpp_sol.fitness_priority,
                    fitness_role_imbalance=cpp_sol.fitness_role_imbalance,
                    fitness_subrole=cpp_sol.fitness_subrole,
                    fitness_intra_team_std=cpp_sol.fitness_intra_team_std,
                    teams=teams,
                )
            )
        return solutions

    def _convert_progress_snapshot(self, cpp_snapshot: _core.ProgressSnapshot) -> ProgressSnapshot:
        def convert_metric(metric: _core.MetricSummary) -> MetricSummary:
            return MetricSummary(
                min_value=metric.min_value,
                avg_value=metric.avg_value,
                max_value=metric.max_value,
            )

        return ProgressSnapshot(
            generation=cpp_snapshot.generation,
            total_generations=cpp_snapshot.total_generations,
            pareto_front_size=cpp_snapshot.pareto_front_size,
            fitness_balance=convert_metric(cpp_snapshot.fitness_balance),
            fitness_priority=convert_metric(cpp_snapshot.fitness_priority),
            fitness_role_imbalance=convert_metric(cpp_snapshot.fitness_role_imbalance),
            fitness_subrole=convert_metric(cpp_snapshot.fitness_subrole),
            fitness_intra_team_std=convert_metric(cpp_snapshot.fitness_intra_team_std),
        )

    def run(
        self,
        progress_callback: Callable[[ProgressSnapshot], None] | None = None,
        progress_every: int = 10,
    ) -> list[DraftSolution]:
        member_mapper = UUIDMapper()
        cpp_players = self._convert_players(self.request.players, member_mapper)

        cpp_progress_callback = None
        if progress_callback is not None:
            def cpp_progress_callback(cpp_snapshot: _core.ProgressSnapshot) -> None:
                progress_callback(self._convert_progress_snapshot(cpp_snapshot))

        cpp_solutions = self._cpp_engine.run(
            cpp_players,
            progress_callback=cpp_progress_callback,
            progress_every=progress_every,
        )
        return self._convert_results(cpp_solutions, member_mapper)


def balance_teams_nsga(
    request: BalanceRequest,
    progress_callback: Callable[[ProgressSnapshot], None] | None = None,
    progress_every: int = 10,
) -> list[DraftSolution]:
    balancer = NSGA2Balancer(request)
    return balancer.run(
        progress_callback=progress_callback,
        progress_every=progress_every,
    )


__all__ = [
    "NSGA2Balancer",
    "UUIDMapper",
    "balance_teams_nsga",
]
