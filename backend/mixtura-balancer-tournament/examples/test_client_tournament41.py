"""
Test client for balancing data from examples/tournament41.json.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import uuid
from pathlib import Path
from typing import Any

from mixtura_balancer_tournament.domain.balance_engine import get_engine
from mixtura_balancer_tournament.domain.models.balance import (
    BalanceProgress,
    DraftBalances,
    ProgressMetricSummary,
)
from mixtura_balancer_tournament.domain.models.balance_request import (
    BalanceRequest,
    BalanceSettings,
    MathSettings,
    Player,
    PlayerRole,
    RoleSettings,
    SubroleSettings,
)

ROLE_NAMES = ("tank", "dps", "support")
ROLE_COUNTS = {"tank": 1, "dps": 2, "support": 2}
UUID_NAMESPACE = uuid.UUID("3fce03d0-d7e0-4c81-9a35-a24b5fb9df1d")
BALANCE_QUEUE = "mix_balance_service.balance"
PROGRESS_QUEUE = "mix_balance_service.balance.progress"


def stable_uuid(name: str) -> uuid.UUID:
    return uuid.uuid5(UUID_NAMESPACE, name)


ROLE_IDS = {role_name: stable_uuid(f"role:{role_name}") for role_name in ROLE_NAMES}
SUBROLE_IDS = {
    role_name: {
        "primary": stable_uuid(f"subrole:{role_name}:primary"),
        "secondary": stable_uuid(f"subrole:{role_name}:secondary"),
    }
    for role_name in ROLE_NAMES
}
ROLE_NAME_BY_ID = {role_id: role_name for role_name, role_id in ROLE_IDS.items()}
SUBROLE_NAME_BY_ID = {
    subrole_id: subrole_name
    for role_subroles in SUBROLE_IDS.values()
    for subrole_name, subrole_id in role_subroles.items()
}


def make_balance_settings(
    population_size: int,
    generations: int,
    num_pareto_solutions: int,
) -> BalanceSettings:
    roles = {}
    for role_name in ROLE_NAMES:
        role_id = ROLE_IDS[role_name]
        roles[role_id] = RoleSettings(
            original_game_role=role_id,
            count_in_team=ROLE_COUNTS[role_name],
            subroles={
                SUBROLE_IDS[role_name]["primary"]: SubroleSettings(capacity=1),
                SUBROLE_IDS[role_name]["secondary"]: SubroleSettings(capacity=1),
            },
        )

    return BalanceSettings(
        players_in_team=sum(ROLE_COUNTS.values()),
        roles=roles,
        math=MathSettings(
            population_size=population_size,
            generations=generations,
            num_pareto_solutions=num_pareto_solutions,
        ),
    )


def map_priority(raw_priority: Any) -> int:
    source_priority = int(raw_priority or 0)
    return max(1, min(3, 3 - source_priority))


def map_subroles(role_name: str, role_data: dict[str, Any]) -> list[uuid.UUID] | None:
    primary = bool(role_data.get("primary"))
    secondary = bool(role_data.get("secondary"))
    subroles: list[uuid.UUID] = []

    if primary:
        subroles.append(SUBROLE_IDS[role_name]["primary"])
    if secondary:
        subroles.append(SUBROLE_IDS[role_name]["secondary"])

    return subroles or None


def build_request(
    path: Path,
    population_size: int,
    generations: int,
    num_pareto_solutions: int,
    trim_extra_players: bool,
) -> tuple[BalanceRequest, dict[uuid.UUID, str], list[str]]:
    source = json.loads(path.read_text(encoding="utf-8"))
    players_data = source["players"]

    player_names: dict[uuid.UUID, str] = {}
    players: list[Player] = []

    for player_id, player_data in players_data.items():
        identity = player_data["identity"]
        classes = player_data["stats"]["classes"]
        member_id = uuid.UUID(identity.get("uuid", player_id))
        player_names[member_id] = identity.get("name", player_id)

        roles: dict[uuid.UUID, PlayerRole] = {}
        for role_name in ROLE_NAMES:
            role_data = classes[role_name]
            if not role_data.get("isActive", False):
                continue

            role_id = ROLE_IDS[role_name]
            roles[role_id] = PlayerRole(
                priority=map_priority(role_data.get("priority")),
                rating=int(role_data.get("rank", 0)),
                subrole_ids=map_subroles(role_name, role_data),
            )

        if roles:
            players.append(Player(member_id=member_id, roles=roles))

    players_in_team = sum(ROLE_COUNTS.values())
    dropped_players: list[str] = []
    extra_players = len(players) % players_in_team
    if extra_players:
        if not trim_extra_players:
            raise ValueError(
                f"Player count {len(players)} is not divisible by players_in_team {players_in_team}."
            )

        kept_players = players[:-extra_players]
        removed_players = players[-extra_players:]
        dropped_players = [player_names[player.member_id] for player in removed_players]
        players = kept_players

    return (
        BalanceRequest(
            draft_id=uuid.uuid4(),
            players=players,
            balance_settings=make_balance_settings(
                population_size=population_size,
                generations=generations,
                num_pareto_solutions=num_pareto_solutions,
            ),
        ),
        player_names,
        dropped_players,
    )


async def send_rabbit_request(request: BalanceRequest) -> DraftBalances:
    from faststream.rabbit import RabbitBroker

    from mixtura_balancer_tournament.app.schemas import ResponseMessage
    from mixtura_balancer_tournament.env_config import env

    progress_task = asyncio.create_task(_consume_progress_updates(request.draft_id, env.rabbit.url))
    async with RabbitBroker(env.rabbit.url) as broker:
        try:
            response = await broker.request(
                message=request,
                queue=BALANCE_QUEUE,
                timeout=300,
            )
        finally:
            progress_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await progress_task

    print()

    parsed = ResponseMessage[DraftBalances].model_validate_json(response.body)
    if parsed.status != 200:
        raise RuntimeError(f"Unexpected response status={parsed.status}: {parsed.message}")
    return parsed.message


async def run_direct(request: BalanceRequest) -> DraftBalances:
    engine = get_engine()
    result = await engine.find_balances_async(
        request,
        progress_callback=_print_progress_update,
    )
    print()
    return result


def _format_metric_summary(metric: ProgressMetricSummary) -> str:
    return f"min={metric.min_value:.2f}, avg={metric.avg_value:.2f}, max={metric.max_value:.2f}"


async def _print_progress_update(progress: BalanceProgress) -> None:
    print(
        "Progress: "
        f"{progress.processed_generations}/{progress.total_generations}, "
        f"pareto_front={progress.pareto_front_size}, "
        f"balance[{_format_metric_summary(progress.fitness_balance)}], "
        f"priority[{_format_metric_summary(progress.fitness_priority)}], "
        f"role_imbalance[{_format_metric_summary(progress.fitness_role_imbalance)}], "
        f"subrole[{_format_metric_summary(progress.fitness_subrole)}]"
    )


async def _consume_progress_updates(draft_id: uuid.UUID, rabbit_url: str) -> None:
    import aio_pika

    from mixtura_balancer_tournament.app.schemas import ResponseMessage

    connection = await aio_pika.connect_robust(rabbit_url)
    try:
        channel = await connection.channel()
        queue = await channel.declare_queue(PROGRESS_QUEUE, durable=True)

        async with queue.iterator() as queue_iter:
            async for message in queue_iter:
                async with message.process():
                    if message.correlation_id != str(draft_id):
                        continue

                    parsed = ResponseMessage[BalanceProgress].model_validate_json(message.body)
                    if parsed.status != 102:
                        continue

                    await _print_progress_update(parsed.message)
    finally:
        await connection.close()


def print_summary(
    request: BalanceRequest,
    player_names: dict[uuid.UUID, str],
    dropped_players: list[str],
) -> None:
    teams_count = len(request.players) // request.balance_settings.players_in_team
    print(f"Source players used: {len(request.players)}")
    print(f"Teams count: {teams_count}")
    print(f"Team format: {ROLE_COUNTS}")
    if dropped_players:
        print(f"Dropped extra players: {', '.join(dropped_players)}")

    role_availability = {role_name: 0 for role_name in ROLE_NAMES}
    for player in request.players:
        for role_id in player.roles:
            role_availability[ROLE_NAME_BY_ID[role_id]] += 1
    print(f"Active role counts: {role_availability}")
    print(f"Draft ID: {request.draft_id}")
    print(f"First player: {player_names[request.players[0].member_id]}")


def get_player_subrole(player: Player, role_id: uuid.UUID) -> str:
    player_role = player.roles.get(role_id)
    if not player_role or not player_role.subrole_ids or len(player_role.subrole_ids) != 1:
        return ""
    return SUBROLE_NAME_BY_ID.get(player_role.subrole_ids[0], "")


def count_offroles(balance) -> int:
    return sum(1 for team in balance.teams for player in team.players if player.priority != 3)


def team_rating_spread(balance) -> int:
    team_totals = [team.total_rating for team in balance.teams]
    return max(team_totals) - min(team_totals) if team_totals else 0


def print_result(
    request: BalanceRequest,
    result: DraftBalances,
    player_names: dict[uuid.UUID, str],
    limit: int,
) -> None:
    request_players = {player.member_id: player for player in request.players}
    print(f"Generated {len(result.balances)} balance solutions")

    for balance_index, balance in enumerate(result.balances[:limit], start=1):
        print(f"\nBalance #{balance_index}")
        print(
            "Ranking metrics: "
            f"evaluation={balance.quality.evaluation:.3f}, "
            f"dp_fairness={balance.quality.dp_fairness:.3f}, "
            f"dp_role_fairness={balance.quality.dp_role_fairness:.3f}, "
            f"vq_uniformity={balance.quality.vq_uniformity:.3f}, "
            f"role_priority_points={balance.quality.role_priority_points:.3f}, "
            f"role_subrole_penalty={balance.quality.role_subrole_penalty:.3f}"
        )
        print(
            "NSGA fitness: "
            f"fitness_balance={balance.quality.fitness_balance:.3f}, "
            f"fitness_priority={balance.quality.fitness_priority:.3f}, "
            f"fitness_role_imbalance={balance.quality.fitness_role_imbalance:.3f}, "
            f"fitness_subrole={balance.quality.fitness_subrole:.3f}"
        )

        for team_index, team in enumerate(balance.teams, start=1):
            print(f"  Team {team_index} total_rating={team.total_rating}")
            for player in team.players:
                player_name = player_names.get(player.member_id, str(player.member_id))
                role_name = ROLE_NAME_BY_ID.get(player.game_role_id, str(player.game_role_id))
                source_player = request_players.get(player.member_id)
                subrole = get_player_subrole(source_player, player.game_role_id) if source_player else ""
                print(
                    f"    {player_name:<25} role={role_name:<7} subrole={subrole:<9} "
                    f"rating={player.rating:<4} priority={player.priority}"
                )


    print("\nBalances:")
    for balance_index, balance in enumerate(result.balances, start=1):
        print(
            f"  Balance #{balance_index}: "
            f"evaluation={balance.quality.evaluation:.3f}, "
            f"fairness={balance.quality.dp_fairness:.3f}, "
            f"role_fairness={balance.quality.dp_role_fairness:.3f}, "
            f"uniformity={balance.quality.vq_uniformity:.3f}, "
            f"offroles={count_offroles(balance)}, "
            f"team_spread={team_rating_spread(balance)}, "
            f"fitness_role_imbalance={balance.quality.fitness_role_imbalance:.3f}, "
            f"fitness_subrole={balance.quality.fitness_subrole:.3f}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run balancing for examples/tournament41.json",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("examples/tournament41.json"),
        help="Path to source JSON file.",
    )
    parser.add_argument(
        "--mode",
        choices=("direct", "rabbit"),
        default="direct",
        help="Run directly through the local engine or via RabbitMQ service.",
    )
    parser.add_argument(
        "--population-size",
        type=int,
        default=300,
        help="NSGA-II population size.",
    )
    parser.add_argument(
        "--generations",
        type=int,
        default=2000,
        help="NSGA-II generations count.",
    )
    parser.add_argument(
        "--num-pareto-solutions",
        type=int,
        default=50,
        help="How many Pareto solutions to keep.",
    )
    parser.add_argument(
        "--print-balances",
        type=int,
        default=1,
        help="How many balances to print.",
    )
    parser.add_argument(
        "--no-trim-extra-players",
        action="store_true",
        help="Fail instead of trimming players when count is not divisible by team size.",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    request, player_names, dropped_players = build_request(
        path=args.input,
        population_size=args.population_size,
        generations=args.generations,
        num_pareto_solutions=args.num_pareto_solutions,
        trim_extra_players=not args.no_trim_extra_players,
    )

    print_summary(request, player_names, dropped_players)

    if args.mode == "rabbit":
        result = await send_rabbit_request(request)
    else:
        result = await run_direct(request)

    print_result(request, result, player_names, args.print_balances)


if __name__ == "__main__":
    asyncio.run(main())
