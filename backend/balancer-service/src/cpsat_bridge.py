"""Bridge between xv-1 input format and ow_balancer_cpsat, and back to canonical balancer output."""

import math
from collections import Counter

from ow_balancer_cpsat import (
    BalancerConfig as CpsatConfig,
    Mask,
    Player as CpsatPlayer,
    PlayerFlag,
    Role,
    TeamBalancer,
)

# Map CP-SAT Role enum to canonical role name strings
ROLE_NAME_MAP = {
    Role.TANK: "Tank",
    Role.DPS: "Damage",
    Role.SUPPORT: "Support",
}

# Map xv-1 class key strings to CP-SAT Role enum
INPUT_ROLE_MAP = {
    "tank": Role.TANK,
    "dps": Role.DPS,
    "support": Role.SUPPORT,
}


def _captain_strength_key(player: CpsatPlayer) -> tuple:
    """Sort key for auto-captains: strongest players first."""
    max_sr = max(player.role_sr.values()) if player.role_sr else 0
    avg_sr = sum(player.role_sr.values()) / len(player.role_sr) if player.role_sr else 0
    flexibility = len(player.role_sr)
    return (max_sr, avg_sr, flexibility, player.name.lower(), player.id)


def _auto_assign_captains(players: list[CpsatPlayer], num_teams: int) -> None:
    """Mark top-N strongest active players as captains, where N is number of teams."""
    for p in players:
        p.is_captain = False
    strongest = sorted(players, key=_captain_strength_key, reverse=True)[:num_teams]
    for p in strongest:
        p.is_captain = True


def input_adapter(input_data: dict, num_teams: int) -> list[CpsatPlayer]:
    """Convert xv-1 input format to list of CP-SAT Player objects."""
    players = []
    for uuid, player_data in input_data.get("players", {}).items():
        name = player_data.get("identity", {}).get("name", uuid)
        identity = player_data.get("identity", {})
        classes = player_data.get("stats", {}).get("classes", {})

        role_sr: dict[Role, int] = {}
        role_priority: list[tuple[int, Role]] = []  # (priority, role) for sorting
        subclasses: dict[Role, str] = {}

        for class_key, class_data in classes.items():
            role = INPUT_ROLE_MAP.get(class_key)
            if role is None:
                continue
            is_active = class_data.get("isActive", False)
            rank = class_data.get("rank", 0)
            priority = class_data.get("priority", 99)
            subtype = class_data.get("subtype") or ""

            if is_active and rank > 0:
                role_sr[role] = rank
                role_priority.append((priority, role))
                if subtype:
                    subclasses[role] = subtype

        # Пропускаем игроков без активных ролей
        if not role_sr:
            continue

        # preferred_roles: active roles sorted by priority ascending
        role_priority.sort(key=lambda x: x[0])
        preferred_roles = [role for _, role in role_priority]

        # Флаги
        flags: set[PlayerFlag] = set()

        # isFullFlex → PlayerFlag.FLEX (все preferred_roles равноценны)
        if identity.get("isFullFlex", False):
            flags.add(PlayerFlag.FLEX)

        players.append(
            CpsatPlayer(
                id=uuid,
                name=name,
                role_sr=role_sr,
                preferred_roles=preferred_roles,
                subclasses=subclasses,
                flags=flags,
                avoid=set(),
                is_captain=identity.get("isCaptain", False),
            )
        )
    _auto_assign_captains(players, num_teams)
    return players


def _compute_low_thresholds(players):
    thresholds = {}
    for role in Role:
        vals = sorted(p.role_sr.get(role, 0) for p in players if p.role_sr.get(role, 0) > 0)
        if not vals:
            thresholds[ROLE_NAME_MAP[role]] = 0
            continue
        idx = min(int(len(vals) * 0.20), len(vals) - 1)
        thresholds[ROLE_NAME_MAP[role]] = vals[idx]
    return thresholds


def _team_avg(roster):
    vals = [pl["assigned_rating"] for arr in roster.values() for pl in arr]
    return sum(vals) / len(vals) if vals else 0.0


def _violates_low_rule(roster, role_name, low_thresholds):
    thr = low_thresholds.get(role_name, 0)
    if thr <= 0:
        return False
    lows = sum(1 for pl in roster.get(role_name, []) if 0 < pl["assigned_rating"] <= thr)
    return lows > 1


