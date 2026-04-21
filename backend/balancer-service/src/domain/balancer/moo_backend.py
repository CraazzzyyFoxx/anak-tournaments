from __future__ import annotations

import importlib
import json
import platform
from typing import Any

from loguru import logger

from src.core.config import AlgorithmConfig
from src.domain.balancer.determinism import build_balancer_seed, derive_balancer_seed
from src.domain.balancer.entities import Player, Team


def _load_native_module():
    try:
        return importlib.import_module("moo_core")
    except ImportError as exc:
        raise RuntimeError("Rust MOO backend requires moo_core to be installed") from exc


def _serialize_native_request(
    players: list[Player],
    num_teams: int,
    config: AlgorithmConfig,
    role_assignment: dict[str, str] | None,
    seed: int,
) -> str:
    return json.dumps(
        {
            "players": [
                {
                    "uuid": player.uuid,
                    "name": player.name,
                    "ratings": player.ratings,
                    "preferences": player.preferences,
                    "subclasses": player.subclasses,
                    "is_captain": player.is_captain,
                    "is_flex": player.is_flex,
                    "seed_role": role_assignment.get(player.uuid) if role_assignment else None,
                }
                for player in players
            ],
            "num_teams": num_teams,
            "seed": seed,
            "mask": config.role_mask,
            "config": {
                "population_size": config.population_size,
                "generation_count": config.generation_count,
                "mutation_rate": config.mutation_rate,
                "mutation_strength": config.mutation_strength,
                "max_result_variants": config.max_result_variants,
                "average_mmr_balance_weight": config.average_mmr_balance_weight,
                "team_total_balance_weight": config.team_total_balance_weight,
                "max_team_gap_weight": config.max_team_gap_weight,
                "role_discomfort_weight": config.role_discomfort_weight,
                "intra_team_variance_weight": config.intra_team_variance_weight,
                "max_role_discomfort_weight": config.max_role_discomfort_weight,
                "role_line_balance_weight": config.role_line_balance_weight,
                "role_spread_weight": config.role_spread_weight,
                "intra_team_std_weight": config.intra_team_std_weight,
                "internal_role_spread_weight": config.internal_role_spread_weight,
                "sub_role_collision_weight": config.sub_role_collision_weight,
                "use_captains": config.use_captains,
                "default_convergence_patience": 0,
            },
        }
    )


def _deserialize_native_variants(
    payload: dict[str, Any],
    players_by_uuid: dict[str, Player],
    mask: dict[str, int],
) -> list[tuple[list[Team], dict[str, float]]]:
    variants_payload = payload.get("variants")
    if not isinstance(variants_payload, list):
        raise ValueError("Rust MOO backend returned invalid payload: missing variants")

    variants: list[tuple[list[Team], dict[str, float]]] = []
    for variant_payload in variants_payload:
        if not isinstance(variant_payload, dict):
            continue
        teams_payload = variant_payload.get("teams")
        if not isinstance(teams_payload, list):
            continue

        teams: list[Team] = []
        for team_payload in teams_payload:
            if not isinstance(team_payload, dict):
                continue
            team_id = int(team_payload.get("id", len(teams) + 1))
            team = Team(team_id, mask)
            roster_payload = team_payload.get("roster", {})
            if not isinstance(roster_payload, dict):
                raise ValueError("Rust MOO backend returned invalid roster payload")

            for role, player_uuids in roster_payload.items():
                if role not in mask or not isinstance(player_uuids, list):
                    continue
                for player_uuid in player_uuids:
                    player = players_by_uuid.get(str(player_uuid))
                    if player is None:
                        raise ValueError(f"Rust MOO backend referenced unknown player uuid {player_uuid}")
                    team.add_player(role, player)
            teams.append(team)

        if teams:
            metrics = {
                "balance_objective": float(variant_payload.get("balance", 0.0)),
                "comfort_objective": float(variant_payload.get("comfort", 0.0)),
                "composite_score": float(variant_payload.get("score", 0.0)),
            }
            variants.append((teams, metrics))

    return variants


def _run_native_backend(
    native_module,
    players: list[Player],
    num_teams: int,
    config: AlgorithmConfig,
    role_assignment: dict[str, str] | None,
    seed: int,
) -> list[tuple[list[Team], dict[str, float]]]:
    players_by_uuid = {player.uuid: player for player in players}
    request_payload = _serialize_native_request(players, num_teams, config, role_assignment, seed)
    raw_response = native_module.run_moo_optimizer(request_payload)

    if isinstance(raw_response, bytes):
        raw_response = raw_response.decode("utf-8")
    if not isinstance(raw_response, str):
        raise ValueError("Rust MOO backend returned unsupported response type")

    payload = json.loads(raw_response)
    return _deserialize_native_variants(payload, players_by_uuid, config.role_mask)


def run_moo_optimizer(
    players: list[Player],
    num_teams: int,
    config: AlgorithmConfig,
    progress_callback,
    role_assignment: dict[str, str] | None = None,
    seed: int | None = None,
) -> list[tuple[list[Team], dict[str, float]]]:
    resolved_seed = seed
    if resolved_seed is None:
        resolved_seed = derive_balancer_seed(build_balancer_seed(players, num_teams, config), "moo_optimizer")

    if platform.system() != "Linux":
        raise RuntimeError("Rust MOO backend is supported only on Linux")

    native_module = _load_native_module()
    if native_module is None:
        raise RuntimeError("Rust MOO backend requires moo_core to be installed")
    logger.info("Running moo via Rust backend")
    return _run_native_backend(
        native_module,
        players,
        num_teams,
        config,
        role_assignment,
        resolved_seed,
    )
