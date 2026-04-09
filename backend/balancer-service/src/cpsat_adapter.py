"""Adapter: universal BalancerAlgorithm protocol -> CPAT TeamBalancer.

Replaces cpsat_bridge.py with a clean adapter that converts
PlayerInput -> CpsatPlayer and BalanceResult -> BalanceOutput.
"""

from __future__ import annotations

import math
from collections import Counter
from typing import Any

from ow_balancer_cpsat import (
    BalancerConfig as CpsatConfig,
    BalanceResult,
    Mask,
    Player as CpsatPlayer,
    PlayerFlag as CpsatPlayerFlag,
    Role,
    TeamBalancer,
)

from shared.balancer.types import BalanceOutput, PlayerAssignment, PlayerInput, RoleMask

# Map string role codes to CPAT Role enum
_ROLE_MAP: dict[str, Role] = {
    "tank": Role.TANK,
    "dps": Role.DPS,
    "support": Role.SUPPORT,
}

_ROLE_NAME_MAP: dict[Role, str] = {v: k for k, v in _ROLE_MAP.items()}

# Map string flags to CPAT PlayerFlag enum
_FLAG_MAP: dict[str, CpsatPlayerFlag] = {f.value: f for f in CpsatPlayerFlag}


def _to_cpsat_player(p: PlayerInput) -> CpsatPlayer:
    """Convert a universal PlayerInput to a CPAT Player."""
    role_sr: dict[Role, int] = {}
    for role_code, rank in p.role_ratings.items():
        cpsat_role = _ROLE_MAP.get(role_code)
        if cpsat_role is not None and rank > 0:
            role_sr[cpsat_role] = rank

    preferred_roles: list[Role] = []
    for role_code in p.preferred_roles:
        cpsat_role = _ROLE_MAP.get(role_code)
        if cpsat_role is not None and cpsat_role in role_sr:
            preferred_roles.append(cpsat_role)

    subclasses: dict[Role, str] = {}
    for role_code, subtype in p.subclasses.items():
        cpsat_role = _ROLE_MAP.get(role_code)
        if cpsat_role is not None:
            subclasses[cpsat_role] = subtype

    flags: set[CpsatPlayerFlag] = set()
    for flag_str in p.flags:
        cpsat_flag = _FLAG_MAP.get(flag_str)
        if cpsat_flag is not None:
            flags.add(cpsat_flag)

    avoid: set[str] = set(p.avoid_player_ids)

    return CpsatPlayer(
        id=p.id,
        name=p.name,
        role_sr=role_sr,
        preferred_roles=preferred_roles,
        subclasses=subclasses,
        flags=flags,
        avoid=avoid,
        is_captain=p.is_captain,
    )


def _captain_strength_key(player: CpsatPlayer) -> tuple[int, float, int, str, str]:
    """Sort key for auto-captain assignment: strongest players first."""
    max_sr = max(player.role_sr.values()) if player.role_sr else 0
    avg_sr = sum(player.role_sr.values()) / len(player.role_sr) if player.role_sr else 0.0
    flexibility = len(player.role_sr)
    return (max_sr, avg_sr, flexibility, player.name.lower(), player.id)


def _auto_assign_captains(players: list[CpsatPlayer], num_teams: int) -> None:
    """Mark the top-N strongest active players as captains."""
    for p in players:
        p.is_captain = False
    strongest = sorted(players, key=_captain_strength_key, reverse=True)[:num_teams]
    for p in strongest:
        p.is_captain = True


def _balance_result_to_output(result: BalanceResult, variant_number: int) -> BalanceOutput:
    """Convert a CPAT BalanceResult to a universal BalanceOutput."""
    assignments: list[PlayerAssignment] = []
    player_map = result._player_map()

    for pid, (team_idx, role) in result.assignment.items():
        player = player_map[pid]
        assigned_rank = player.sr_for(role)
        discomfort = player.pref_cost(role)

        # Check off-role
        primary_role = player.preferred_roles[0] if player.preferred_roles else None
        if primary_role is not None and role != primary_role and discomfort == 0:
            idx = player.preferred_roles.index(role) if role in player.preferred_roles else -1
            discomfort = max(10, idx * 10 if idx >= 0 else 100)

        assignments.append(
            PlayerAssignment(
                player_id=pid,
                team_index=team_idx,
                role=_ROLE_NAME_MAP[role],
                assigned_rank=assigned_rank,
                discomfort=discomfort,
            )
        )

    benched_ids = [p.id for p in result.benched_players()]
    raw_metrics = result.metrics()

    return BalanceOutput(
        variant_number=variant_number,
        assignments=assignments,
        benched_player_ids=benched_ids,
        objective_score=float(raw_metrics.get("objective", result.objective)),
        metrics=raw_metrics,
    )


class CpsatBalancer:
    """Implements BalancerAlgorithm via the existing CPAT TeamBalancer."""

    def solve(
        self,
        players: list[PlayerInput],
        mask: RoleMask,
        config: dict[str, Any],
    ) -> list[BalanceOutput]:
        cpsat_players = [_to_cpsat_player(p) for p in players]

        # Filter players without any active roles
        cpsat_players = [p for p in cpsat_players if p.role_sr]
        if not cpsat_players:
            return []

        num_teams = len(cpsat_players) // mask.team_size
        if num_teams < 2:
            raise ValueError(
                f"Need at least {mask.team_size * 2} active players, got {len(cpsat_players)}"
            )

        # Build CPAT Mask from RoleMask
        cpsat_roles: dict[Role, int] = {}
        for role_code, count in mask.slots.items():
            cpsat_role = _ROLE_MAP.get(role_code)
            if cpsat_role is not None:
                cpsat_roles[cpsat_role] = count

        cpsat_mask = Mask(num_teams=num_teams, team_size=mask.team_size, roles=cpsat_roles)

        # Auto-assign captains
        captain_count = sum(1 for p in cpsat_players if p.is_captain)
        use_captains = config.get("captain_mode", True)
        if use_captains and captain_count < num_teams:
            _auto_assign_captains(cpsat_players, num_teams)
            captain_count = sum(1 for p in cpsat_players if p.is_captain)

        max_solutions = config.get("max_solutions", 8)
        time_limit = config.get("time_limit_sec", 90.0)

        cpsat_config = CpsatConfig(
            mask=cpsat_mask,
            time_limit_sec=time_limit,
            max_solutions=max(8, max_solutions),
            captain_mode=use_captains and captain_count >= num_teams,
            require_exactly_one_captain_per_team=use_captains and captain_count >= num_teams,
            enforce_low_rank_hard=config.get("enforce_low_rank_hard", True),
            w_sr_spread=config.get("w_sr_spread", 1000000),
            w_sr_balance=config.get("w_sr_balance", 3000),
            w_role_delta=config.get("w_role_delta", 300),
            w_role_pref=config.get("w_role_pref", 20),
            w_flag_balance=config.get("w_flag_balance", 10),
            w_subclass_collision=config.get("w_subclass_collision", 10),
            w_high_rank_stack=config.get("w_high_rank_stack", 10),
        )

        results = TeamBalancer(cpsat_players, cpsat_config).solve()
        outputs = [_balance_result_to_output(r, i + 1) for i, r in enumerate(results)]

        # Limit to requested max_solutions
        return outputs[:max_solutions]
