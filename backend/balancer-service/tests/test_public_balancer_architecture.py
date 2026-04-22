from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")
os.environ["DEBUG"] = "false"

from src.application.balancer.player_loader import load_players_from_dict  # noqa: E402
from src.application.balancer.public_use_cases import (  # noqa: E402
    CreateBalanceJob,
    ExecuteBalanceJob,
    GetBalancerConfig,
)
from src.application.balancer.runtime_service import balance_teams_moo  # noqa: E402
from src.core.config import AlgorithmConfig  # noqa: E402
from src.core.job_store import BalancerJobStore  # noqa: E402
from src.domain.balancer.balance_solver_factory import BalanceSolverFactory  # noqa: E402
from src.domain.balancer.captain_assignment_service import CaptainAssignmentService  # noqa: E402
from src.domain.balancer.config_provider import get_balancer_config_payload  # noqa: E402
from src.domain.balancer.entities import Player  # noqa: E402
from src.domain.balancer.moo_backend import _serialize_native_request, run_moo_optimizer  # noqa: E402
from src.domain.balancer.mutation_engine import MutationEngine  # noqa: E402
from src.domain.balancer.pareto_evaluator import ParetoEvaluator, calculate_objectives  # noqa: E402
from src.domain.balancer.population_seeder import PopulationSeeder, create_random_solution  # noqa: E402
from src.domain.balancer.role_assignment_service import RoleAssignmentService  # noqa: E402
from src.domain.balancer.team_cost_evaluator import TeamCostEvaluator, calculate_cost  # noqa: E402
from src.infrastructure.parsers.balancer_request_parser import BalancerRequestParser  # noqa: E402
from src.infrastructure.solvers.mixtura_balancer_solver import MixturaBalancerSolver  # noqa: E402
from src.infrastructure.solvers.moo_balance_solver import MooBalanceSolver  # noqa: E402


class GetBalancerConfigTests(TestCase):
    def test_returns_same_payload_as_runtime_config_function(self) -> None:
        use_case = GetBalancerConfig(
            config_provider=SimpleNamespace(get_payload=get_balancer_config_payload),
        )

        payload = use_case.execute()

        self.assertEqual(payload, get_balancer_config_payload())


class CreateBalanceJobTests(IsolatedAsyncioTestCase):
    async def test_creates_job_and_publishes_queue_event(self) -> None:
        created = {}

        class FakeAccessPolicy:
            def ensure_workspace_access(self, user, workspace_id: int) -> None:
                created["user"] = user.id
                created["workspace_id"] = workspace_id

        class FakePayloadParser:
            async def parse_player_data(self, uploaded_file) -> dict:
                return {"players": {"1": {"name": "Player One"}}}

            def parse_config_overrides(self, raw_config: str | None) -> dict | None:
                self.last_raw = raw_config
                return {"algorithm": "moo"}

        class FakeJobRepository:
            async def create_job(self, input_data, config_overrides, *, workspace_id, created_by):
                created["input_data"] = input_data
                created["config_overrides"] = config_overrides
                created["created_by"] = created_by
                return "job-123"

        class FakePublisher:
            async def publish_job_requested(self, job_id: str) -> None:
                created["published_job_id"] = job_id

        use_case = CreateBalanceJob(
            access_policy=FakeAccessPolicy(),
            payload_parser=FakePayloadParser(),
            job_repository=FakeJobRepository(),
            publisher=FakePublisher(),
        )

        response = await use_case.execute(
            uploaded_file=SimpleNamespace(filename="players.json"),
            raw_config='{"algorithm": "moo"}',
            workspace_id=77,
            user=SimpleNamespace(id=9),
        )

        self.assertEqual(response.job_id, "job-123")
        self.assertEqual(response.status, "queued")
        self.assertEqual(created["workspace_id"], 77)
        self.assertEqual(created["created_by"], 9)
        self.assertEqual(created["published_job_id"], "job-123")
        self.assertEqual(created["config_overrides"], {"algorithm": "moo"})


