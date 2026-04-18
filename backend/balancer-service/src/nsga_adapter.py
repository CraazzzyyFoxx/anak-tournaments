"""Adapter between balancer-service internal format and mixtura-balancer NSGA-II service."""

from __future__ import annotations
from alembic.op import f

import statistics
import uuid
from collections import Counter
from typing import Any

# Same namespace as used in test_client_tournament41.py
_UUID_NAMESPACE = uuid.UUID("3fce03d0-d7e0-4c81-9a35-a24b5fb9df1d")


def _stable_uuid(name: str) -> uuid.UUID:
    return uuid.uuid5(_UUID_NAMESPACE, name)


def _role_uuid(role_name: str) -> uuid.UUID:
    return _stable_uuid(f"role:{role_name.lower()}")


def _subrole_uuid(role_name: str, subrole_name: str) -> uuid.UUID:
    return _stable_uuid(f"subrole:{role_name.lower()}:{subrole_name.lower()}")


def _map_priority(raw_priority: Any) -> int:
    """Convert xv-1 priority (0=main) → mixtura priority (3=main, 1=worst).

    Mirrors the logic in test_client_tournament41.py:
        max(1, min(3, 3 - source_priority))
    """
    source_priority = int(raw_priority or 0)
    return max(1, min(3, 3 - source_priority))