def _improve_team_equality(teams_list, players, max_iters=2000):
    low_thresholds = _compute_low_thresholds(players)
    if len(teams_list) < 2:
        return

    for _ in range(max_iters):
        team_avgs = [t["average_mmr"] for t in teams_list]
        hi = max(range(len(teams_list)), key=lambda i: team_avgs[i])
        lo = min(range(len(teams_list)), key=lambda i: team_avgs[i])
        current_range = team_avgs[hi] - team_avgs[lo]
        best = None

        high_team = teams_list[hi]
        low_team = teams_list[lo]

        for role_name in ("Tank", "Damage", "Support"):
            high_players = high_team["roster"].get(role_name, [])
            low_players = low_team["roster"].get(role_name, [])
            if not high_players or not low_players:
                continue

            for i, a in enumerate(high_players):
                if a.get("is_captain"):
                    continue
                for j, b in enumerate(low_players):
                    if b.get("is_captain"):
                        continue
                    if a["assigned_rating"] <= b["assigned_rating"]:
                        continue

                    # виртуальный swap
                    new_high = dict(high_team["roster"])
                    new_low = dict(low_team["roster"])
                    new_high[role_name] = list(high_players)
                    new_low[role_name] = list(low_players)
                    new_high[role_name][i], new_low[role_name][j] = b, a

                    if _violates_low_rule(new_high, role_name, low_thresholds) or _violates_low_rule(
                        new_low, role_name, low_thresholds
                    ):
                        continue

                    new_high_avg = _team_avg(new_high)
                    new_low_avg = _team_avg(new_low)
                    new_team_avgs = list(team_avgs)
                    new_team_avgs[hi] = new_high_avg
                    new_team_avgs[lo] = new_low_avg
                    new_range = max(new_team_avgs) - min(new_team_avgs)

                    # дополнительный критерий: уменьшаем и общий range, и разницу между этими двумя командами
                    pair_gap = abs(new_high_avg - new_low_avg)
                    cand = (
                        new_range,
                        pair_gap,
                        -(a["assigned_rating"] - b["assigned_rating"]),
                        role_name,
                        i,
                        j,
                        new_high_avg,
                        new_low_avg,
                    )
                    if best is None or cand < best[0]:
                        best = (cand, role_name, i, j, new_high_avg, new_low_avg)

        if best is None or best[0][0] >= current_range:
            break

        role_name, i, j, new_high_avg, new_low_avg = best[1], best[2], best[3], best[4], best[5]
        high_team["roster"][role_name][i], low_team["roster"][role_name][j] = (
            low_team["roster"][role_name][j],
            high_team["roster"][role_name][i],
        )
        high_team["average_mmr"] = new_high_avg
        low_team["average_mmr"] = new_low_avg


