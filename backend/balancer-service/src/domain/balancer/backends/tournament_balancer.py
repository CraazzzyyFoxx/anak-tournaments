from __future__ import annotations

from src.domain.balancer.backends.base import BalanceMetrics, BalanceSolution
from src.domain.balancer.config.defaults import AlgorithmConfig
from src.domain.balancer.entities import Player
from src.domain.balancer.moo_backend import run_moo_optimizer
from src.domain.balancer.progress import ProgressCallback


class TournamentBalancerBackend:
    """Adapter over the in-house Rust NSGA-II optimizer (``moo_backend.py``,
    ``balancer_native.run_moo_optimizer``) -- the default, N-team-capable algorithm used
    for tournament balancing (and anything else not pinned to ``mix_balancer``).

    Wraps each ``(teams, metrics dict)`` pair ``moo_backend`` returns into a
    typed ``BalanceSolution``.
    """

    name = "tournament_balancer"
    max_teams = None

    def solve(
        self,
        players: list[Player],
        num_teams: int,
        config: AlgorithmConfig,
        role_assignment: dict[str, str] | None,
        seed: int,
        progress_callback: ProgressCallback | None,
    ) -> list[BalanceSolution]:
        pareto_front = run_moo_optimizer(
            players,
            num_teams,
            config,
            progress_callback,
            role_assignment=role_assignment,
            seed=seed,
        )
        return [
            BalanceSolution(
                teams=teams,
                metrics=BalanceMetrics(
                    balance_objective=metrics.get("balance_objective"),
                    comfort_objective=metrics.get("comfort_objective"),
                    balance_objective_norm=metrics.get("balance_objective_norm"),
                    comfort_objective_norm=metrics.get("comfort_objective_norm"),
                    composite_score=metrics.get("composite_score"),
                ),
            )
            for teams, metrics in pareto_front
        ]


__all__ = ["TournamentBalancerBackend"]
