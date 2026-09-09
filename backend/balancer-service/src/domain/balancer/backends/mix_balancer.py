from __future__ import annotations

import platform
import uuid

from loguru import logger

from src.domain.balancer.backends.base import BalanceMetrics, BalanceSolution
from src.domain.balancer.entities import Player, Team
from src.domain.balancer.progress import ProgressCallback
from src.services.balancer.config.defaults import AlgorithmConfig

# Fixed, arbitrary namespaces for deriving stable UUIDs from this domain's
# plain string role codes and player uuids. The vendored engine's library API
# is UUID-keyed (see mix_balancer.models.PlayerRoleInfo/PlayerInfo); uuid5
# gives a deterministic, collision-free mapping without touching the DB
# schema or requiring a persisted role-id table.
_ROLE_NAMESPACE = uuid.UUID("cd85133f-23eb-46b4-a4e3-a30bb16caccc")
_MEMBER_NAMESPACE = uuid.UUID("e0f084cf-e0a7-41fe-95ee-0334b635c9c4")

# The vendored engine's own documented priority ceiling
# (mix_balancer.models.PlayerRoleInfo: "priority: int  # 1-3, higher = more preferred").
_MAX_PRIORITY = 3

# The vendored engine's own library default (mix_balancer.models.BalanceSettings.balance_limit).
# Not yet exposed as a tunable knob: this backend is wired only into the
# mix/custom-game flow (see services/balancer/solver.run_mix_balance), not the
# tournament-wide public config surface -- see the "narrow scope" decision in
# domain/balancer/backends/base.py's module docstring context.
_DEFAULT_BALANCE_LIMIT = 1000.0


def _load_library():
    try:
        import mix_balancer as engine_lib
    except ImportError as exc:
        # Walk the chain: mix_balancer/__init__.py wraps the real underlying
        # ImportError (missing .so, undefined symbol, ABI mismatch, ...) in
        # its own ImportError with a diagnostic hint -- don't discard that by
        # only reporting this wrapper's generic message.
        detail = str(exc)
        cause = exc.__cause__
        if cause is not None and str(cause) not in detail:
            detail = f"{detail} (caused by: {cause})"
        raise RuntimeError(
            "mix_balancer requires the 'mix-balancer' package "
            "(vendored under balancer-service/native/mix_balancer, originally "
            "mixtura-dev/mixtura-balancer); it is a Linux-only dependency built "
            f"during 'uv sync'. Underlying error: {detail}"
        ) from exc
    return engine_lib


def role_uuid(role: str) -> uuid.UUID:
    """Deterministic role code -> UUID, stable across processes/versions."""
    return uuid.uuid5(_ROLE_NAMESPACE, role)


def member_uuid(player_uuid: str) -> uuid.UUID:
    """Deterministic player uuid (arbitrary string) -> UUID."""
    return uuid.uuid5(_MEMBER_NAMESPACE, player_uuid)


def priority_for_role(player: Player, role: str, max_priority: int = _MAX_PRIORITY) -> int:
    """1..max_priority, higher = more preferred (the engine's documented range).

    A flex player is equally happy in any role they can play, so every
    playable role gets top priority. Everyone else is ranked by their own
    preference order (index 0 = most preferred, floored at priority 1 once
    the preference list runs deeper than ``max_priority``).
    """
    if player.is_flex:
        return max_priority
    if role in player.preferences:
        return max(1, max_priority - player.preferences.index(role))
    return 1


def build_metrics(quality) -> BalanceMetrics:
    """``mix_balancer`` ``QualityMetrics`` -> this domain's typed metrics.

    Prefixed fields so they never collide with ``tournament_balancer``'s own
    (``balance_objective``, ``comfort_objective``, ...) on the shared
    ``BalanceMetrics`` dataclass.
    """
    return BalanceMetrics(
        mix_balancer_fairness=float(quality.fairness),
        mix_balancer_uniformity=float(quality.uniformity),
        mix_balancer_role_fairness=float(quality.role_fairness),
        mix_balancer_role_points=float(quality.role_points),
        mix_balancer_quality_total=float(quality.total),
    )


class MixBalancerBackend:
    """Adapter over the vendored brute-force two-team engine (originally
    mixtura-dev/mixtura-balancer, see native/mix_balancer) -- pinned only to
    the mix/custom-game flow (see services/balancer/solver.run_mix_balance).

    Exhaustively enumerates every player/role split and returns the true
    optimum (not a GA approximation), but the search is only tractable, and
    only implemented, for exactly two equal-size teams -- see ``solve``'s
    guard. The engine is deterministic by construction (no RNG), so ``seed``
    and ``role_assignment`` (both ``tournament_balancer``-specific hints) are
    accepted for ``OptimizerBackend`` parity but unused.
    """

    name = "mix_balancer"
    max_teams = 2

    def solve(
        self,
        players: list[Player],
        num_teams: int,
        config: AlgorithmConfig,
        role_assignment: dict[str, str] | None,
        seed: int,
        progress_callback: ProgressCallback | None,
    ) -> list[BalanceSolution]:
        if platform.system() != "Linux":
            raise RuntimeError("mix_balancer backend is supported only on Linux")
        if num_teams != 2:
            raise ValueError(
                f"mix_balancer backend only supports exactly 2 teams (got {num_teams} from "
                f"{len(players)} players); use the tournament_balancer algorithm for "
                "tournaments or mixes that span more than two teams."
            )

        engine_lib = _load_library()
        mask = config.role_mask
        active_roles = [role for role, count in mask.items() if count > 0]
        team_size = sum(mask[role] for role in active_roles)

        role_by_uuid = {role_uuid(role): role for role in active_roles}
        role_constraints = {
            uid: engine_lib.RoleConstraint(min_in_team=mask[role], max_in_team=mask[role])
            for uid, role in role_by_uuid.items()
        }

        member_by_uuid: dict[uuid.UUID, Player] = {}
        cpp_players = []
        for player in players:
            member_id = member_uuid(player.uuid)
            member_by_uuid[member_id] = player
            roles = [
                engine_lib.PlayerRoleInfo(
                    role_id=role_uuid(role),
                    rating=rating,
                    priority=priority_for_role(player, role),
                )
                for role, rating in player.ratings.items()
                if role in mask and mask[role] > 0
            ]
            cpp_players.append(engine_lib.PlayerInfo(member_id=member_id, roles=roles, is_flex=player.is_flex))

        logger.info("Running mix_balancer brute-force engine for a 2-team split")
        response = engine_lib.BalanceEngine.quick_find(
            cpp_players,
            list(role_by_uuid.keys()),
            role_constraints,
            team_size,
            _DEFAULT_BALANCE_LIMIT,
            engine_lib.QualitySettings(max_priority=_MAX_PRIORITY),
            max_results=config.max_result_variants,
        )

        if not response.ok:
            raise ValueError(f"mix_balancer search failed: {response.status}")
        if not response.balances:
            raise ValueError("mix_balancer search returned no results within the balance limit")

        solutions: list[BalanceSolution] = []
        for result in response.balances:
            teams: list[Team] = []
            for team_index, cpp_team in enumerate(result.teams, start=1):
                team = Team(team_index, mask)
                for cpp_player in cpp_team.players:
                    player = member_by_uuid[cpp_player.member_id]
                    role = role_by_uuid[cpp_player.game_role_id]
                    team.add_player(role, player)
                teams.append(team)
            solutions.append(BalanceSolution(teams=teams, metrics=build_metrics(result.quality)))
        return solutions


__all__ = ["MixBalancerBackend", "build_metrics", "member_uuid", "priority_for_role", "role_uuid"]
