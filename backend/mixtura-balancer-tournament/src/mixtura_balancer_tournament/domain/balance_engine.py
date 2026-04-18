import asyncio
import datetime
import logging
from collections.abc import Awaitable, Callable
from uuid import uuid4

from nsga_balancer.models import (
    BalanceRequest as NSGABalanceRequest,
)
from nsga_balancer.models import (
    BalanceSettings as NSGABalanceSettings,
)
from nsga_balancer.models import (
    MathSettings as NSGAMathSettings,
)
from nsga_balancer.models import (
    Player as NSGAPlayer,
)
from nsga_balancer.models import (
    PlayerRole as NSGAPlayerRole,
)
from nsga_balancer.models import ProgressSnapshot as NSGAProgressSnapshot
from nsga_balancer.models import QualitySettings
from nsga_balancer.models import (
    RoleSettings as NSGARoleSettings,
)
from nsga_balancer.models import (
    SubroleSettings as NSGASubroleSettings,
)

from nsga_balancer import balance_teams_nsga, evaluate_solutions

from .models.balance import (
    Balance,
    BalanceProgress,
    DraftBalances,
    ProgressMetricSummary,
    QualityMetrics,
    Team,
    TeamPlayer,
)
from .models.balance_request import BalanceRequest, MathSettings

logger = logging.getLogger(__name__)