def output_adapter(results: list, num_teams: int) -> list[dict]:
    """Convert list of CP-SAT BalanceResult objects to canonical balancer payloads."""
    output = []
    for balance_result in results:
        teams_dict = balance_result.teams()  # dict[int, list[tuple[Player, Role]]]

        team_srs = []
        teams_list = []

        # off-role count: players assigned to a role not in their preferred_roles
        off_role_count = 0

        for t in sorted(teams_dict.keys()):
            roster_entries = teams_dict[t]
            team_sr = balance_result.team_avg_sr(t)
            team_srs.append(team_sr)

            roster: dict[str, list] = {}
            total_discomfort = 0
            max_discomfort = 0

            for player, assigned_role in roster_entries:
                role_name = ROLE_NAME_MAP[assigned_role]

                # discomfort: use pref_cost (FLEX-aware)
                discomfort = player.pref_cost(assigned_role)

                # off-role: assigned to a role that is not the player's first preferred role
                primary_role = player.preferred_roles[0] if player.preferred_roles else None
                is_off_role = primary_role is not None and assigned_role != primary_role
                if is_off_role:
                    off_role_count += 1
                    # Ensure discomfort is > 0 for off-role players so frontend displays the badge
                    if discomfort == 0:
                        discomfort = max(10, player.preferred_roles.index(assigned_role) * 10 if assigned_role in player.preferred_roles else 100)


                total_discomfort += discomfort
                max_discomfort = max(max_discomfort, discomfort)

                player_data = {
                    "uuid": player.id,
                    "name": player.name,
                    "assigned_rating": player.role_sr.get(assigned_role, 0),
                    "role_discomfort": discomfort,
                    "is_captain": player.is_captain,
                    "is_flex": player.is_flex,
                    "role_preferences": [ROLE_NAME_MAP[r] for r in player.preferred_roles],
                    "all_ratings": {ROLE_NAME_MAP[r]: sr for r, sr in player.role_sr.items()},
                    "sub_role": player.subclasses.get(assigned_role) or None,
                }

                if role_name not in roster:
                    roster[role_name] = []
                roster[role_name].append(player_data)

            teams_list.append(
                {
                    "id": t + 1,
                    "name": f"Team {t + 1}",
                    "average_mmr": team_sr,
                    "rating_variance": 0.0,
                    "total_discomfort": total_discomfort,
                    "max_discomfort": max_discomfort,
                    "roster": roster,
                }
            )

        # sub-role collision count: across all teams, pairs sharing (team, role, subclass)
        # subclasses are stored in player.subclasses dict keyed by Role enum
        sub_role_collision_count = 0
        for t in sorted(teams_dict.keys()):
            entries = teams_dict[t]
            role_subclass_list: list[tuple[str, str]] = []
            for player, assigned_role in entries:
                subclass = player.subclasses.get(assigned_role, "")
                if subclass:
                    role_subclass_list.append((ROLE_NAME_MAP[assigned_role], subclass))
            counts = Counter(role_subclass_list)
            for count in counts.values():
                if count > 1:
                    # C(count, 2) pairs
                    sub_role_collision_count += count * (count - 1) // 2

        _improve_team_equality(teams_list, balance_result.players)

        # benched players
        benched = balance_result.benched_players()
        benched_players_data = [
            {
                "uuid": p.id,
                "name": p.name,
                "assigned_rating": p.avg_sr,
                "role_discomfort": 0,
                "is_captain": p.is_captain,
                "role_preferences": [ROLE_NAME_MAP[r] for r in p.preferred_roles],
                "all_ratings": {ROLE_NAME_MAP[r]: sr for r, sr in p.role_sr.items()},
            }
            for p in benched
        ]

        # statistics
        avg_mmr = sum(team_srs) / len(team_srs) if team_srs else 0.0
        variance = sum((sr - avg_mmr) ** 2 for sr in team_srs) / len(team_srs) if team_srs else 0.0
        std_dev = math.sqrt(variance)

        m = balance_result.metrics()

        output.append(
            {
                "teams": teams_list,
                "statistics": {
                    "average_mmr": avg_mmr,
                    "mmr_std_dev": std_dev,
                    "mmrRange": m["sr_range"],
                    "mmrMAD": m["sr_mad"],
                    "total_teams": num_teams,
                    "players_per_team": 5,
                    "objective": m["objective"],
                    "rolePrefPenalty": m["role_pref_penalty"],
                    "subclassCollisions": m["subclass_collisions"],
                    "off_role_count": off_role_count,
                    "sub_role_collision_count": sub_role_collision_count,
                    "unbalanced_count": len(benched),
                },
                "benched_players": benched_players_data,
                "applied_config": {"algorithm": "cpsat"},
            }
        )

    return output


def run_cpsat(input_data: dict, max_solutions: int = 3) -> list[dict]:
    """Run the fast heuristic balancer and return canonical balancer payloads."""
    players_raw = input_data.get("players", {})

    # Count active players (any active class with rank > 0)
    active_count = 0
    for player_data in players_raw.values():
        classes = player_data.get("stats", {}).get("classes", {})
        has_active = any(c.get("isActive", False) and c.get("rank", 0) > 0 for c in classes.values())
        if has_active:
            active_count += 1

    num_teams = active_count // 5
    if num_teams < 2:
        raise ValueError(f"Need at least 10 active players for CP-SAT balancing, got {active_count}")

    players = input_adapter(input_data, num_teams)
    captain_count = sum(1 for p in players if p.is_captain)

    print(f"  Активных игроков: {len(players)}")
    print(f"  Команд: {num_teams} ({num_teams * 5} слотов, {len(players) - num_teams * 5} на скамейке)")
    for r in Role:
        avail = sum(1 for p in players if r in p.role_sr and p.role_sr[r] > 0)
        needed = Mask.overwatch_5v5(num_teams).roles[r] * num_teams
        marker = "✅" if avail >= needed else "❌"
        print(f"    {r.value:<8} {marker} нужно: {needed:>3}  доступно: {avail:>3}")
    flex_count = sum(1 for p in players if p.is_flex)
    print(f"  Flex-игроков: {flex_count}")
    print(f"  Капитанов: {captain_count}")
    print()

    cpsat_config = CpsatConfig(
        mask=Mask.overwatch_5v5(num_teams),
        time_limit_sec=90.0,
        max_solutions=max(8, max_solutions),
        captain_mode=captain_count >= num_teams,
        require_exactly_one_captain_per_team=captain_count >= num_teams,
        enforce_low_rank_hard=True,
    )

    results = TeamBalancer(players, cpsat_config).solve()
    return output_adapter(results, num_teams)
