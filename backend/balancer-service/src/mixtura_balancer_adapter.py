"""Adapter between balancer-service internal format and mixtura-balancer service."""

from __future__ import annotations

import statistics
import uuid
from collections import Counter
from typing import Any

from src.domain.balancer.input_roles import resolve_input_role_name
from src.domain.balancer.public_contract import normalize_persisted_config_payload

_UUID_NAMESPACE = uuid.UUID("3fce03d0-d7e0-4c81-9a35-a24b5fb9df1d")


def _stable_uuid(name: str) -> uuid.UUID:
    return uuid.uuid5(_UUID_NAMESPACE, name)


def _role_uuid(role_name: str) -> uuid.UUID:
    return _stable_uuid(f"role:{role_name.lower()}")


def _subrole_uuid(role_name: str, subrole_name: str) -> uuid.UUID:
    return _stable_uuid(f"subrole:{role_name.lower()}:{subrole_name.lower()}")


def _map_priority(raw_priority: Any) -> int:
    source_priority = int(raw_priority or 0)
    return max(1, min(3, 3 - source_priority))


def to_mixtura_request(
    input_data: dict[str, Any],
    config_overrides: dict[str, Any],
) -> dict[str, Any]:
    raw_players: dict[str, Any] = input_data.get("players", {})
    config_overrides = normalize_persisted_config_payload(config_overrides)

    mask: dict[str, int] = config_overrides.get(
        "role_mask",
        {"Tank": 1, "Damage": 2, "Support": 2},
    )

    role_uuids: dict[str, uuid.UUID] = {canonical: _role_uuid(canonical) for canonical in mask}
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
    seen_subroles: dict[str, set[str]] = {str(role_uuids[role]): set() for role in mask}

    for player_key, player_data in raw_players.items():
        classes: dict[str, Any] = player_data.get("stats", {}).get("classes", {})
        identity: dict[str, Any] = player_data.get("identity", {})

        raw_uuid = identity.get("uuid", player_key)
        try:
            member_id = str(uuid.UUID(str(raw_uuid)))
        except (ValueError, AttributeError):
            member_id = str(_stable_uuid(f"player:{raw_uuid}"))

        player_roles: dict[str, Any] = {}
        for raw_role_name, cls_data in classes.items():
            if not cls_data.get("isActive", False):
                continue
            canonical = resolve_input_role_name(raw_role_name, mask)
            if canonical is None or canonical not in mask:
                continue

            role_id = str(role_uuids[canonical])
            rating: int = int(cls_data.get("rank", 0))
            priority: int = _map_priority(cls_data.get("priority", 0))

            subrole_ids: list[str] = []
            if cls_data.get("primary"):
                sr_id = str(_subrole_uuid(canonical, "primary"))
                subrole_ids.append(sr_id)
                seen_subroles[role_id].add(sr_id)
            if cls_data.get("secondary"):
                sr_id = str(_subrole_uuid(canonical, "secondary"))
                subrole_ids.append(sr_id)
                seen_subroles[role_id].add(sr_id)

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

    for role_id, subrole_set in seen_subroles.items():
        for subrole_id in subrole_set:
            roles[role_id]["subroles"][subrole_id] = {"capacity": 1}

    extra = len(players_out) % players_in_team
    if extra:
        players_out = players_out[:-extra]

    return {
        "draft_id": draft_id,
        "players": players_out,
        "balance_settings": {
            "players_in_team": players_in_team,
            "roles": roles,
            "math": {
                "population_size": config_overrides.get("population_size", 200),
                "generations": config_overrides.get("generation_count", 1000),
                "num_pareto_solutions": config_overrides.get("max_result_variants", 10),
                "weight_team_variance": config_overrides.get("team_variance_weight", 1.0),
                "role_imbalance_blend": config_overrides.get("role_spread_weight", 0.0),
                "team_spread_blend": config_overrides.get("team_spread_weight", 0.1),
                "subrole_blend": config_overrides.get("sub_role_penalty_weight", 0.1),
                "intra_team_std_blend": config_overrides.get("intra_team_std_weight", 0.0),
            },
        },
    }