class AsyncBalanceEngine:
    def __init__(self):
        self._initialized = False

    async def find_balances_async(
        self,
        balance_request: BalanceRequest,
        progress_callback: Callable[[BalanceProgress], Awaitable[None]] | None = None,
        progress_every: int = 10,
    ) -> DraftBalances:
        logger.info(
            f"Processing balance request for draft_id={balance_request.draft_id} "
            f"with {len(balance_request.players)} players"
        )

        nsga_request = self._convert_request(balance_request)

        loop = asyncio.get_running_loop()
        nsga_progress_callback = self._create_progress_callback(
            balance_request.draft_id,
            loop,
            progress_callback,
        )
        solutions = await loop.run_in_executor(
            None,
            lambda: balance_teams_nsga(
                nsga_request,
                progress_callback=nsga_progress_callback,
                progress_every=progress_every,
            ),
        )

        role_ids = list(balance_request.balance_settings.roles.keys())
        role_counts = {
            k: v.count_in_team
            for k, v in balance_request.balance_settings.roles.items()
        }
        quality_settings = self._convert_quality_settings(
            balance_request.balance_settings.math
        )

        solutions = evaluate_solutions(
            solutions, role_ids, role_counts, quality_settings
        )

        balances = []
        for sol in solutions:
            teams = []
            for cpp_team in sol.teams:
                players = []
                for cpp_player in cpp_team.players:
                    players.append(
                        TeamPlayer(
                            member_id=cpp_player.member_id,
                            game_role_id=cpp_player.role_id,
                            rating=cpp_player.rating,
                            priority=cpp_player.priority,
                        )
                    )
                teams.append(
                    Team(
                        id=uuid4(),
                        players=players,
                        total_rating=cpp_team.total_rating,
                    )
                )

            quality = QualityMetrics(
                dp_fairness=sol.quality.dp_fairness if sol.quality else 0.0,
                dp_role_fairness=sol.quality.dp_role_fairness if sol.quality else 0.0,
                vq_uniformity=sol.quality.vq_uniformity if sol.quality else 0.0,
                role_priority_points=sol.quality.role_priority_points
                if sol.quality
                else 0.0,
                fitness_balance=sol.fitness_balance if sol.quality else 0.0,
                fitness_priority=sol.fitness_priority if sol.quality else 0.0,
                fitness_role_imbalance=sol.fitness_role_imbalance
                if sol.quality
                else 0.0,
                fitness_subrole=sol.fitness_subrole
                if sol.quality
                else 0.0,
                fitness_intra_team_std=sol.fitness_intra_team_std
                if sol.quality
                else 0.0,
                role_subrole_penalty=sol.quality.role_subrole_penalty
                if sol.quality
                else 0.0,
                evaluation=sol.evaluation,
            )

            balances.append(
                Balance(
                    id=uuid4(),
                    quality=quality,
                    teams=teams,
                )
            )

        logger.info(f"Generated {len(balances)} balance solutions")

        return DraftBalances(
            draft_id=balance_request.draft_id,
            balances=balances,
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )

    def _convert_progress_snapshot(
        self,
        draft_id,
        snapshot: NSGAProgressSnapshot,
    ) -> BalanceProgress:
        def convert_metric(metric) -> ProgressMetricSummary:
            return ProgressMetricSummary(
                min_value=metric.min_value,
                avg_value=metric.avg_value,
                max_value=metric.max_value,
            )

        return BalanceProgress(
            draft_id=draft_id,
            processed_generations=snapshot.generation,
            total_generations=snapshot.total_generations,
            pareto_front_size=snapshot.pareto_front_size,
            fitness_balance=convert_metric(snapshot.fitness_balance),
            fitness_priority=convert_metric(snapshot.fitness_priority),
            fitness_role_imbalance=convert_metric(snapshot.fitness_role_imbalance),
            fitness_subrole=convert_metric(snapshot.fitness_subrole),
            fitness_intra_team_std=convert_metric(snapshot.fitness_intra_team_std),
        )

    def _create_progress_callback(
        self,
        draft_id,
        loop: asyncio.AbstractEventLoop,
        progress_callback: Callable[[BalanceProgress], Awaitable[None]] | None,
    ) -> Callable[[NSGAProgressSnapshot], None] | None:
        if progress_callback is None:
            return None

        def report_progress(snapshot: NSGAProgressSnapshot) -> None:
            progress = self._convert_progress_snapshot(draft_id, snapshot)
            future = asyncio.run_coroutine_threadsafe(progress_callback(progress), loop)

            def log_publish_error(done_future) -> None:
                exc = done_future.exception()
                if exc is not None:
                    logger.exception("Failed to publish balance progress", exc_info=exc)

            future.add_done_callback(log_publish_error)

        return report_progress

    def _convert_request(self, request: BalanceRequest) -> NSGABalanceRequest:
        role_subrole_ids = {
            role_id: list(settings.subroles.keys())
            for role_id, settings in request.balance_settings.roles.items()
        }

        players = []
        for p in request.players:
            roles = {}
            for role_id, role_info in p.roles.items():
                role_subroles = role_subrole_ids.get(role_id, [])
                if role_subroles and not role_info.subrole_ids:
                    effective_subroles = role_subroles
                else:
                    effective_subroles = role_info.subrole_ids

                roles[role_id] = NSGAPlayerRole(
                    priority=role_info.priority,
                    rating=role_info.rating,
                    subrole_ids=effective_subroles,
                )

            players.append(NSGAPlayer(member_id=p.member_id, roles=roles))

        roles_settings = {
            role_id: NSGARoleSettings(
                count_in_team=settings.count_in_team,
                subroles={
                    subrole_id: NSGASubroleSettings(capacity=subrole_settings.capacity)
                    for subrole_id, subrole_settings in settings.subroles.items()
                },
            )
            for role_id, settings in request.balance_settings.roles.items()
        }

        math_settings = NSGAMathSettings(
            population_size=request.balance_settings.math.population_size,
            generations=request.balance_settings.math.generations,
            num_pareto_solutions=request.balance_settings.math.num_pareto_solutions,
            weight_team_variance=request.balance_settings.math.weight_team_variance,
            role_imbalance_blend=request.balance_settings.math.role_imbalance_blend,
            subrole_blend=request.balance_settings.math.subrole_blend,
            intra_team_std_blend=request.balance_settings.math.intra_team_std_blend,
            penalty_invalid_role=request.balance_settings.math.penalty_invalid_role,
            penalty_prio_1=request.balance_settings.math.penalty_prio_1,
            penalty_prio_2=request.balance_settings.math.penalty_prio_2,
            penalty_prio_3=request.balance_settings.math.penalty_prio_3,
        )

        balance_settings = NSGABalanceSettings(
            players_in_team=request.balance_settings.players_in_team,
            roles=roles_settings,
            math=math_settings,
        )

        return NSGABalanceRequest(
            draft_id=request.draft_id,
            players=players,
            balance_settings=balance_settings,
        )

    def _convert_quality_settings(self, math_settings: MathSettings) -> QualitySettings:
        return QualitySettings(
            fairness_coef=math_settings.fairness_coef,
            role_fairness_coef=math_settings.role_fairness_coef,
            role_priority_coef=math_settings.role_priority_coef,
            subrole_penalty_coef=math_settings.subrole_penalty_coef,
            role_priority_imbalance_coef=math_settings.role_priority_imbalance_coef,
            fairness_power_coef=math_settings.fairness_power_coef,
            uniformity_power_coef=math_settings.uniformity_power_coef,
            role_priority_imbalance_threshold=math_settings.role_priority_imbalance_threshold,
        )


_engine: AsyncBalanceEngine | None = None


def get_engine() -> AsyncBalanceEngine:
    global _engine
    if _engine is None:
        _engine = AsyncBalanceEngine()
    return _engine