class ExecuteBalanceJobTests(IsolatedAsyncioTestCase):
    async def test_executes_job_with_factory_selected_solver_and_marks_result(self) -> None:
        events: list[tuple[str, str, str]] = []
        marked: dict[str, object] = {}

        class FakeJobRepository:
            async def get_job_payload(self, job_id: str) -> dict:
                return {"player_data": {"players": {}}, "config_overrides": {"algorithm": "moo"}}

            async def get_job_meta(self, job_id: str) -> dict:
                return {"status": "queued"}

            async def mark_running(self, job_id: str) -> None:
                marked["running"] = job_id

            async def append_event(
                self,
                job_id: str,
                *,
                status: str,
                stage: str,
                message: str,
                level: str = "info",
                progress=None,
                update_meta: bool = False,
            ) -> None:
                events.append((status, stage, message))

            async def mark_succeeded(self, job_id: str, result: dict) -> None:
                marked["succeeded"] = (job_id, result)

            async def mark_failed(self, job_id: str, error_message: str) -> None:
                marked["failed"] = (job_id, error_message)

        class FakeSolver:
            async def solve(self, input_data: dict, config_overrides: dict, progress_callback) -> dict:
                progress_callback({"status": "running", "stage": "optimizing", "message": "Working"})
                return {
                    "variants": [
                        {
                            "teams": [],
                            "statistics": {
                                "average_mmr": 0,
                                "mmr_std_dev": 0,
                                "total_teams": 0,
                                "players_per_team": 5,
                            },
                            "benched_players": [],
                        }
                    ]
                }

        class FakeSolverFactory:
            def get_solver(self, algorithm: str):
                self.last_algorithm = algorithm
                return FakeSolver()

        use_case = ExecuteBalanceJob(
            job_repository=FakeJobRepository(),
            solver_factory=FakeSolverFactory(),
        )

        await use_case.execute("job-42")

        self.assertEqual(marked["running"], "job-42")
        self.assertEqual(marked["succeeded"][0], "job-42")
        self.assertEqual(marked["succeeded"][1]["variants"][0]["teams"], [])
        self.assertEqual(marked["succeeded"][1]["variants"][0]["benched_players"], [])
        self.assertIn(("running", "optimizing", "Working"), events)
        self.assertNotIn("failed", marked)

    async def test_ignores_legacy_job_payload_config_key(self) -> None:
        class FakeJobRepository:
            async def get_job_payload(self, job_id: str) -> dict:
                return {"player_data": {"players": {}}, "config": {"algorithm": "cpsat"}}

            async def get_job_meta(self, job_id: str) -> dict:
                return {"status": "queued"}

            async def mark_running(self, job_id: str) -> None:
                return None

            async def append_event(
                self,
                job_id: str,
                *,
                status: str,
                stage: str,
                message: str,
                level: str = "info",
                progress=None,
                update_meta: bool = False,
            ) -> None:
                return None

            async def mark_succeeded(self, job_id: str, result: dict) -> None:
                return None

            async def mark_failed(self, job_id: str, error_message: str) -> None:
                raise AssertionError(error_message)

        class FakeSolver:
            async def solve(self, input_data: dict, config_overrides: dict, progress_callback) -> dict:
                self.last_config_overrides = config_overrides
                return {
                    "variants": [
                        {
                            "teams": [],
                            "statistics": {
                                "average_mmr": 0,
                                "mmr_std_dev": 0,
                                "total_teams": 0,
                                "players_per_team": 5,
                            },
                            "benched_players": [],
                        }
                    ]
                }

        class FakeSolverFactory:
            def __init__(self) -> None:
                self.solver = FakeSolver()
                self.last_algorithm: str | None = None

            def get_solver(self, algorithm: str):
                self.last_algorithm = algorithm
                return self.solver

        solver_factory = FakeSolverFactory()
        use_case = ExecuteBalanceJob(
            job_repository=FakeJobRepository(),
            solver_factory=solver_factory,
        )

        await use_case.execute("job-legacy")

        self.assertEqual(solver_factory.last_algorithm, "moo")
        self.assertEqual(solver_factory.solver.last_config_overrides, {})