def to_mixtura_request(
    input_data: dict[str, Any],
    config_overrides: dict[str, Any],
) -> dict[str, Any]:
    """Convert xv-1 player data + config overrides → BalanceRequest dict for mixtura-balancer."""
    raw_players: dict[str, Any] = input_data.get("players", {})

    role_mapping: dict[str, str] = config_overrides.get(
        "DEFAULT_ROLE_MAPPING",
        config_overrides.get(
            "ROLE_MAPPING",
            {"tank": "Tank", "dps": "Damage", "damage": "Damage", "support": "Support"},
        ),
    )
    mask: dict[str, int] = config_overrides.get(
        "DEFAULT_MASK",
        config_overrides.get("MASK", {"Tank": 1, "Damage": 2, "Support": 2}),
    )

    # Canonical role name → raw input role names (reverse mapping)
    canonical_to_raw: dict[str, list[str]] = {}
    for raw, canonical in role_mapping.items():
        canonical_to_raw.setdefault(canonical, []).append(raw)

    # Role UUIDs keyed by canonical name
    role_uuids: dict[str, uuid.UUID] = {canonical: _role_uuid(canonical) for canonical in mask}

    # Build roles settings for BalanceSettings (subroles populated later)
    roles: dict[str, Any] = {
        str(role_uuids[canonical]): {
            "original_game_role": str(role_uuids[canonical]),
            "count_in_team": count,
            "subroles": {},
        }
        for canonical, count in mask.items()
    }

    players_in_team = sum(mask.values())
    draft_id = str(uuid.uuid4())

    players_out: list[dict[str, Any]] = []
    seen_subroles: dict[str, set[str]] = {str(role_uuids[r]): set() for r in mask}

    for player_key, player_data in raw_players.items():
        classes: dict[str, Any] = player_data.get("stats", {}).get("classes", {})
        identity: dict[str, Any] = player_data.get("identity", {})

        # UUID comes from identity.uuid (the dict key may be a numeric string)
        raw_uuid = identity.get("uuid", player_key)
        try:
            member_id = str(uuid.UUID(str(raw_uuid)))
        except (ValueError, AttributeError):
            # Fallback: generate deterministic UUID from the string key
            member_id = str(_stable_uuid(f"player:{raw_uuid}"))

        player_roles: dict[str, Any] = {}
        for raw_role_name, cls_data in classes.items():
            if not cls_data.get("isActive", False):
                continue
            canonical = role_mapping.get(raw_role_name.lower())
            if canonical is None or canonical not in mask:
                continue

            role_id = str(role_uuids[canonical])
            rating: int = int(cls_data.get("rank", 0))
            priority: int = _map_priority(cls_data.get("priority", 0))

            # Subroles from primary/secondary flags
            subrole_ids: list[str] = []
            if cls_data.get("primary"):
                sr_id = str(_subrole_uuid(canonical, "primary"))
                subrole_ids.append(sr_id)
                seen_subroles[role_id].add(sr_id)
            if cls_data.get("secondary"):
                sr_id = str(_subrole_uuid(canonical, "secondary"))
                subrole_ids.append(sr_id)
                seen_subroles[role_id].add(sr_id)

            # Also handle subtype/subclass field if present
            subtype: str | None = cls_data.get("subtype") or cls_data.get("subclass")
            if subtype and not subrole_ids:
                sr_id = str(_subrole_uuid(canonical, subtype))
                subrole_ids.append(sr_id)
                seen_subroles[role_id].add(sr_id)

            player_roles[role_id] = {
                "priority": priority,
                "rating": rating,
                "subrole_ids": subrole_ids if subrole_ids else None,
            }

        if not player_roles:
            continue

        players_out.append({"member_id": member_id, "roles": player_roles})

    # Inject discovered subroles into role settings
    for role_id, subrole_set in seen_subroles.items():
        for sr_id in subrole_set:
            roles[role_id]["subroles"][sr_id] = {"capacity": 1}

    # Trim players so count is divisible by players_in_team
    extra = len(players_out) % players_in_team
    if extra:
        players_out = players_out[:-extra]

    population_size: int = config_overrides.get("POPULATION_SIZE", 200)
    generations: int = config_overrides.get("GENERATIONS", 1000)
    max_solutions: int = config_overrides.get("MAX_NSGA_SOLUTIONS", 10)
    role_spread_weight: float = config_overrides.get("ROLE_SPREAD_WEIGHT", 0.0)
    intra_team_std_weight: float = config_overrides.get("INTRA_TEAM_STD_WEIGHT", 0.0)
    weight_team_variance: float = config_overrides.get("WEIGHT_TEAM_VARIANCE", 1.0)
    team_spread_blend: float = config_overrides.get("TEAM_SPREAD_BLEND", 0.1)
    subrole_blend: float = config_overrides.get("SUBROLE_BLEND", 0.1)

    math_settings: dict[str, Any] = {
        "population_size": population_size,
        "generations": generations,
        "num_pareto_solutions": max_solutions,
        "weight_team_variance": weight_team_variance,
        "role_imbalance_blend": role_spread_weight,
        "team_spread_blend": team_spread_blend,
        "subrole_blend": subrole_blend,
        "intra_team_std_blend": intra_team_std_weight,
    }
    
    print(f"NSGA-II settings: {math_settings}", flush=True)

    return {
        "draft_id": draft_id,
        "players": players_out,
        "balance_settings": {
            "players_in_team": players_in_team,
            "roles": roles,
            "math": math_settings,
        },
    }