def from_mixtura_response(
    draft_balances: dict[str, Any],
    input_data: dict[str, Any],
    config_overrides: dict[str, Any],
    max_solutions: int = 10,
) -> list[dict[str, Any]]:
    config_overrides = normalize_persisted_config_payload(config_overrides)
    mask: dict[str, int] = config_overrides.get("role_mask", {"Tank": 1, "Damage": 2, "Support": 2})

    role_uuids: dict[str, uuid.UUID] = {canonical: _role_uuid(canonical) for canonical in mask}
    role_id_to_name: dict[str, str] = {str(value): key for key, value in role_uuids.items()}

    raw_players: dict[str, Any] = input_data.get("players", {})
    player_info: dict[str, dict[str, Any]] = {}

    for player_key, payload in raw_players.items():
        identity = payload.get("identity", {})
        classes = payload.get("stats", {}).get("classes", {})
        raw_uuid = identity.get("uuid", player_key)
        try:
            member_id = str(uuid.UUID(str(raw_uuid)))
        except (ValueError, AttributeError):
            member_id = str(_stable_uuid(f"player:{raw_uuid}"))

        ratings: dict[str, int] = {}
        preferences_with_priority: list[tuple[int, str]] = []
        subclasses: dict[str, str] = {}

        for raw_role, cls_data in classes.items():
            if not cls_data.get("isActive", False):
                continue
            canonical = resolve_input_role_name(raw_role, mask)
            if canonical is None or canonical not in mask:
                continue
            ratings[canonical] = int(cls_data.get("rank", 0))
            preferences_with_priority.append((int(cls_data.get("priority", 999)), canonical))
            subtype = cls_data.get("subtype") or cls_data.get("subclass")
            if subtype:
                subclasses[canonical] = subtype

        preferences_with_priority.sort(key=lambda item: item[0])
        player_info[member_id] = {
            "uuid": member_id,
            "name": identity.get("name", player_key),
            "ratings": ratings,
            "preferences": [role for _, role in preferences_with_priority],
            "subclasses": subclasses,
            "is_captain": identity.get("isCaptain", False),
            "is_flex": identity.get("isFullFlex", False),
        }

    balances: list[dict[str, Any]] = draft_balances.get("balances", [])
    balances = sorted(balances, key=lambda payload: payload.get("quality", {}).get("evaluation", 0))[:max_solutions]

    results: list[dict[str, Any]] = []
    for balance in balances:
        teams_raw: list[dict[str, Any]] = balance.get("teams", [])
        assigned_uuids: set[str] = set()
        teams_out: list[dict[str, Any]] = []
        all_totals: list[float] = []
        all_mmrs: list[float] = []

        for team_index, team in enumerate(teams_raw, start=1):
            roster: dict[str, list[dict[str, Any]]] = {role: [] for role in mask}
            team_total = 0

            for player_assignment in team.get("players", []):
                member_id = str(player_assignment.get("member_id", ""))
                role_id = str(player_assignment.get("game_role_id", ""))
                canonical_role = role_id_to_name.get(role_id)
                rating = int(player_assignment.get("rating", 0))
                priority = int(player_assignment.get("priority", 0))
                info = player_info.get(member_id, {})
                assigned_uuids.add(member_id)

                if canonical_role and canonical_role in roster:
                    discomfort = (3 - priority) * 100 if not info.get("is_flex") else 0
                    roster[canonical_role].append(
                        {
                            "uuid": member_id,
                            "name": info.get("name", member_id),
                            "assigned_rating": rating,
                            "role_discomfort": discomfort,
                            "is_captain": info.get("is_captain", False),
                            "is_flex": info.get("is_flex", False),
                            "role_preferences": info.get("preferences", []),
                            "all_ratings": info.get("ratings", {}),
                            "sub_role": info.get("subclasses", {}).get(canonical_role) or None,
                        }
                    )
                    team_total += rating

            team_mmr = team_total / max(sum(mask.values()), 1)
            all_totals.append(team_total)
            all_mmrs.append(team_mmr)
            team_ratings = [player["assigned_rating"] for players in roster.values() for player in players]
            rating_variance = statistics.stdev(team_ratings) if len(team_ratings) > 1 else 0.0
            max_discomfort = max((player["role_discomfort"] for players in roster.values() for player in players), default=0)
            total_discomfort = sum(player["role_discomfort"] for players in roster.values() for player in players)

            captain_name: str | None = None
            for players in roster.values():
                for player in players:
                    if player["is_captain"]:
                        captain_name = player["name"]
                        break
                if captain_name:
                    break

            teams_out.append(
                {
                    "id": team_index,
                    "name": captain_name or f"Team {team_index}",
                    "average_mmr": round(team_mmr, 2),
                    "rating_variance": round(rating_variance, 2),
                    "total_discomfort": total_discomfort,
                    "max_discomfort": max_discomfort,
                    "roster": roster,
                }
            )

        benched: list[dict[str, Any]] = []
        for member_id, info in player_info.items():
            if member_id in assigned_uuids:
                continue
            best_rating = max(info["ratings"].values()) if info["ratings"] else 0
            benched.append(
                {
                    "uuid": member_id,
                    "name": info["name"],
                    "assigned_rating": best_rating,
                    "role_discomfort": 0,
                    "is_captain": info["is_captain"],
                    "is_flex": info["is_flex"],
                    "role_preferences": info["preferences"],
                    "all_ratings": info["ratings"],
                }
            )

        off_role_count = 0
        sub_role_collision_count = 0
        for team in teams_out:
            for role, players in team["roster"].items():
                for player in players:
                    preferences = player.get("role_preferences", [])
                    if not player["is_flex"] and preferences and preferences[0] != role:
                        off_role_count += 1

            role_subclass_list: list[tuple[str, str]] = []
            player_map = {
                player["uuid"]: player_info.get(player["uuid"], {})
                for players in team["roster"].values()
                for player in players
            }
            for role, players in team["roster"].items():
                for player in players:
                    subclass = player_map.get(player["uuid"], {}).get("subclasses", {}).get(role, "")
                    if subclass:
                        role_subclass_list.append((role, subclass))
            counts = Counter(role_subclass_list)
            for count in counts.values():
                if count > 1:
                    sub_role_collision_count += count * (count - 1) // 2

        quality = balance.get("quality", {})
        statistics_payload: dict[str, Any]
        if len(all_mmrs) > 1:
            statistics_payload = {
                "average_mmr": round(statistics.mean(all_mmrs), 2),
                "mmr_std_dev": round(statistics.stdev(all_mmrs), 2),
                "average_total_rating": round(statistics.mean(all_totals), 2),
                "total_rating_std_dev": round(statistics.stdev(all_totals), 2),
                "max_total_rating_gap": round(max(all_totals) - min(all_totals), 2),
                "total_teams": len(teams_out),
                "players_per_team": sum(mask.values()),
                "off_role_count": off_role_count,
                "sub_role_collision_count": sub_role_collision_count,
                "mixtura_dp_fairness": quality.get("dp_fairness", 0.0),
                "mixtura_vq_uniformity": quality.get("vq_uniformity", 0.0),
                "mixtura_role_priority_points": quality.get("role_priority_points", 0.0),
                "mixtura_evaluation": quality.get("evaluation", 0.0),
            }
        else:
            statistics_payload = {
                "average_mmr": round(all_mmrs[0], 2) if all_mmrs else 0,
                "mmr_std_dev": 0,
                "average_total_rating": round(all_totals[0], 2) if all_totals else 0,
                "total_rating_std_dev": 0,
                "max_total_rating_gap": 0,
                "total_teams": len(teams_out),
                "players_per_team": sum(mask.values()),
                "off_role_count": off_role_count,
                "sub_role_collision_count": sub_role_collision_count,
                "mixtura_dp_fairness": quality.get("dp_fairness", 0.0),
                "mixtura_vq_uniformity": quality.get("vq_uniformity", 0.0),
                "mixtura_role_priority_points": quality.get("role_priority_points", 0.0),
                "mixtura_evaluation": quality.get("evaluation", 0.0),
            }

        results.append(
            {
                "teams": teams_out,
                "statistics": statistics_payload,
                "benched_players": benched,
                "applied_config": {"algorithm": "mixtura_balancer", **config_overrides},
            }
        )

    return results