class SolverAdapterTests(IsolatedAsyncioTestCase):
    async def test_moo_solver_preserves_runtime_variants_shape(self) -> None:
        solver = MooBalanceSolver()
        variants = [
            {"teams": [{"id": 1}], "statistics": {}, "benched_players": []},
            {"teams": [{"id": 2}], "statistics": {}, "benched_players": []},
        ]

        with patch(
            "src.infrastructure.solvers.moo_balance_solver.asyncio.to_thread",
            AsyncMock(return_value=variants),
        ) as to_thread:
            result = await solver.solve({"players": {}}, {"algorithm": "moo"}, None)

        self.assertEqual(result, {"variants": variants})
        to_thread.assert_awaited_once()

    async def test_mixtura_balancer_solver_delegates_to_gateway(self) -> None:
        gateway = AsyncMock()
        gateway.run.return_value = [{"teams": [], "statistics": {}, "benched_players": []}]
        solver = MixturaBalancerSolver(gateway=gateway)

        result = await solver.solve(
            {"players": {}},
            {"algorithm": "mixtura_balancer", "max_result_variants": 4},
            None,
        )

        self.assertEqual(result, {"variants": [{"teams": [], "statistics": {}, "benched_players": []}]})
        gateway.run.assert_awaited_once()


class MooBackendContractTests(TestCase):
    def test_serializes_current_rust_config_contract(self) -> None:
        config = AlgorithmConfig()
        config.intra_team_std_weight = 1.25
        config.internal_role_spread_weight = 0.75
        config.tank_impact_weight = 1.7
        config.mutation_rate_min = 0.2
        config.island_count = 6
        config.crossover_rate = 0.9

        player = Player(
            name="Player One",
            ratings={"Tank": 2500},
            preferences=["Tank"],
            uuid="player-1",
            mask=config.role_mask,
        )

        payload = json.loads(
            _serialize_native_request(
                players=[player],
                num_teams=1,
                config=config,
                role_assignment={"player-1": "Tank"},
                seed=123,
            )
        )

        config_payload = payload["config"]
        self.assertEqual(config_payload["intra_team_std_weight"], 1.25)
        self.assertEqual(config_payload["internal_role_spread_weight"], 0.75)
        self.assertEqual(config_payload["tank_impact_weight"], 1.7)
        self.assertEqual(config_payload["mutation_rate_min"], 0.2)
        self.assertEqual(config_payload["island_count"], 6)
        self.assertEqual(config_payload["crossover_rate"], 0.9)
        self.assertNotIn("elitism_rate", config_payload)
        self.assertNotIn("stagnation_threshold", config_payload)
        self.assertNotIn("default_convergence_patience", config_payload)


class MooBackendRuntimeTests(TestCase):
    def setUp(self) -> None:
        self.config = AlgorithmConfig(
            role_mask={"Tank": 1},
            population_size=10,
            generation_count=10,
            mutation_strength=1,
            max_result_variants=1,
            use_captains=False,
        )
        self.player = Player(
            name="Player One",
            ratings={"Tank": 2500},
            preferences=["Tank"],
            uuid="player-1",
            mask=self.config.role_mask,
        )
        self.role_assignment = {"player-1": "Tank"}

    def test_requires_native_module_even_when_legacy_python_backend_is_requested(self) -> None:
        with patch.dict(os.environ, {"BALANCER_MOO_BACKEND": "python"}, clear=False):
            with patch("src.domain.balancer.moo_backend.platform.system", return_value="Linux"):
                with patch("src.domain.balancer.moo_backend._load_native_module", return_value=None):
                    with self.assertRaisesRegex(RuntimeError, "moo_core"):
                        run_moo_optimizer(
                            [self.player],
                            1,
                            self.config,
                            None,
                            role_assignment=self.role_assignment,
                            seed=123,
                        )

    def test_propagates_rust_backend_failures_without_python_fallback(self) -> None:
        broken_native = SimpleNamespace(
            run_moo_optimizer=lambda _: (_ for _ in ()).throw(ValueError("native exploded"))
        )

        with patch("src.domain.balancer.moo_backend.platform.system", return_value="Linux"):
            with patch("src.domain.balancer.moo_backend._load_native_module", return_value=broken_native):
                with self.assertRaisesRegex(ValueError, "native exploded"):
                    run_moo_optimizer(
                        [self.player],
                        1,
                        self.config,
                        None,
                        role_assignment=self.role_assignment,
                        seed=123,
                    )