def from_mixtura_response(
    draft_balances: dict[str, Any],
    input_data: dict[str, Any],
    config_overrides: dict[str, Any],
    max_solutions: int = 10,
) -> list[dict[str, Any]]:
    """Convert DraftBalances dict from mixtura-balancer → list[BalanceResponse] dicts."""
    mask: dict[str, int] = config_overrides.get(
        "DEFAULT_MASK",
        config_overrides.get("MASK", {"Tank": 1, "Damage": 2, "Support": 2}),
    )
    role_mapping: dict[str, str] = config_overrides.get(
        "DEFAULT_ROLE_MAPPING",
        config_overrides.get(
            "ROLE_MAPPING",
            {"tank": "Tank", "dps": "Damage", "damage": "Damage", "support": "Support"},
        ),
    )

    role_uuids: dict[str, uuid.UUID] = {canonical: _role_uuid(canonical) for canonical in mask}
    role_id_to_name: dict[str, str] = {str(v): k for k, v in role_uuids.items()}

    raw_players: dict[str, Any] = input_data.get("players", {})
    player_info: dict[str, dict[str, Any]] = {}

    for player_key, pd in raw_players.items():
        identity = pd.get("identity", {})
        classes = pd.get("stats", {}).get("classes", {})

        raw_uuid = identity.get("uuid", player_key)
        try:
            member_id = str(uuid.UUID(str(raw_uuid)))
        except (ValueError, AttributeError):
            member_id = str(_stable_uuid(f"player:{raw_uuid}"))

        ratings: dict[str, int] = {}
        pref_with_priority: list[tuple[int, str]] = []
        subclasses: dict[str, str] = {}

        for raw_role, cls_data in classes.items():
            if not cls_data.get("isActive", False):
                continue
            canonical = role_mapping.get(raw_role.lower())
            if canonical is None or canonical not in mask:
                continue
            ratings[canonical] = int(cls_data.get("rank", 0))
            pref_with_priority.append((int(cls_data.get("priority", 999)), canonical))
            subtype = cls_data.get("subtype") or cls_data.get("subclass")
            if subtype:
                subclasses[canonical] = subtype

        pref_with_priority.sort(key=lambda x: x[0])
        preferences = [r for _, r in pref_with_priority]

        player_info[member_id] = {
            "uuid": member_id,
            "name": identity.get("name", player_key),
            "ratings": ratings,
            "preferences": preferences,
            "subclasses": subclasses,
            "isCaptain": identity.get("isCaptain", False),
            "isFlex": identity.get("isFullFlex", False),
        }

    balances: list[dict[str, Any]] = draft_balances.get("balances", [])
    balances = sorted(balances, key=lambda b: b.get("quality", {}).get("evaluation", 0))[:max_solutions]

    results: list[dict[str, Any]] = []

    for balance in balances:
        teams_raw: list[dict[str, Any]] = balance.get("teams", [])
        assigned_uuids: set[str] = set()
        teams_out: list[dict[str, Any]] = []

        all_totals: list[float] = []
        all_mmrs: list[float] = []

        for team_idx, team in enumerate(teams_raw, start=1):
            roster: dict[str, list[dict[str, Any]]] = {role: [] for role in mask}
            team_total = 0

            for tp in team.get("players", []):
                member_id = str(tp.get("member_id", ""))
                role_id = str(tp.get("game_role_id", ""))
                canonical_role = role_id_to_name.get(role_id)
                rating: int = int(tp.get("rating", 0))
                priority: int = int(tp.get("priority", 0))

                assigned_uuids.add(member_id)
                info = player_info.get(member_id, {})

                if canonical_role and canonical_role in roster:
                    discomfort = (3 - priority) * 100 if not info.get("isFlex") else 0
                    roster[canonical_role].append(
                        {
                            "uuid": member_id,
                            "name": info.get("name", member_id),
                            "rating": rating,
                            "discomfort": discomfort,
                            "isCaptain": info.get("isCaptain", False),
                            "isFlex": info.get("isFlex", False),
                            "preferences": info.get("preferences", []),
                            "allRatings": info.get("ratings", {}),
                            "subRole": info.get("subclasses", {}).get(canonical_role) or None,
                        }
                    )
                    team_total += rating

            team_mmr = team_total / max(sum(mask.values()), 1)
            all_totals.append(team_total)
            all_mmrs.append(team_mmr)

            team_ratings = [p["rating"] for role_players in roster.values() for p in role_players]
            variance = statistics.stdev(team_ratings) if len(team_ratings) > 1 else 0.0

            max_discomfort = max(
                (p["discomfort"] for role_players in roster.values() for p in role_players),
                default=0,
            )
            total_discomfort = sum(
                p["discomfort"] for role_players in roster.values() for p in role_players
            )

            captain_name: str | None = None
            for role_players in roster.values():
                for p in role_players:
                    if p["isCaptain"]:
                        captain_name = p["name"]
                        break

            teams_out.append(
                {
                    "id": team_idx,
                    "name": captain_name or f"Team {team_idx}",
                    "avgMMR": round(team_mmr, 2),
                    "totalRating": round(team_total, 2),
                    "variance": round(variance, 2),
                    "totalDiscomfort": total_discomfort,
                    "maxDiscomfort": max_discomfort,
                    "roster": roster,
                }
            )

        benched: list[dict[str, Any]] = []
        for member_id, info in player_info.items():
            if member_id not in assigned_uuids:
                best_rating = max(info["ratings"].values()) if info["ratings"] else 0
                benched.append(
                    {
                        "uuid": member_id,
                        "name": info["name"],
                        "rating": best_rating,
                        "discomfort": 0,
                        "isCaptain": info["isCaptain"],
                        "isFlex": info["isFlex"],
                        "preferences": info["preferences"],
                        "allRatings": info["ratings"],
                    }
                )

        off_role_count = 0
        sub_role_collision_count = 0
        for team in teams_out:
            for role, role_players in team["roster"].items():
                for p in role_players:
                    prefs = p.get("preferences", [])
                    if not p["isFlex"] and prefs and prefs[0] != role:
                        off_role_count += 1

            role_subclass_list: list[tuple[str, str]] = []
            pinfo_map = {
                p["uuid"]: player_info.get(p["uuid"], {})
                for role_players in team["roster"].values()
                for p in role_players
            }
            for role, role_players in team["roster"].items():
                for p in role_players:
                    subclass = pinfo_map.get(p["uuid"], {}).get("subclasses", {}).get(role, "")
                    if subclass:
                        role_subclass_list.append((role, subclass))
            counts = Counter(role_subclass_list)
            for count in counts.values():
                if count > 1:
                    sub_role_collision_count += count * (count - 1) // 2

        quality = balance.get("quality", {})
        if len(all_mmrs) > 1:
            stats: dict[str, Any] = {
                "averageMMR": round(statistics.mean(all_mmrs), 2),
                "mmrStdDev": round(statistics.stdev(all_mmrs), 2),
                "averageTotalRating": round(statistics.mean(all_totals), 2),
                "totalRatingStdDev": round(statistics.stdev(all_totals), 2),
                "maxTotalRatingGap": round(max(all_totals) - min(all_totals), 2),
                "totalTeams": len(teams_out),
                "playersPerTeam": sum(mask.values()),
                "offRoleCount": off_role_count,
                "subRoleCollisionCount": sub_role_collision_count,
                "nsga_dp_fairness": quality.get("dp_fairness", 0.0),
                "nsga_vq_uniformity": quality.get("vq_uniformity", 0.0),
                "nsga_role_priority_points": quality.get("role_priority_points", 0.0),
                "nsga_evaluation": quality.get("evaluation", 0.0),
            }
        else:
            stats = {
                "averageMMR": round(all_mmrs[0], 2) if all_mmrs else 0,
                "mmrStdDev": 0,
                "averageTotalRating": round(all_totals[0], 2) if all_totals else 0,
                "totalRatingStdDev": 0,
                "maxTotalRatingGap": 0,
                "totalTeams": len(teams_out),
                "playersPerTeam": sum(mask.values()),
                "offRoleCount": off_role_count,
                "subRoleCollisionCount": sub_role_collision_count,
                "nsga_dp_fairness": quality.get("dp_fairness", 0.0),
                "nsga_vq_uniformity": quality.get("vq_uniformity", 0.0),
                "nsga_role_priority_points": quality.get("role_priority_points", 0.0),
                "nsga_evaluation": quality.get("evaluation", 0.0),
            }

        results.append(
            {
                "teams": teams_out,
                "statistics": stats,
                "benchedPlayers": benched,
                "appliedConfig": {"ALGORITHM": "nsga", **config_overrides},
            }
        )

    return results
