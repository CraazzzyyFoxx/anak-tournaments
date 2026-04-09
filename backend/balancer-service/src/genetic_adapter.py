"""Adapter: universal BalancerAlgorithm protocol -> Genetic Algorithm optimizer.

Converts PlayerInput -> genetic Player objects, runs GeneticOptimizer,
and converts the result back to BalanceOutput.
"""

from __future__ import annotations

import math
from typing import Any

from src.core.config import AlgorithmConfig
from src.service import (
    GeneticOptimizer,
    Player as GeneticPlayer,
    Team as GeneticTeam,
    assign_captains,
)

from shared.balancer.types import BalanceOutput, PlayerAssignment, PlayerInput, RoleMask

# Genetic algorithm uses display names as role keys
_ROLE_DISPLAY: dict[str, str] = {
    "tank": "Tank",
    "dps": "Damage",
    "support": "Support",
}
_ROLE_REVERSE: dict[str, str] = {v: k for k, v in _ROLE_DISPLAY.items()}


def _to_genetic_player(p: PlayerInput, mask: dict[str, int]) -> GeneticPlayer | None:
    """Convert a universal PlayerInput to a genetic Player."""
    # Genetic Player uses display-name role keys (Tank, Damage, Support)
    ratings: dict[str, int] = {}
    for role_code, rank in p.role_ratings.items():
        display_name = _ROLE_DISPLAY.get(role_code)
        if display_name is not None and rank > 0:
            ratings[display_name] = rank

    if not ratings:
        return None

    preferences: list[str] = []
    for role_code in p.preferred_roles:
        display_name = _ROLE_DISPLAY.get(role_code)
        if display_name is not None and display_name in ratings:
            preferences.append(display_name)

    if not preferences:
        preferences = list(ratings.keys())

    subclasses: dict[str, str] = {}
    for role_code, subtype in p.subclasses.items():
        display_name = _ROLE_DISPLAY.get(role_code)
        if display_name is not None:
            subclasses[display_name] = subtype

    is_flex = "flex" in p.flags

    player = GeneticPlayer(
        name=p.name,
        ratings=ratings,
        preferences=preferences,
        uuid=p.id,
        mask=mask,
        is_flex=is_flex,
        subclasses=subclasses,
    )
    player.is_captain = p.is_captain
    return player


def _teams_to_output(
    teams: list[GeneticTeam],
    benched: list[GeneticPlayer],
    mask: dict[str, int],
) -> BalanceOutput:
    """Convert genetic Team objects to a universal BalanceOutput."""
    assignments: list[PlayerAssignment] = []

    for team in teams:
        for display_role, players in team.roster.items():
            role_code = _ROLE_REVERSE.get(display_role, display_role.lower())
            for player in players:
                assignments.append(
                    PlayerAssignment(
                        player_id=player.uuid,
                        team_index=team.id - 1,  # genetic uses 1-based
                        role=role_code,
                        assigned_rank=player.get_rating(display_role),
                        discomfort=player.get_discomfort(display_role),
                    )
                )

    benched_ids = [p.uuid for p in benched]

    # Compute basic metrics
    team_avgs = [t.mmr for t in teams]
    global_avg = sum(team_avgs) / len(team_avgs) if team_avgs else 0.0
    sr_range = max(team_avgs) - min(team_avgs) if team_avgs else 0.0
    sr_std = (
        math.sqrt(sum((s - global_avg) ** 2 for s in team_avgs) / len(team_avgs))
        if team_avgs
        else 0.0
    )

    total_discomfort = sum(t.discomfort for t in teams)

    return BalanceOutput(
        variant_number=1,
        assignments=assignments,
        benched_player_ids=benched_ids,
        objective_score=sr_std,
        metrics={
            "global_avg_sr": round(global_avg, 1),
            "sr_range": round(sr_range, 1),
            "sr_std": round(sr_std, 1),
            "total_discomfort": total_discomfort,
            "num_teams": len(teams),
        },
    )


class GeneticBalancer:
    """Implements BalancerAlgorithm via the existing GeneticOptimizer."""

    def solve(
        self,
        players: list[PlayerInput],
        mask: RoleMask,
        config: dict[str, Any],
    ) -> list[BalanceOutput]:
        # Build genetic-style mask (display name -> count)
        genetic_mask: dict[str, int] = {}
        for role_code, count in mask.slots.items():
            display_name = _ROLE_DISPLAY.get(role_code)
            if display_name is not None:
                genetic_mask[display_name] = count

        # Convert players
        genetic_players: list[GeneticPlayer] = []
        for p in players:
            gp = _to_genetic_player(p, genetic_mask)
            if gp is not None:
                genetic_players.append(gp)

        if not genetic_players:
            return []

        players_per_team = sum(genetic_mask.values())
        num_teams = len(genetic_players) // players_per_team
        if num_teams < 1:
            raise ValueError(
                f"Need at least {players_per_team} active players, got {len(genetic_players)}"
            )

        # Captains
        use_captains = config.get("captain_mode", True)
        if use_captains:
            assign_captains(genetic_players, num_teams)

        # Build AlgorithmConfig
        algo_config = AlgorithmConfig()
        algo_config.DEFAULT_MASK = genetic_mask
        algo_config.USE_CAPTAINS = use_captains

        # Apply config overrides
        config_mapping = {
            "population_size": "POPULATION_SIZE",
            "generations": "GENERATIONS",
            "elitism_rate": "ELITISM_RATE",
            "mutation_rate": "MUTATION_RATE",
            "mutation_strength": "MUTATION_STRENGTH",
            "mmr_diff_weight": "MMR_DIFF_WEIGHT",
            "team_total_std_weight": "TEAM_TOTAL_STD_WEIGHT",
            "max_team_gap_weight": "MAX_TEAM_GAP_WEIGHT",
            "discomfort_weight": "DISCOMFORT_WEIGHT",
            "intra_team_var_weight": "INTRA_TEAM_VAR_WEIGHT",
            "max_discomfort_weight": "MAX_DISCOMFORT_WEIGHT",
            "role_balance_weight": "ROLE_BALANCE_WEIGHT",
            "role_spread_weight": "ROLE_SPREAD_WEIGHT",
        }
        for key, attr_name in config_mapping.items():
            if key in config and config[key] is not None:
                setattr(algo_config, attr_name, config[key])

        opt = GeneticOptimizer(genetic_players, num_teams, algo_config, progress_callback=None)
        result_teams = opt.run()

        # Determine benched players
        placed_uuids: set[str] = set()
        for team in result_teams:
            for role_players in team.roster.values():
                for p in role_players:
                    placed_uuids.add(p.uuid)
        benched = [p for p in genetic_players if p.uuid not in placed_uuids]

        output = _teams_to_output(result_teams, benched, genetic_mask)
        return [output]