class BalancerRequestParserTests(TestCase):
    def test_rejects_nested_legacy_config_wrapper(self) -> None:
        parser = BalancerRequestParser()

        with self.assertRaises(ValueError):
            parser.parse_config_overrides('{"config_overrides": {"algorithm": "moo"}}')

    def test_ignores_legacy_input_role_mapping_override(self) -> None:
        parser = BalancerRequestParser()

        payload = parser.parse_config_overrides(
            '{"algorithm": "moo", "input_role_mapping": {"tank": "Tank"}}'
        )

        self.assertEqual(payload, {"algorithm": "moo"})


class PlayerLoaderTests(TestCase):
    def test_accepts_standard_role_aliases_without_explicit_mapping(self) -> None:
        players = load_players_from_dict(
            {
                "players": {
                    "player-1": {
                        "identity": {
                            "name": "Player One",
                            "isFullFlex": False,
                        },
                        "stats": {
                            "classes": {
                                "tank": {"isActive": True, "rank": 2500, "priority": 0},
                                "damage": {"isActive": True, "rank": 2400, "priority": 1},
                                "support": {"isActive": True, "rank": 2300, "priority": 2},
                            }
                        },
                    }
                }
            },
            {"Tank": 1, "Damage": 2, "Support": 2},
        )

        self.assertEqual(len(players), 1)
        self.assertEqual(players[0].ratings, {"Tank": 2500, "Damage": 2400, "Support": 2300})
        self.assertEqual(players[0].preferences, ["Tank", "Damage", "Support"])

    def test_builds_stable_preferences_when_role_priorities_tie(self) -> None:
        players = load_players_from_dict(
            {
                "players": {
                    "player-1": {
                        "identity": {
                            "name": "Player One",
                            "isFullFlex": False,
                        },
                        "stats": {
                            "classes": {
                                "support": {"isActive": True, "rank": 2300, "priority": 0},
                                "tank": {"isActive": True, "rank": 2500, "priority": 0},
                                "damage": {"isActive": True, "rank": 2400, "priority": 0},
                            }
                        },
                    }
                }
            },
            {"Tank": 1, "Damage": 2, "Support": 2},
        )

        self.assertEqual(len(players), 1)
        self.assertEqual(players[0].preferences, ["Damage", "Support", "Tank"])


class BalancerJobStoreTests(IsolatedAsyncioTestCase):
    async def test_persists_canonical_payload_keys_only(self) -> None:
        class FakePipeline:
            def __init__(self, redis_client) -> None:
                self._redis = redis_client
                self._operations: list[tuple[str, tuple[object, ...]]] = []

            def set(self, key, value, ex=None):
                self._operations.append(("set", (key, value, ex)))
                return self

            def expire(self, key, ttl):
                self._operations.append(("expire", (key, ttl)))
                return self

            async def execute(self):
                for operation, args in self._operations:
                    if operation == "set":
                        await self._redis.set(*args)
                    elif operation == "expire":
                        await self._redis.expire(*args)
                self._operations.clear()

        class FakeRedis:
            def __init__(self) -> None:
                self.values: dict[str, object] = {}

            def pipeline(self):
                return FakePipeline(self)

            async def set(self, key, value, ex=None):
                self.values[key] = value

            async def get(self, key):
                return self.values.get(key)

            async def incr(self, key):
                next_value = int(self.values.get(key, 0)) + 1
                self.values[key] = next_value
                return next_value

            async def rpush(self, key, value):
                self.values.setdefault(key, [])
                self.values[key].append(value)

            async def llen(self, key):
                return len(self.values.get(key, []))

            async def expire(self, key, ttl):
                return True

        store = BalancerJobStore.__new__(BalancerJobStore)
        store._redis = FakeRedis()
        store._ttl_seconds = 3600

        job_id = await store.create_job(
            {"players": {}},
            {"algorithm": "moo"},
            workspace_id=10,
            created_by=20,
        )

        payload = await store.get_job_payload(job_id)

        self.assertEqual(payload, {"player_data": {"players": {}}, "config_overrides": {"algorithm": "moo"}})


class SolverDomainServiceTests(TestCase):
    def setUp(self) -> None:
        self.mask = {"tank": 1, "dps": 1}
        self.players = [
            Player(
                name="Tank Main",
                ratings={"tank": 2800},
                preferences=["tank"],
                uuid="tank-main",
                mask=self.mask,
            ),
            Player(
                name="Flex Carry",
                ratings={"tank": 2500, "dps": 2700},
                preferences=["dps", "tank"],
                uuid="flex-carry",
                mask=self.mask,
                is_flex=True,
            ),
        ]

    def test_captain_assignment_service_marks_requested_count(self) -> None:
        service = CaptainAssignmentService()

        service.assign(self.players, captain_count=1, mask=self.mask)

        self.assertEqual(sum(1 for player in self.players if player.is_captain), 1)

    def test_role_assignment_service_matches_existing_feasibility_rules(self) -> None:
        service = RoleAssignmentService()

        role_assignment = service.find_feasible_assignment(self.players, num_teams=1, mask=self.mask)

        self.assertEqual(role_assignment, {"tank-main": "tank", "flex-carry": "dps"})

    def test_team_cost_evaluator_delegates_to_existing_formula(self) -> None:
        solution = create_random_solution(
            self.players,
            num_teams=1,
            mask=self.mask,
            use_captains=False,
            role_assignment={"tank-main": "tank", "flex-carry": "dps"},
        )
        evaluator = TeamCostEvaluator()
        config = SimpleNamespace(
            role_mask=self.mask,
            team_total_balance_weight=1.0,
            max_team_gap_weight=1.0,
            average_mmr_balance_weight=1.0,
            role_discomfort_weight=1.0,
            intra_team_variance_weight=1.0,
            max_role_discomfort_weight=1.0,
            role_line_balance_weight=1.0,
            role_spread_weight=1.0,
            sub_role_collision_weight=1.0,
        )

        self.assertEqual(evaluator.calculate(solution, config), calculate_cost(solution, config))

    def test_pareto_evaluator_delegates_to_existing_objective_formula(self) -> None:
        solution = create_random_solution(
            self.players,
            num_teams=1,
            mask=self.mask,
            use_captains=False,
            role_assignment={"tank-main": "tank", "flex-carry": "dps"},
        )
        evaluator = ParetoEvaluator()
        config = SimpleNamespace(
            role_mask=self.mask,
            team_total_balance_weight=1.0,
            max_team_gap_weight=1.0,
            average_mmr_balance_weight=1.0,
            role_discomfort_weight=1.0,
            max_role_discomfort_weight=1.0,
            role_line_balance_weight=1.0,
            sub_role_collision_weight=1.0,
        )

        self.assertEqual(evaluator.calculate(solution, config), calculate_objectives(solution, config))

    def test_population_seeder_creates_complete_solution(self) -> None:
        seeder = PopulationSeeder()

        solution = seeder.seed(
            players=self.players,
            num_teams=1,
            mask=self.mask,
            use_captains=False,
            role_assignment={"tank-main": "tank", "flex-carry": "dps"},
        )

        self.assertTrue(all(team.is_full() for team in solution))

    def test_mutation_engine_returns_team_list(self) -> None:
        solution = create_random_solution(
            self.players,
            num_teams=1,
            mask=self.mask,
            use_captains=False,
            role_assignment={"tank-main": "tank", "flex-carry": "dps"},
        )
        engine = MutationEngine()
        config = SimpleNamespace(
            role_mask=self.mask,
            mutation_strength=1,
            use_captains=False,
        )

        mutated = engine.mutate(
            teams=solution,
            mask=self.mask,
            mutation_strength=1,
            config=config,
            use_captains=False,
        )

        self.assertEqual(len(mutated), len(solution))

    def test_solver_factory_returns_requested_solver(self) -> None:
        moo_solver = object()
        cpsat_solver = object()
        mixtura_balancer_solver = object()
        factory = BalanceSolverFactory(
            moo_solver=moo_solver,
            cpsat_solver=cpsat_solver,
            mixtura_balancer_solver=mixtura_balancer_solver,
        )

        self.assertIs(factory.get_solver("moo"), moo_solver)
        self.assertIs(factory.get_solver("cpsat"), cpsat_solver)
        self.assertIs(factory.get_solver("mixtura_balancer"), mixtura_balancer_solver)

        with self.assertRaises(ValueError):
            factory.get_solver("unknown")


class MooDeterminismTests(TestCase):
    def test_balance_teams_moo_returns_same_best_variant_for_same_input(self) -> None:
        input_data = {
            "players": {
                f"player-{index}": {
                    "identity": {
                        "name": f"Player {index}",
                        "isFullFlex": False,
                    },
                    "stats": {
                        "classes": {
                            "tank": {
                                "isActive": True,
                                "rank": 2500,
                                "priority": 0,
                            }
                        }
                    },
                }
                for index in range(1, 7)
            }
        }
        config_overrides = {
            "algorithm": "moo",
            "role_mask": {"Tank": 1},
            "population_size": 10,
            "generation_count": 10,
            "mutation_strength": 1,
            "max_result_variants": 1,
            "use_captains": False,
        }

        observed_seeds: list[int] = []

        def fake_run_moo_optimizer(request_payload: str) -> str:
            payload = json.loads(request_payload)
            observed_seeds.append(payload["seed"])
            role_names = sorted(payload["mask"].keys())
            players = sorted(payload["players"], key=lambda entry: entry["uuid"])
            teams = []
            for index, player in enumerate(players, start=1):
                role = player["seed_role"] or role_names[0]
                teams.append(
                    {
                        "id": index,
                        "roster": {role: [player["uuid"]]},
                    }
                )
            return json.dumps({"variants": [{"teams": teams}]})

        native_module = SimpleNamespace(run_moo_optimizer=fake_run_moo_optimizer)

        with patch("src.domain.balancer.moo_backend.platform.system", return_value="Linux"):
            with patch("src.domain.balancer.moo_backend._load_native_module", return_value=native_module):
                runs = [
                    balance_teams_moo(input_data, config_overrides)[0]["teams"]
                    for _ in range(3)
                ]

        self.assertEqual(runs[0], runs[1])
        self.assertEqual(runs[1], runs[2])
        self.assertEqual(observed_seeds[0], observed_seeds[1])
        self.assertEqual(observed_seeds[1], observed_seeds[2])

    def test_balance_teams_moo_ignores_input_player_order(self) -> None:
        def make_input(order: list[int]) -> dict[str, dict[str, dict[str, object]]]:
            return {
                "players": {
                    f"player-{index}": {
                        "identity": {
                            "name": f"Player {index}",
                            "isFullFlex": False,
                        },
                        "stats": {
                            "classes": {
                                "tank": {
                                    "isActive": True,
                                    "rank": 2500 + index,
                                    "priority": 0,
                                }
                            }
                        },
                    }
                    for index in order
                }
            }

        config_overrides = {
            "algorithm": "moo",
            "role_mask": {"Tank": 1},
            "population_size": 10,
            "generation_count": 10,
            "mutation_strength": 1,
            "max_result_variants": 1,
            "use_captains": False,
        }

        observed_player_orders: list[list[str]] = []

        def fake_run_moo_optimizer(request_payload: str) -> str:
            payload = json.loads(request_payload)
            observed_player_orders.append([player["uuid"] for player in payload["players"]])
            role_name = sorted(payload["mask"].keys())[0]
            teams = [
                {
                    "id": index,
                    "roster": {role_name: [player["uuid"]]},
                }
                for index, player in enumerate(payload["players"], start=1)
            ]
            return json.dumps({"variants": [{"teams": teams}]})

        native_module = SimpleNamespace(run_moo_optimizer=fake_run_moo_optimizer)

        with patch("src.domain.balancer.moo_backend.platform.system", return_value="Linux"):
            with patch("src.domain.balancer.moo_backend._load_native_module", return_value=native_module):
                ordered_run = balance_teams_moo(make_input([1, 2, 3, 4, 5, 6]), config_overrides)[0]["teams"]
                reversed_run = balance_teams_moo(make_input([6, 5, 4, 3, 2, 1]), config_overrides)[0]["teams"]

        self.assertEqual(ordered_run, reversed_run)
        self.assertEqual(observed_player_orders[0], observed_player_orders[1])
        self.assertEqual(
            observed_player_orders[0],
            [f"player-{index}" for index in range(1, 7)],
        )
