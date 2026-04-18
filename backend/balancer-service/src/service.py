"""
Team balancing service using genetic algorithms.

This module provides the core balancing logic for tournament teams,
using a genetic algorithm approach to optimize team composition based on
player ratings, role preferences, and various balancing criteria.
"""

import json
import math
import random
import statistics
import time
import typing
from collections import Counter
from collections.abc import Callable
from pathlib import Path

from loguru import logger

from src.config_presets import ConfigPresets
from src.core.config import AlgorithmConfig

ProgressPayload = dict[str, typing.Any]
ProgressCallback = Callable[[ProgressPayload], None]


def _sample_stdev_from_sums(sum_x: float, sum_x2: float, n: int) -> float:
    """Fast sample stdev (like statistics.stdev) from sum(x), sum(x^2)."""
    if n < 2:
        return 0.0

    var = (sum_x2 - (sum_x * sum_x) / n) / (n - 1)
    if var <= 0.0:
        return 0.0

    return math.sqrt(var)


def emit_progress(
    progress_callback: ProgressCallback | None,
    *,
    status: str,
    stage: str,
    message: str,
    level: str = "info",
    progress: dict[str, int | float] | None = None,
) -> None:
    """Emit progress/log updates to optional callback."""
    if progress_callback is None:
        return

    payload: ProgressPayload = {
        "status": status,
        "stage": stage,
        "message": message,
        "level": level,
    }
    if progress is not None:
        payload["progress"] = progress

    progress_callback(payload)


def calculate_gap_penalty(max_team_gap: float) -> float:
    """
    Very strong nonlinear penalty for team strength gap.
    The larger the gap, the more disproportionately expensive it becomes.
    """
    if max_team_gap <= 25:
        return max_team_gap
    if max_team_gap <= 50:
        return max_team_gap * 2.0
    if max_team_gap <= 100:
        return max_team_gap * 5.0
    if max_team_gap <= 200:
        return max_team_gap * 12.0
    return max_team_gap * 30.0


class Player:
    """Represents a tournament player with ratings and role preferences."""

    __slots__ = (
        "uuid",
        "name",
        "ratings",
        "preferences",
        "subclasses",
        "discomfort_map",
        "is_captain",
        "is_flex",
        "captain_role",
        "_max_rating",
        "_mask",
    )

    def __init__(
        self,
        name: str,
        ratings: dict[str, int],
        preferences: list[str],
        uuid: str,
        mask: dict[str, int],
        is_flex: bool = False,
        subclasses: dict[str, str] | None = None,
    ) -> None:
        self.uuid = uuid
        self.name = name
        self.ratings = ratings
        self.preferences = preferences
        self.subclasses: dict[str, str] = subclasses or {}
        self.is_captain = False
        self.is_flex = is_flex
        # ``captain_role`` is the role the player is pinned to when flagged as
        # captain. Non-captains leave it as ``None``. Set by ``assign_captains``
        # and read by ``find_feasible_role_assignment`` so matching never moves
        # a captain off their top-preference role.
        self.captain_role: str | None = None
        self._max_rating = max(ratings.values()) if ratings else 0
        self._mask = mask

        self.discomfort_map = {}
        for role in self._mask.keys():
            if is_flex and role in ratings:
                # Flex players are equally comfortable in any role they can play
                self.discomfort_map[role] = 0
            elif role in preferences:
                self.discomfort_map[role] = preferences.index(role) * 100
            else:
                self.discomfort_map[role] = 1000 if role in ratings else 5000

    @property
    def max_rating(self) -> int:
        return self.ratings[self.preferences[0]] if self.preferences else self._max_rating

    def get_rating(self, role: str) -> int:
        return self.ratings.get(role, 0)

    def can_play(self, role: str) -> bool:
        return role in self.ratings

    def get_discomfort(self, current_role: str) -> int:
        return self.discomfort_map.get(current_role, 5000)

    def __repr__(self) -> str:
        return f"{self.name}"


class Team:
    """Represents a tournament team with a roster of players."""

    __slots__ = (
        "id",
        "roster",
        "_cached_mmr",
        "_cached_total_rating",
        "_cached_discomfort",
        "_cached_intra_std",
        "_cached_max_pain",
        "_cached_subrole_collisions",
        "_cached_role_totals",
        "_cached_role_spread_var",
        "_cached_role_spread_counted",
        "_is_dirty",
        "_mask",
    )

    def __init__(self, t_id: int, mask: dict[str, int]) -> None:
        self.id = t_id
        self._mask = mask
        self.roster = {role: [] for role in mask if mask[role] > 0}
        self._cached_mmr = 0.0
        self._cached_total_rating = 0.0
        self._cached_discomfort = 0.0
        self._cached_intra_std = 0.0
        self._cached_max_pain = 0
        self._cached_subrole_collisions = 0
        # Role-level caches: totals per role and the per-team spread variance
        # across role averages. Populated by calculate_stats().
        self._cached_role_totals: dict[str, float] = {}
        self._cached_role_spread_var = 0.0
        self._cached_role_spread_counted = False
        self._is_dirty = True

    def copy(self) -> "Team":
        new_team = Team(self.id, self._mask)
        # Безопасная микро-оптимизация: срезы lst[:] работают быстрее list(lst)
        new_team.roster = {r: p_list[:] for r, p_list in self.roster.items()}
        new_team._cached_mmr = self._cached_mmr
        new_team._cached_total_rating = self._cached_total_rating
        new_team._cached_discomfort = self._cached_discomfort
        new_team._cached_intra_std = self._cached_intra_std
        new_team._cached_max_pain = self._cached_max_pain
        new_team._cached_subrole_collisions = self._cached_subrole_collisions
        new_team._cached_role_totals = self._cached_role_totals.copy()
        new_team._cached_role_spread_var = self._cached_role_spread_var
        new_team._cached_role_spread_counted = self._cached_role_spread_counted
        new_team._is_dirty = self._is_dirty
        return new_team

    def add_player(self, role: str, player: Player) -> bool:
        if len(self.roster[role]) < self._mask[role]:
            self.roster[role].append(player)
            self._is_dirty = True
            return True
        return False

    def replace_player(self, role: str, index: int, new_player: Player) -> None:
        self.roster[role][index] = new_player
        self._is_dirty = True

    def calculate_stats(self) -> None:
        if not self._is_dirty:
            return

        sum_rating = 0.0
        sum_rating2 = 0.0
        count = 0
        total_pain = 0
        max_pain_in_team = 0
        subrole_collisions = 0

        role_totals: dict[str, float] = {}
        role_avg_sum = 0.0
        role_avg_sum2 = 0.0
        role_avg_count = 0

        for role, players in self.roster.items():
            if not players:
                continue

            role_sum_rating = 0.0
            subrole_counts: dict[str, int] = {}
            for p in players:
                r = p.ratings.get(role, 0)
                d = p.discomfort_map.get(role, 5000)
                role_sum_rating += r
                sum_rating2 += r * r
                total_pain += d
                count += 1
                if d > max_pain_in_team:
                    max_pain_in_team = d

                subtype = p.subclasses.get(role, "")
                if subtype:
                    subrole_counts[subtype] = subrole_counts.get(subtype, 0) + 1

            sum_rating += role_sum_rating
            role_totals[role] = role_sum_rating
            role_avg = role_sum_rating / len(players)
            role_avg_sum += role_avg
            role_avg_sum2 += role_avg * role_avg
            role_avg_count += 1

            for occurrences in subrole_counts.values():
                if occurrences > 1:
                    # Number of unique pairs with the same subclass on this role line.
                    subrole_collisions += occurrences * (occurrences - 1) // 2

        self._cached_total_rating = sum_rating

        if count > 0:
            self._cached_mmr = sum_rating / count
            self._cached_intra_std = _sample_stdev_from_sums(sum_rating, sum_rating2, count)
        else:
            self._cached_mmr = 0.0
            self._cached_intra_std = 0.0

        self._cached_discomfort = total_pain
        self._cached_max_pain = max_pain_in_team
        self._cached_subrole_collisions = subrole_collisions
        self._cached_role_totals = role_totals

        # Pre-compute the intra-team role-spread variance once; callers in the
        # hot path read `_cached_role_spread_var` instead of re-iterating the
        # roster.
        if role_avg_count >= 2:
            spread_var = (role_avg_sum2 / role_avg_count) - (role_avg_sum / role_avg_count) ** 2
            self._cached_role_spread_var = spread_var if spread_var > 0.0 else 0.0
            self._cached_role_spread_counted = True
        else:
            self._cached_role_spread_var = 0.0
            self._cached_role_spread_counted = False

        self._is_dirty = False

    @property
    def mmr(self) -> float:
        if self._is_dirty:
            self.calculate_stats()
        return self._cached_mmr

    @property
    def total_rating(self) -> float:
        if self._is_dirty:
            self.calculate_stats()
        return self._cached_total_rating

    @property
    def discomfort(self) -> float:
        if self._is_dirty:
            self.calculate_stats()
        return self._cached_discomfort

    @property
    def intra_std(self) -> float:
        if self._is_dirty:
            self.calculate_stats()
        return self._cached_intra_std

    @property
    def max_pain(self) -> int:
        if self._is_dirty:
            self.calculate_stats()
        return self._cached_max_pain

    @property
    def subrole_collisions(self) -> int:
        if self._is_dirty:
            self.calculate_stats()
        return self._cached_subrole_collisions

    def is_full(self) -> bool:
        for role, needed in self._mask.items():
            if len(self.roster.get(role, [])) < needed:
                return False
        return True


# --- Genetic Algorithm Logic ---


def calculate_cost(teams: list[Team], config: AlgorithmConfig) -> float:
    """
    Calculate the cost (fitness) of a team configuration.

    Main priority:
    1. Minimize total team strength difference
    2. Minimize average team MMR difference
    3. Then optimize secondary criteria
    """
    if not teams:
        return float("inf")

    n = len(teams)
    mask = config.DEFAULT_MASK

    sum_mmr = 0.0
    sum_mmr2 = 0.0
    sum_total = 0.0
    sum_total2 = 0.0
    sum_discomfort = 0.0
    sum_intra_std = 0.0
    sum_subrole_collisions = 0
    global_max_pain = 0

    min_team_total = float("inf")
    max_team_total = float("-inf")

    role_sums: dict[str, float] = {}
    role_sums2: dict[str, float] = {}
    role_counts: dict[str, int] = {}

    total_role_spread = 0.0
    counted_spread_teams = 0

    for t in teams:
        t.calculate_stats()

        team_mmr = t._cached_mmr
        team_total = t._cached_total_rating

        sum_mmr += team_mmr
        sum_mmr2 += team_mmr * team_mmr
        sum_total += team_total
        sum_total2 += team_total * team_total
        sum_discomfort += t._cached_discomfort
        sum_intra_std += t._cached_intra_std
        sum_subrole_collisions += t._cached_subrole_collisions

        if team_total < min_team_total:
            min_team_total = team_total
        if team_total > max_team_total:
            max_team_total = team_total

        if t._cached_max_pain > global_max_pain:
            global_max_pain = t._cached_max_pain

        # Hot path: iterate cached role totals (≤ 3 entries) instead of iterating
        # every player. Saves O(P) per team per cost call — the biggest GA hotspot.
        role_totals_cache = t._cached_role_totals
        for role, role_total in role_totals_cache.items():
            required = mask.get(role, 0)
            if required <= 0:
                continue
            role_avg = role_total / required
            if role in role_sums:
                role_sums[role] += role_avg
                role_sums2[role] += role_avg * role_avg
                role_counts[role] += 1
            else:
                role_sums[role] = role_avg
                role_sums2[role] = role_avg * role_avg
                role_counts[role] = 1

        if t._cached_role_spread_counted:
            total_role_spread += t._cached_role_spread_var
            counted_spread_teams += 1

    inter_team_std = _sample_stdev_from_sums(sum_mmr, sum_mmr2, n)
    total_rating_std = _sample_stdev_from_sums(sum_total, sum_total2, n)
    avg_discomfort = sum_discomfort / n
    avg_intra_std = sum_intra_std / n
    max_team_gap = max_team_total - min_team_total if n >= 2 else 0.0
    gap_penalty = calculate_gap_penalty(max_team_gap)

    total_role_balance = 0.0
    counted_roles = 0
    for role, count in role_counts.items():
        if count >= 2:
            total_role_balance += _sample_stdev_from_sums(role_sums[role], role_sums2[role], count)
            counted_roles += 1

    role_balance_penalty = total_role_balance / counted_roles if counted_roles else 0.0
    role_spread_penalty = total_role_spread / counted_spread_teams if counted_spread_teams else 0.0

    return (
        total_rating_std * config.TEAM_TOTAL_STD_WEIGHT
        + gap_penalty * config.MAX_TEAM_GAP_WEIGHT
        + inter_team_std * config.MMR_DIFF_WEIGHT
        + avg_discomfort * config.DISCOMFORT_WEIGHT
        + avg_intra_std * config.INTRA_TEAM_VAR_WEIGHT
        + global_max_pain * config.MAX_DISCOMFORT_WEIGHT
        + role_balance_penalty * config.ROLE_BALANCE_WEIGHT
        + role_spread_penalty * config.ROLE_SPREAD_WEIGHT
        + sum_subrole_collisions * config.SUBROLE_COLLISION_WEIGHT
    )


def calculate_objectives(teams: list[Team], config: AlgorithmConfig) -> tuple[float, float]:
    """
    Split the scalar cost into a (balance, comfort) tuple for multi-objective
    optimization.

    Returns
    -------
    (objective_balance, objective_comfort)
        * objective_balance — matchup fairness (rating std, gap, role-line
          balance, role spread, intra-team variance).
        * objective_comfort — player comfort (discomfort, worst pain, subclass
          collisions).
    """
    if not teams:
        return (float("inf"), float("inf"))

    n = len(teams)
    mask = config.DEFAULT_MASK

    sum_mmr = 0.0
    sum_mmr2 = 0.0
    sum_total = 0.0
    sum_total2 = 0.0
    sum_discomfort = 0.0
    sum_intra_std = 0.0
    sum_subrole_collisions = 0
    global_max_pain = 0

    min_team_total = float("inf")
    max_team_total = float("-inf")

    role_sums: dict[str, float] = {}
    role_sums2: dict[str, float] = {}
    role_counts: dict[str, int] = {}

    total_role_spread = 0.0
    counted_spread_teams = 0

    for t in teams:
        t.calculate_stats()

        team_mmr = t._cached_mmr
        team_total = t._cached_total_rating

        sum_mmr += team_mmr
        sum_mmr2 += team_mmr * team_mmr
        sum_total += team_total
        sum_total2 += team_total * team_total
        sum_discomfort += t._cached_discomfort
        sum_intra_std += t._cached_intra_std
        sum_subrole_collisions += t._cached_subrole_collisions

        if team_total < min_team_total:
            min_team_total = team_total
        if team_total > max_team_total:
            max_team_total = team_total

        if t._cached_max_pain > global_max_pain:
            global_max_pain = t._cached_max_pain

        # Cached role totals avoid the inner player loop on the hot path.
        role_totals_cache = t._cached_role_totals
        for role, role_total in role_totals_cache.items():
            required = mask.get(role, 0)
            if required <= 0:
                continue
            role_avg = role_total / required
            if role in role_sums:
                role_sums[role] += role_avg
                role_sums2[role] += role_avg * role_avg
                role_counts[role] += 1
            else:
                role_sums[role] = role_avg
                role_sums2[role] = role_avg * role_avg
                role_counts[role] = 1

        if t._cached_role_spread_counted:
            total_role_spread += t._cached_role_spread_var
            counted_spread_teams += 1

    inter_team_std = _sample_stdev_from_sums(sum_mmr, sum_mmr2, n)
    total_rating_std = _sample_stdev_from_sums(sum_total, sum_total2, n)
    avg_discomfort = sum_discomfort / n
    avg_intra_std = sum_intra_std / n
    max_team_gap = max_team_total - min_team_total if n >= 2 else 0.0
    gap_penalty = calculate_gap_penalty(max_team_gap)

    total_role_balance = 0.0
    counted_roles = 0
    for role, cnt in role_counts.items():
        if cnt >= 2:
            total_role_balance += _sample_stdev_from_sums(role_sums[role], role_sums2[role], cnt)
            counted_roles += 1

    role_balance_penalty = total_role_balance / counted_roles if counted_roles else 0.0
    role_spread_penalty = total_role_spread / counted_spread_teams if counted_spread_teams else 0.0

    objective_balance = (
        total_rating_std * config.TEAM_TOTAL_STD_WEIGHT
        + gap_penalty * config.MAX_TEAM_GAP_WEIGHT
        + inter_team_std * config.MMR_DIFF_WEIGHT
        + avg_intra_std * config.INTRA_TEAM_VAR_WEIGHT
        + role_balance_penalty * config.ROLE_BALANCE_WEIGHT
        + role_spread_penalty * config.ROLE_SPREAD_WEIGHT
    )

    objective_comfort = (
        avg_discomfort * config.DISCOMFORT_WEIGHT
        + global_max_pain * config.MAX_DISCOMFORT_WEIGHT
        + sum_subrole_collisions * config.SUBROLE_COLLISION_WEIGHT
    )

    return (objective_balance, objective_comfort)


# --- Utility Functions ---


def parse_player_node(
    uuid: str, data: dict[str, typing.Any], mask: dict[str, int], role_mapping: dict[str, str] | None = None
) -> Player | None:
    """Parse player data from input dictionary."""
    try:
        identity = data.get("identity", {})
        name = identity.get("name", "Unknown")
        is_flex = bool(identity.get("isFullFlex", False))
        raw_classes = data.get("stats", {}).get("classes", {})
        ratings = {}
        role_priorities = []
        subclasses: dict[str, str] = {}

        for json_role, stats in raw_classes.items():
            if not stats.get("isActive", False):
                continue
            rank = stats.get("rank", 0)
            if rank <= 0:
                continue
            algo_role = role_mapping.get(json_role) if role_mapping else json_role
            if not algo_role or algo_role not in mask:
                continue
            ratings[algo_role] = rank
            priority = stats.get("priority", 99)
            role_priorities.append((priority, algo_role))
            subtype = stats.get("subtype") or ""
            if subtype:
                subclasses[algo_role] = subtype

        if not ratings:
            return None

        role_priorities.sort(key=lambda x: x[0])
        preferences = [r for _, r in role_priorities]
        return Player(name, ratings, preferences, uuid, mask, is_flex=is_flex, subclasses=subclasses)
    except Exception as e:
        logger.warning(f"Failed to parse player {uuid}: {e}")
        return None


def load_players_from_dict(
    data: dict[str, typing.Any], mask: dict[str, int], role_mapping: dict[str, str] | None = None
) -> list[Player]:
    """Load players from dictionary (from JSON input)."""
    players_list = []
    try:
        players_dict = None

        if "format" in data and data.get("format") == "xv-1" and "players" in data:
            players_dict = data["players"]
        elif "data" in data:
            data_root = data.get("data", {})
            if "data" in data_root and "players" in data_root["data"]:
                players_dict = data_root["data"]["players"]
            elif "players" in data_root:
                players_dict = data_root["players"]
        elif "players" in data:
            players_dict = data["players"]

        if players_dict is None:
            logger.error(f"Could not find players data in input. Available keys: {list(data.keys())}")
            raise ValueError("Could not find players data in input")

        for uuid, p_data in players_dict.items():
            p = parse_player_node(uuid, p_data, mask, role_mapping)
            if p:
                players_list.append(p)

        logger.info(f"Loaded {len(players_list)} valid players from {len(players_dict)} total")
    except Exception as e:
        logger.error(f"Error loading players: {e}")
        raise ValueError(f"Error loading players: {e}")

    return players_list


def assign_captains(players: list[Player], count: int, mask: dict[str, int] | None = None) -> None:
    """
    Mark the top-``count`` players (by max rating) as captains and pin their
    role to their top playable preference.

    Captains are anchor points: once pinned, their role is frozen across every
    solution, mutation, and polish pass. ``mask`` is optional — when supplied,
    the pinned role is required to be an active mask role; otherwise the
    pinning falls back to any playable role from ratings.
    """
    active_roles = {r for r, c in (mask or {}).items() if c > 0} if mask else None

    for p in players:
        p.is_captain = False
        p.captain_role = None

    sorted_players = sorted(players, key=lambda p: p.max_rating, reverse=True)
    for i in range(min(count, len(sorted_players))):
        p = sorted_players[i]
        p.is_captain = True

        pinned_role: str | None = None
        # Prefer captain's top preference if it is both playable and part of
        # the active mask (if provided).
        for role in p.preferences:
            if not p.can_play(role):
                continue
            if active_roles is not None and role not in active_roles:
                continue
            pinned_role = role
            break

        if pinned_role is None:
            # Fallback: any playable role within the active mask.
            for role, _rating in p.ratings.items():
                if active_roles is not None and role not in active_roles:
                    continue
                pinned_role = role
                break

        p.captain_role = pinned_role


def find_feasible_role_assignment(
    players: list[Player],
    num_teams: int,
    mask: dict[str, int],
) -> dict[str, str] | None:
    """
    Find a feasible ``player_uuid -> role`` assignment respecting role capacities
    (``mask[role] * num_teams``) and each player's ``can_play`` constraint.

    Captains are **pinned** to ``player.captain_role`` before matching begins
    and are never displaced. Only non-captains participate in the augmenting
    search, ensuring captain roles stay frozen across every generated solution.

    Uses the classical Hungarian-style augmenting-path algorithm (bipartite
    matching with capacities), so it succeeds whenever **any** complete
    assignment exists (Hall's theorem). Returns ``None`` when the input is
    infeasible — e.g. not enough tank-capable players for the required number
    of tank slots, or too many captains pinned to the same role.

    The ``visited`` set tracks which *roles* have been touched during a single
    augmenting DFS. This prevents a subtle bug where evicting an occupant from
    role R temporarily frees one of its slots, and a recursive call would
    happily reassign the occupant right back to R — leading to double-counted
    assignments that exceed role capacity.

    Randomization is applied inside augmenting DFS to produce diverse but
    always complete seeds across multiple calls.
    """
    active_mask = {r: c for r, c in mask.items() if c > 0}
    if not active_mask:
        return None

    capacity = {r: c * num_teams for r, c in active_mask.items()}
    total_needed = sum(capacity.values())
    if total_needed != len(players):
        # Caller promises exact input sizing.
        return None

    assignment: dict[int, str] = {}  # player_index -> role
    role_counts: dict[str, int] = {r: 0 for r in active_mask}
    # Reverse index of role -> set of player indices currently assigned to it.
    # Maintained alongside `assignment` so that eviction does not need to scan
    # the whole assignment dict every time.
    role_occupants: dict[str, set[int]] = {r: set() for r in active_mask}

    # --- Stage 1: pin captains to their frozen captain_role.
    captain_indices: set[int] = set()
    for idx, player in enumerate(players):
        if not player.is_captain:
            continue
        captain_indices.add(idx)
        role = player.captain_role
        if role is None or role not in active_mask or not player.can_play(role):
            logger.error(
                f"Captain {player.name} (uuid={player.uuid}) has no valid "
                f"captain_role (captain_role={role!r}, can_play="
                f"{list(player.ratings)}, active_mask={list(active_mask)})."
            )
            return None
        if role_counts[role] >= capacity[role]:
            logger.error(
                f"Too many captains pinned to role '{role}': capacity "
                f"{capacity[role]} already filled when placing captain "
                f"{player.name}."
            )
            return None
        assignment[idx] = role
        role_counts[role] += 1
        role_occupants[role].add(idx)

    def candidates_for(player: Player) -> list[str]:
        roles = [r for r in active_mask if player.can_play(r)]
        random.shuffle(roles)
        pref_index = {role: idx for idx, role in enumerate(player.preferences)}
        # Preference-aware: top-preference first, keeps seeds close to "players
        # on their main" while still letting matching satisfy feasibility.
        roles.sort(key=lambda r: pref_index.get(r, len(player.preferences)))
        return roles

    def try_assign(player_idx: int, visited_roles: set[str]) -> bool:
        player = players[player_idx]

        for role in candidates_for(player):
            if role in visited_roles:
                continue
            visited_roles.add(role)

            # Case A: role has spare capacity — take it directly.
            if role_counts[role] < capacity[role]:
                assignment[player_idx] = role
                role_counts[role] += 1
                role_occupants[role].add(player_idx)
                return True

            # Case B: role is full — try to reroute a *non-captain* occupant.
            # Captains are pinned and cannot be moved, which guarantees the
            # caller's invariant that captain roles stay frozen.
            occupants = [i for i in role_occupants[role] if i not in captain_indices]
            random.shuffle(occupants)
            for occ_idx in occupants:
                # Tentatively evict the occupant.
                role_occupants[role].discard(occ_idx)
                del assignment[occ_idx]
                role_counts[role] -= 1

                if try_assign(occ_idx, visited_roles):
                    # Occupant moved to some other role; we claim the freed
                    # slot. role_counts[role] was decremented above; restore it
                    # with our own placement.
                    assignment[player_idx] = role
                    role_counts[role] += 1
                    role_occupants[role].add(player_idx)
                    return True

                # Revert: occupant stays where they were.
                assignment[occ_idx] = role
                role_counts[role] += 1
                role_occupants[role].add(occ_idx)
        return False

    # --- Stage 2: match non-captains via augmenting paths.
    non_captain_order = [i for i in range(len(players)) if i not in captain_indices]
    random.shuffle(non_captain_order)
    for idx in non_captain_order:
        if not try_assign(idx, set()):
            return None

    # Consistency check — must always hold if the algorithm is correct. Cheap
    # enough (O(R)) to leave in production and surface any future regression.
    for role, expected in capacity.items():
        if role_counts[role] != expected or len(role_occupants[role]) != expected:
            logger.error(
                f"find_feasible_role_assignment internal invariant violated: "
                f"role={role} counts={role_counts[role]} occupants={len(role_occupants[role])} "
                f"expected={expected}."
            )
            return None

    return {players[i].uuid: r for i, r in assignment.items()}


def diagnose_role_shortage(
    players: list[Player],
    num_teams: int,
    mask: dict[str, int],
) -> dict[str, int]:
    """
    Per-role quick capacity audit. Returns ``{role: shortage}`` where
    ``shortage > 0`` means not enough ``can_play`` players for ``num_teams``
    slots. This is a necessary condition for feasibility; Hall-style global
    feasibility is covered by :func:`find_feasible_role_assignment`.
    """
    shortages: dict[str, int] = {}
    for role, count in mask.items():
        if count <= 0:
            continue
        capable = sum(1 for p in players if p.can_play(role))
        needed = count * num_teams
        if capable < needed:
            shortages[role] = needed - capable
    return shortages


def create_random_solution(
    players: list[Player],
    num_teams: int,
    mask: dict[str, int],
    use_captains: bool,
    role_assignment: dict[str, str] | None = None,
) -> list[Team]:
    """
    Build a **complete** random team assignment: every team is always full
    whenever the input is feasible. The algorithm has two stages:

    1. Feasibility stage — resolve a ``player → role`` assignment via bipartite
       matching (see :func:`find_feasible_role_assignment`). Callers may pass a
       precomputed assignment to speed up population seeding; each call still
       randomizes the team placement for diversity.
    2. Team placement stage — shuffle players within each role bucket and
       round-robin them across teams, honoring ``is_captain`` so that every
       team gets exactly one captain when ``use_captains`` is set.

    An empty roster list is returned when the input is infeasible; callers
    must treat that as a hard error.
    """
    teams = [Team(i + 1, mask) for i in range(num_teams)]
    if num_teams <= 0 or not players:
        return teams

    if role_assignment is None:
        role_assignment = find_feasible_role_assignment(players, num_teams, mask)
    if role_assignment is None:
        # Caller is expected to surface the error with diagnose_role_shortage().
        return teams

    # Bucket players by their resolved role, separating captains for
    # deterministic "one-captain-per-team" distribution.
    buckets: dict[str, list[Player]] = {r: [] for r in mask if mask[r] > 0}
    captain_buckets: dict[str, list[Player]] = {r: [] for r in buckets}
    for p in players:
        role = role_assignment.get(p.uuid)
        if role is None or role not in buckets:
            # Player not included in assignment (should not happen) — skip.
            continue
        if use_captains and p.is_captain:
            captain_buckets[role].append(p)
        else:
            buckets[role].append(p)

    for role_list in buckets.values():
        random.shuffle(role_list)
    for role_list in captain_buckets.values():
        random.shuffle(role_list)

    # Place captains first: one per team, on their pre-assigned role.
    if use_captains:
        captains_flat: list[tuple[str, Player]] = []
        for role, lst in captain_buckets.items():
            for cap in lst:
                captains_flat.append((role, cap))
        random.shuffle(captains_flat)

        team_cursor = 0
        for role, cap in captains_flat:
            placed = False
            # Scan every team at most once to find a slot that still has room
            # on this role.
            for _ in range(num_teams):
                team = teams[team_cursor % num_teams]
                team_cursor += 1
                if len(team.roster[role]) < mask[role]:
                    team.add_player(role, cap)
                    placed = True
                    break
            if not placed:
                # Role capacity across all teams is exhausted — fall back to
                # the non-captain bucket to keep the roster full.
                buckets[role].append(cap)

    # Distribute the rest round-robin, one player at a time, to keep team
    # loads balanced and roles filled evenly.
    for role, bucket in buckets.items():
        if not bucket:
            continue
        team_cursor = 0
        while bucket:
            placed = False
            for _ in range(num_teams):
                team = teams[team_cursor % num_teams]
                team_cursor += 1
                if len(team.roster[role]) < mask[role]:
                    team.add_player(role, bucket.pop())
                    placed = True
                    break
            if not placed:
                # No team can take more of this role — remaining players are
                # excess (should not happen if role_assignment is consistent
                # with capacities).
                break

    return teams


def _swap_players_in_place(
    teams: list[Team],
    team_a_idx: int,
    role_a: str,
    slot_a: int,
    team_b_idx: int,
    role_b: str,
    slot_b: int,
    copied: list[bool],
) -> None:
    """Helper for targeted mutation: performs a swap with copy-on-write."""
    if not copied[team_a_idx]:
        teams[team_a_idx] = teams[team_a_idx].copy()
        copied[team_a_idx] = True
    if team_b_idx != team_a_idx and not copied[team_b_idx]:
        teams[team_b_idx] = teams[team_b_idx].copy()
        copied[team_b_idx] = True

    t_a = teams[team_a_idx]
    t_b = teams[team_b_idx]
    player_a = t_a.roster[role_a][slot_a]
    player_b = t_b.roster[role_b][slot_b]
    t_a.replace_player(role_a, slot_a, player_b)
    t_b.replace_player(role_b, slot_b, player_a)


def _strategy_robin_hood(
    teams: list[Team],
    mask: dict[str, int],
    available_roles: list[str],
    copied: list[bool],
    use_captains: bool,
) -> bool:
    """
    Swap the strongest player from the richest team with the weakest player
    from the poorest team on the same role, guarded by the total-rating gap.
    """
    if len(teams) < 2 or not available_roles:
        return False

    totals = [t.total_rating for t in teams]
    max_idx = max(range(len(teams)), key=lambda i: totals[i])
    min_idx = min(range(len(teams)), key=lambda i: totals[i])
    if max_idx == min_idx:
        return False

    original_gap = totals[max_idx] - totals[min_idx]
    if original_gap <= 0:
        return False

    roles_shuffled = available_roles[:]
    random.shuffle(roles_shuffled)

    for role in roles_shuffled:
        rich_roster = teams[max_idx].roster.get(role, [])
        poor_roster = teams[min_idx].roster.get(role, [])
        if not rich_roster or not poor_roster:
            continue

        rich_sorted = sorted(
            range(len(rich_roster)),
            key=lambda i: rich_roster[i].get_rating(role),
            reverse=True,
        )
        poor_sorted = sorted(
            range(len(poor_roster)),
            key=lambda i: poor_roster[i].get_rating(role),
        )

        for ri in rich_sorted:
            strongest = rich_roster[ri]
            if use_captains and strongest.is_captain:
                continue
            for pj in poor_sorted:
                weakest = poor_roster[pj]
                if use_captains and weakest.is_captain:
                    continue
                # Only accept strict improvement of the rating gap.
                delta = strongest.get_rating(role) - weakest.get_rating(role)
                if delta <= 0:
                    continue
                new_rich_total = totals[max_idx] - delta
                new_poor_total = totals[min_idx] + delta
                new_gap_candidate = abs(new_rich_total - new_poor_total)
                # Other teams stay the same — their contribution to the true gap
                # is bounded by the existing max/min, so we guard conservatively.
                new_gap = max(new_gap_candidate, 0.0)
                for k, v in enumerate(totals):
                    if k in (max_idx, min_idx):
                        continue
                    other_gap = max(v, new_rich_total, new_poor_total) - min(
                        v, new_rich_total, new_poor_total
                    )
                    if other_gap > new_gap:
                        new_gap = other_gap
                if new_gap >= original_gap:
                    continue
                _swap_players_in_place(
                    teams, max_idx, role, ri, min_idx, role, pj, copied
                )
                return True
    return False


def _strategy_fix_worst_discomfort(
    teams: list[Team],
    mask: dict[str, int],
    available_roles: list[str],
    copied: list[bool],
    use_captains: bool,
) -> bool:
    """
    Find the player with worst discomfort (off-role / cannot-play) and swap them
    with a player in another team whose top preference matches the current role.
    """
    if len(teams) < 2:
        return False

    # Collect all painful (team, role, slot, discomfort) entries.
    painful: list[tuple[int, str, int, int]] = []
    for t_idx, team in enumerate(teams):
        for role, players in team.roster.items():
            for slot, p in enumerate(players):
                if use_captains and p.is_captain:
                    continue
                d = p.get_discomfort(role)
                if d >= 1000:
                    painful.append((t_idx, role, slot, d))

    if not painful:
        return False

    painful.sort(key=lambda x: x[3], reverse=True)

    for src_team_idx, src_role, src_slot, src_disc in painful:
        src_player = teams[src_team_idx].roster[src_role][src_slot]

        for dst_team_idx, dst_team in enumerate(teams):
            if dst_team_idx == src_team_idx:
                continue
            for dst_role, dst_players in dst_team.roster.items():
                for dst_slot, dst_player in enumerate(dst_players):
                    if use_captains and dst_player.is_captain:
                        continue
                    # Candidate matches src's role as its top preference.
                    if not dst_player.preferences or dst_player.preferences[0] != src_role:
                        continue
                    # And src must be able to play dst_role (otherwise just pushes pain).
                    if not src_player.can_play(dst_role):
                        continue

                    new_src_disc = src_player.get_discomfort(dst_role)
                    new_dst_disc = dst_player.get_discomfort(src_role)
                    old_disc = src_disc + dst_player.get_discomfort(dst_role)
                    new_disc = new_src_disc + new_dst_disc
                    if new_disc >= old_disc:
                        continue
                    _swap_players_in_place(
                        teams, src_team_idx, src_role, src_slot,
                        dst_team_idx, dst_role, dst_slot, copied,
                    )
                    return True
    return False


def _strategy_role_line_rebalance(
    teams: list[Team],
    mask: dict[str, int],
    available_roles: list[str],
    copied: list[bool],
    use_captains: bool,
) -> bool:
    """
    Identify the role with the largest rating spread across teams and swap the
    weakest slot on the strongest line with the strongest slot on the weakest
    line. Guarded by the role-line stdev.
    """
    if len(teams) < 2 or not available_roles:
        return False

    best_role: str | None = None
    best_stdev = 0.0
    best_team_avgs: list[tuple[int, float]] = []

    for role in available_roles:
        team_avgs: list[tuple[int, float]] = []
        for t_idx, team in enumerate(teams):
            players = team.roster.get(role, [])
            if not players:
                continue
            total = sum(p.get_rating(role) for p in players)
            team_avgs.append((t_idx, total / len(players)))
        if len(team_avgs) < 2:
            continue
        avgs_only = [a for _, a in team_avgs]
        mean = sum(avgs_only) / len(avgs_only)
        var = sum((a - mean) ** 2 for a in avgs_only) / (len(avgs_only) - 1)
        stdev = math.sqrt(var) if var > 0 else 0.0
        if stdev > best_stdev:
            best_stdev = stdev
            best_role = role
            best_team_avgs = team_avgs

    if best_role is None or best_stdev <= 0:
        return False

    best_team_avgs.sort(key=lambda x: x[1])
    weak_team_idx = best_team_avgs[0][0]
    strong_team_idx = best_team_avgs[-1][0]
    if weak_team_idx == strong_team_idx:
        return False

    strong_roster = teams[strong_team_idx].roster[best_role]
    weak_roster = teams[weak_team_idx].roster[best_role]
    if not strong_roster or not weak_roster:
        return False

    strong_sorted = sorted(
        range(len(strong_roster)),
        key=lambda i: strong_roster[i].get_rating(best_role),
    )  # weakest first in the strong team
    weak_sorted = sorted(
        range(len(weak_roster)),
        key=lambda i: weak_roster[i].get_rating(best_role),
        reverse=True,
    )  # strongest first in the weak team

    # Recompute stdev hypothetically and pick first pair giving strict improvement.
    for si in strong_sorted:
        strong_player = strong_roster[si]
        if use_captains and strong_player.is_captain:
            continue
        for wi in weak_sorted:
            weak_player = weak_roster[wi]
            if use_captains and weak_player.is_captain:
                continue
            delta_strong = weak_player.get_rating(best_role) - strong_player.get_rating(best_role)
            delta_weak = -delta_strong
            # Strong team should drop, weak team should rise — i.e. weak_player
            # must be stronger than strong_player in that role.
            if delta_strong >= 0:
                continue
            # Build hypothetical averages after swap.
            new_avgs = []
            for t_idx, avg in best_team_avgs:
                if t_idx == strong_team_idx:
                    team_len = len(teams[t_idx].roster[best_role])
                    new_avgs.append(avg + delta_strong / team_len)
                elif t_idx == weak_team_idx:
                    team_len = len(teams[t_idx].roster[best_role])
                    new_avgs.append(avg + delta_weak / team_len)
                else:
                    new_avgs.append(avg)
            mean = sum(new_avgs) / len(new_avgs)
            var = sum((a - mean) ** 2 for a in new_avgs) / (len(new_avgs) - 1)
            new_stdev = math.sqrt(var) if var > 0 else 0.0
            if new_stdev >= best_stdev:
                continue
            _swap_players_in_place(
                teams, strong_team_idx, best_role, si,
                weak_team_idx, best_role, wi, copied,
            )
            return True
    return False


def mutate_targeted(
    teams: list[Team],
    mask: dict[str, int],
    mutation_strength: int,
    config: AlgorithmConfig,
    use_captains: bool,
) -> list[Team]:
    """
    Smart mutation that mixes four strategies with probabilities
    ``[0.35, 0.35, 0.2, 0.1]``:

    * Robin Hood — level rating between richest/poorest team.
    * Fix worst discomfort — relocate an off-role player.
    * Role-line rebalance — balance a role across teams.
    * Random shake — fall back to the legacy ``mutate`` (single random swap).

    Each strategy has its own guard and only commits a swap that improves the
    relevant local metric. Failing strategies fall back to the random shake as
    a safety net, so ``mutation_strength`` is still respected.
    """
    new_teams_list = list(teams)
    copied = [False] * len(new_teams_list)
    available_roles = [r for r, c in mask.items() if c > 0]
    if not available_roles or len(new_teams_list) < 2:
        return new_teams_list

    strategies = (
        _strategy_robin_hood,
        _strategy_fix_worst_discomfort,
        _strategy_role_line_rebalance,
    )
    weights = (0.35, 0.35, 0.2)
    # Remainder (0.1) goes to the random shake branch.

    for _ in range(mutation_strength):
        roll = random.random()
        cumulative = 0.0
        applied = False

        for strat, prob in zip(strategies, weights):
            cumulative += prob
            if roll < cumulative:
                applied = strat(new_teams_list, mask, available_roles, copied, use_captains)
                break
        if applied:
            continue

        # Random shake fallback — reuse legacy mutate semantics for one attempt.
        shaken = mutate(new_teams_list, mask, 1, use_captains)
        # ``mutate`` already performs copy-on-write internally. Ensure our
        # ``copied`` mask stays in sync so subsequent strategies don't trash
        # references shared with previous generations.
        for idx, team in enumerate(shaken):
            if team is not new_teams_list[idx]:
                new_teams_list[idx] = team
                copied[idx] = True

    return new_teams_list


def polish(
    teams: list[Team],
    config: AlgorithmConfig,
    mask: dict[str, int],
    use_captains: bool,
    max_passes: int = 5,
) -> list[Team]:
    """
    Deterministic 2-opt hill-climbing: systematically try every feasible
    cross-team swap and accept only strict cost improvements. Terminates once a
    full sweep yields no improvement or ``max_passes`` is reached.
    """
    current = [t.copy() for t in teams]
    best_cost = calculate_cost(current, config)
    available_roles = [r for r, c in mask.items() if c > 0]
    if not available_roles or len(current) < 2:
        return current

    n = len(current)
    for _ in range(max_passes):
        improved = False
        for i in range(n):
            team_i = current[i]
            for j in range(i + 1, n):
                team_j = current[j]
                for role in available_roles:
                    roster_i = team_i.roster.get(role, [])
                    roster_j = team_j.roster.get(role, [])
                    if not roster_i or not roster_j:
                        continue
                    for a in range(len(roster_i)):
                        pa = roster_i[a]
                        if use_captains and pa.is_captain:
                            continue
                        if not pa.can_play(role):
                            continue
                        pa_rating = pa.get_rating(role)
                        pa_disc = pa.get_discomfort(role)
                        pa_sub = pa.subclasses.get(role)
                        for b in range(len(roster_j)):
                            pb = roster_j[b]
                            if use_captains and pb.is_captain:
                                continue
                            if not pb.can_play(role):
                                continue
                            # Skip no-op swaps: if ratings, discomfort and
                            # subclass all match, the cost cannot change so
                            # the full calculate_cost round-trip is pure
                            # overhead. ~15-25% of inner iterations on typical
                            # tournament pools.
                            if (
                                pa_rating == pb.get_rating(role)
                                and pa_disc == pb.get_discomfort(role)
                                and pa_sub == pb.subclasses.get(role)
                            ):
                                continue

                            # Swap, re-cost, accept only strict improvement.
                            team_i.replace_player(role, a, pb)
                            team_j.replace_player(role, b, pa)
                            new_cost = calculate_cost(current, config)
                            if new_cost < best_cost - 1e-9:
                                best_cost = new_cost
                                improved = True
                                # Refresh loop-local references: pa, roster_i,
                                # roster_j stay valid because add/replace only
                                # mutates existing list entries in place.
                                pa = pb
                                pa_rating = pa.get_rating(role)
                                pa_disc = pa.get_discomfort(role)
                                pa_sub = pa.subclasses.get(role)
                            else:
                                # Revert
                                team_i.replace_player(role, a, pa)
                                team_j.replace_player(role, b, pb)
        if not improved:
            break

    return current


def mutate(teams: list[Team], mask: dict[str, int], mutation_strength: int, use_captains: bool) -> list[Team]:
    """Apply mutations to team configuration."""
    new_teams_list = list(teams)
    copied = [False] * len(new_teams_list)

    def ensure_copy(idx: int) -> None:
        if copied[idx]:
            return
        new_teams_list[idx] = new_teams_list[idx].copy()
        copied[idx] = True

    available_roles = [r for r, c in mask.items() if c > 0]
    if not available_roles:
        return new_teams_list

    team_count = len(new_teams_list)
    if team_count < 2:
        return new_teams_list

    for _ in range(mutation_strength):
        if random.random() < 0.8:
            role = random.choice(available_roles)

            t1_idx, t2_idx = random.sample(range(team_count), 2)
            t1 = new_teams_list[t1_idx]
            t2 = new_teams_list[t2_idx]
            r1_list = t1.roster[role]
            r2_list = t2.roster[role]

            if not r1_list or not r2_list:
                continue

            idx1 = random.randrange(len(r1_list))
            idx2 = random.randrange(len(r2_list))
            p1 = r1_list[idx1]
            p2 = r2_list[idx2]

            if use_captains and (p1.is_captain or p2.is_captain):
                continue

            ensure_copy(t1_idx)
            ensure_copy(t2_idx)
            new_teams_list[t1_idx].replace_player(role, idx1, p2)
            new_teams_list[t2_idx].replace_player(role, idx2, p1)
        else:
            if len(available_roles) < 2:
                continue

            t_idx = random.randrange(team_count)
            t = new_teams_list[t_idx]
            r1, r2 = random.sample(available_roles, 2)

            roster_r1 = t.roster[r1]
            roster_r2 = t.roster[r2]
            if not roster_r1 or not roster_r2:
                continue

            cand_r1 = [i for i, p in enumerate(roster_r1) if p.can_play(r2) and (not use_captains or not p.is_captain)]
            cand_r2 = [i for i, p in enumerate(roster_r2) if p.can_play(r1) and (not use_captains or not p.is_captain)]

            if not cand_r1 or not cand_r2:
                continue

            i1 = random.choice(cand_r1)
            i2 = random.choice(cand_r2)
            p1 = roster_r1[i1]
            p2 = roster_r2[i2]

            if use_captains and (p1.is_captain or p2.is_captain):
                continue

            ensure_copy(t_idx)
            t2 = new_teams_list[t_idx]
            t2.replace_player(r1, i1, p2)
            t2.replace_player(r2, i2, p1)

    return new_teams_list


class GeneticOptimizer:
    """Genetic algorithm optimizer for team balancing."""

    def __init__(
        self,
        players: list[Player],
        num_teams: int,
        config: AlgorithmConfig,
        progress_callback: ProgressCallback | None = None,
        role_assignment: dict[str, str] | None = None,
    ) -> None:
        self.players = players
        self.num_teams = num_teams
        self.config = config
        self.population: list[tuple[float, list[Team]]] = []
        self.mask = config.DEFAULT_MASK
        self.progress_callback = progress_callback
        # Pre-computed feasibility-proven role assignment, produced once by
        # balance_teams(). Reusing it saves O(POPULATION_SIZE) bipartite
        # matching calls at initialization. Team placement randomization still
        # provides population diversity.
        self.role_assignment = role_assignment

    def run(self) -> list[Team]:
        """Run the genetic algorithm optimization."""
        start_time = time.time()

        emit_progress(
            self.progress_callback,
            status="running",
            stage="initializing_population",
            message=f"Initializing population ({self.config.POPULATION_SIZE} solutions)",
        )
        logger.info(f"Initializing population with {self.config.POPULATION_SIZE} solutions...")

        # Post-feasibility-check: create_random_solution is guaranteed to return
        # complete rosters (balance_teams() already verified Hall-feasibility).
        # We still assert fullness defensively — a partial team here is a bug in
        # the matcher, not an input issue, and must surface loudly.
        attempts = 0
        max_attempts = self.config.POPULATION_SIZE * 4

        while len(self.population) < self.config.POPULATION_SIZE and attempts < max_attempts:
            sol = create_random_solution(
                self.players,
                self.num_teams,
                self.mask,
                self.config.USE_CAPTAINS,
                role_assignment=self.role_assignment,
            )
            attempts += 1
            if not all(t.is_full() for t in sol):
                missing = {}
                for team in sol:
                    for role, count in self.mask.items():
                        shortage = count - len(team.roster.get(role, []))
                        if shortage > 0:
                            missing[role] = missing.get(role, 0) + shortage
                raise RuntimeError(
                    f"create_random_solution produced an incomplete roster for "
                    f"{self.num_teams} teams (missing slots: {missing}). "
                    f"This indicates a matcher bug — balance_teams() already "
                    f"confirmed feasibility before reaching the optimizer."
                )
            self.population.append((calculate_cost(sol, self.config), sol))

        if not self.population:
            raise ValueError(
                f"Population initialization failed after {attempts} attempts "
                f"for {self.num_teams} teams and {len(self.players)} players."
            )

        logger.info(f"Starting evolution for {self.config.GENERATIONS} generations...")
        emit_progress(
            self.progress_callback,
            status="running",
            stage="evolving",
            message=f"Starting evolution ({self.config.GENERATIONS} generations)",
            progress={"current": 0, "total": self.config.GENERATIONS, "percent": 0.0},
        )

        elite_count = max(1, int(self.config.POPULATION_SIZE * self.config.ELITISM_RATE))
        stagnation_threshold = max(1, self.config.STAGNATION_THRESHOLD)
        last_improved_gen = 0
        last_best_cost = float("inf")

        for gen in range(self.config.GENERATIONS):
            self.population.sort(key=lambda x: x[0])

            current_best = self.population[0][0]
            if current_best < last_best_cost - 1e-6:
                last_best_cost = current_best
                last_improved_gen = gen

            if gen % 25 == 0:
                best_cost = current_best
                logger.debug(f"Generation {gen:03d} | Best cost: {best_cost:.2f}")
                total_generations = max(self.config.GENERATIONS, 1)
                emit_progress(
                    self.progress_callback,
                    status="running",
                    stage="evolving",
                    message=f"Generation {gen}/{self.config.GENERATIONS}, best cost {best_cost:.2f}",
                    progress={
                        "current": gen,
                        "total": total_generations,
                        "percent": round((gen / total_generations) * 100, 2),
                    },
                )

            if current_best <= 0.1:
                logger.info(f"Optimal solution found at generation {gen}")
                emit_progress(
                    self.progress_callback,
                    status="running",
                    stage="evolving",
                    message=f"Early stop at generation {gen} (cost {current_best:.2f})",
                    progress={
                        "current": gen,
                        "total": self.config.GENERATIONS,
                        "percent": round((gen / max(self.config.GENERATIONS, 1)) * 100, 2),
                    },
                )
                break

            # Stagnation restart: reseed the bottom 70% of the population
            # (elite preserved) when no improvement is observed for a while.
            if gen - last_improved_gen >= stagnation_threshold:
                keep = max(elite_count, int(self.config.POPULATION_SIZE * 0.3))
                kept = self.population[:keep]
                new_population = list(kept)
                # On stagnation, recompute a fresh role assignment 50% of the
                # time to escape basins of attraction that share structure with
                # the cached assignment.
                restart_assignment = (
                    None
                    if random.random() < 0.5
                    else self.role_assignment
                )
                while len(new_population) < self.config.POPULATION_SIZE:
                    sol = create_random_solution(
                        self.players,
                        self.num_teams,
                        self.mask,
                        self.config.USE_CAPTAINS,
                        role_assignment=restart_assignment,
                    )
                    # Feasibility already guaranteed by balance_teams()/matcher;
                    # any incomplete roster here means a matcher bug — surface it.
                    if not all(t.is_full() for t in sol):
                        missing = {}
                        for team in sol:
                            for role, count in self.mask.items():
                                shortage = count - len(team.roster.get(role, []))
                                if shortage > 0:
                                    missing[role] = missing.get(role, 0) + shortage
                        logger.warning(
                            f"Stagnation restart: skipping partial roster (missing {missing}); "
                            f"falling back to elite copies."
                        )
                        break
                    new_population.append((calculate_cost(sol, self.config), sol))
                # Top up from elites if matching hiccupped on this reseed.
                while len(new_population) < self.config.POPULATION_SIZE:
                    cost, sol = random.choice(kept)
                    new_population.append((cost, [t.copy() for t in sol]))
                self.population = new_population
                self.population.sort(key=lambda x: x[0])
                last_improved_gen = gen
                logger.debug(
                    f"Stagnation restart at generation {gen}: kept {keep} elite, "
                    f"reseeded {self.config.POPULATION_SIZE - keep}."
                )

            new_pop = self.population[:elite_count]

            while len(new_pop) < self.config.POPULATION_SIZE:
                # 3-way tournament over the full population for higher diversity.
                contenders = random.sample(self.population, min(3, len(self.population)))
                parent_cost, p_teams = min(contenders, key=lambda x: x[0])

                if random.random() < self.config.MUTATION_RATE:
                    child = mutate_targeted(
                        p_teams,
                        self.mask,
                        self.config.MUTATION_STRENGTH,
                        self.config,
                        self.config.USE_CAPTAINS,
                    )
                    child_cost = calculate_cost(child, self.config)
                    new_pop.append((child_cost, child))
                else:
                    new_pop.append((parent_cost, p_teams))

            self.population = new_pop

        self.population.sort(key=lambda x: x[0])

        # Deterministic local-search polish on the best solution.
        best_cost_before_polish = self.population[0][0]
        best_teams_before_polish = self.population[0][1]
        emit_progress(
            self.progress_callback,
            status="running",
            stage="polishing",
            message=f"Polishing best solution (cost {best_cost_before_polish:.2f})",
        )
        polished = polish(best_teams_before_polish, self.config, self.mask, self.config.USE_CAPTAINS)
        polished_cost = calculate_cost(polished, self.config)
        if polished_cost < best_cost_before_polish - 1e-9:
            self.population[0] = (polished_cost, polished)
            logger.debug(
                f"Polish improved cost: {best_cost_before_polish:.2f} -> {polished_cost:.2f}"
            )

        elapsed = time.time() - start_time
        logger.success(f"Optimization completed in {elapsed:.2f} seconds. Final cost: {self.population[0][0]:.2f}")

        emit_progress(
            self.progress_callback,
            status="running",
            stage="finalizing",
            message=f"Optimization completed in {elapsed:.2f}s",
            progress={"current": self.config.GENERATIONS, "total": self.config.GENERATIONS, "percent": 100.0},
        )

        return self.population[0][1]


# --- NSGA-II-lite primitives for the genetic_moo algorithm ---


def _dominates(a: tuple[float, float], b: tuple[float, float]) -> bool:
    """Strict Pareto dominance: a dominates b iff a <= b on all and < on at least one."""
    better_or_equal = a[0] <= b[0] and a[1] <= b[1]
    strictly_better = a[0] < b[0] or a[1] < b[1]
    return better_or_equal and strictly_better


def fast_non_dominated_sort(
    objectives: list[tuple[float, float]],
) -> list[list[int]]:
    """
    Deb et al. (2002) fast non-dominated sort.

    Returns a list of fronts, where each front is a list of population indices.
    Front 0 is the Pareto-optimal set.
    """
    n = len(objectives)
    if n == 0:
        return []

    dominated_sets: list[list[int]] = [[] for _ in range(n)]
    domination_counts: list[int] = [0] * n
    fronts: list[list[int]] = [[]]

    for p in range(n):
        for q in range(n):
            if p == q:
                continue
            if _dominates(objectives[p], objectives[q]):
                dominated_sets[p].append(q)
            elif _dominates(objectives[q], objectives[p]):
                domination_counts[p] += 1
        if domination_counts[p] == 0:
            fronts[0].append(p)

    current = 0
    while fronts[current]:
        next_front: list[int] = []
        for p in fronts[current]:
            for q in dominated_sets[p]:
                domination_counts[q] -= 1
                if domination_counts[q] == 0:
                    next_front.append(q)
        current += 1
        fronts.append(next_front)

    if not fronts[-1]:
        fronts.pop()
    return fronts


def crowding_distance(
    front: list[int],
    objectives: list[tuple[float, float]],
) -> dict[int, float]:
    """Compute NSGA-II crowding distance for a single front."""
    distances: dict[int, float] = {i: 0.0 for i in front}
    if len(front) <= 2:
        for i in front:
            distances[i] = float("inf")
        return distances

    num_objectives = 2
    for m in range(num_objectives):
        ordered = sorted(front, key=lambda idx: objectives[idx][m])
        f_min = objectives[ordered[0]][m]
        f_max = objectives[ordered[-1]][m]
        span = f_max - f_min if f_max > f_min else 1.0
        distances[ordered[0]] = float("inf")
        distances[ordered[-1]] = float("inf")
        for k in range(1, len(ordered) - 1):
            prev_val = objectives[ordered[k - 1]][m]
            next_val = objectives[ordered[k + 1]][m]
            distances[ordered[k]] += (next_val - prev_val) / span
    return distances


class MOOOptimizer:
    """
    Multi-objective variant of the legacy GA using NSGA-II-lite selection.

    Representation, team model and mutations are identical to :class:`GeneticOptimizer`.
    The key differences:

    * the fitness function is ``calculate_objectives`` — a (balance, comfort)
      tuple rather than a scalar cost;
    * selection uses rank + crowding distance (tournament) instead of a single
      sorted population;
    * the result is a Pareto front (truncated to ``MAX_GENETIC_SOLUTIONS``)
      instead of the single best solution.
    """

    def __init__(
        self,
        players: list[Player],
        num_teams: int,
        config: AlgorithmConfig,
        progress_callback: ProgressCallback | None = None,
        role_assignment: dict[str, str] | None = None,
    ) -> None:
        self.players = players
        self.num_teams = num_teams
        self.config = config
        self.mask = config.DEFAULT_MASK
        self.progress_callback = progress_callback
        self.role_assignment = role_assignment
        self.population: list[tuple[tuple[float, float], list[Team]]] = []

    def _seed_population(self) -> None:
        attempts = 0
        max_attempts = self.config.POPULATION_SIZE * 4
        while len(self.population) < self.config.POPULATION_SIZE and attempts < max_attempts:
            sol = create_random_solution(
                self.players,
                self.num_teams,
                self.mask,
                self.config.USE_CAPTAINS,
                role_assignment=self.role_assignment,
            )
            attempts += 1
            if not all(t.is_full() for t in sol):
                missing = {}
                for team in sol:
                    for role, count in self.mask.items():
                        shortage = count - len(team.roster.get(role, []))
                        if shortage > 0:
                            missing[role] = missing.get(role, 0) + shortage
                raise RuntimeError(
                    f"MOOOptimizer.create_random_solution produced an incomplete "
                    f"roster for {self.num_teams} teams (missing: {missing}). "
                    f"This is a matcher bug; balance_teams_moo() already confirmed "
                    f"feasibility."
                )
            self.population.append((calculate_objectives(sol, self.config), sol))

        if not self.population:
            raise ValueError(
                f"MOOOptimizer could not build any valid initial solution after {attempts} attempts."
            )

    def _tournament_pick(
        self,
        ranks: list[int],
        distances: list[float],
    ) -> int:
        a, b = random.sample(range(len(self.population)), 2)
        if ranks[a] < ranks[b]:
            return a
        if ranks[b] < ranks[a]:
            return b
        if distances[a] > distances[b]:
            return a
        if distances[b] > distances[a]:
            return b
        return a

    def run(self) -> list[list[Team]]:
        start_time = time.time()

        emit_progress(
            self.progress_callback,
            status="running",
            stage="initializing_population",
            message=f"MOO: initializing {self.config.POPULATION_SIZE} solutions",
        )

        self._seed_population()

        emit_progress(
            self.progress_callback,
            status="running",
            stage="evolving",
            message=f"MOO: evolving {self.config.GENERATIONS} generations",
            progress={"current": 0, "total": self.config.GENERATIONS, "percent": 0.0},
        )

        for gen in range(self.config.GENERATIONS):
            if gen % 25 == 0:
                total_gen = max(self.config.GENERATIONS, 1)
                emit_progress(
                    self.progress_callback,
                    status="running",
                    stage="evolving",
                    message=f"MOO generation {gen}/{self.config.GENERATIONS}",
                    progress={
                        "current": gen,
                        "total": total_gen,
                        "percent": round((gen / total_gen) * 100, 2),
                    },
                )

            objectives = [obj for obj, _ in self.population]
            fronts = fast_non_dominated_sort(objectives)
            ranks = [0] * len(self.population)
            distances = [0.0] * len(self.population)
            for rank, front in enumerate(fronts):
                crowd = crowding_distance(front, objectives)
                for idx in front:
                    ranks[idx] = rank
                    distances[idx] = crowd[idx]

            # Create offspring via tournament selection + targeted mutation.
            offspring: list[tuple[tuple[float, float], list[Team]]] = []
            while len(offspring) < self.config.POPULATION_SIZE:
                parent_idx = self._tournament_pick(ranks, distances)
                parent_obj, parent_teams = self.population[parent_idx]
                if random.random() < self.config.MUTATION_RATE:
                    child = mutate_targeted(
                        parent_teams,
                        self.mask,
                        self.config.MUTATION_STRENGTH,
                        self.config,
                        self.config.USE_CAPTAINS,
                    )
                    offspring.append((calculate_objectives(child, self.config), child))
                else:
                    offspring.append((parent_obj, parent_teams))

            # Elitist replacement: combine parents + offspring, keep best N by
            # non-dominated sort + crowding distance.
            combined = self.population + offspring
            combined_objs = [obj for obj, _ in combined]
            combined_fronts = fast_non_dominated_sort(combined_objs)

            next_population: list[tuple[tuple[float, float], list[Team]]] = []
            for front in combined_fronts:
                if len(next_population) + len(front) <= self.config.POPULATION_SIZE:
                    for idx in front:
                        next_population.append(combined[idx])
                    continue
                crowd = crowding_distance(front, combined_objs)
                ordered = sorted(front, key=lambda idx: crowd[idx], reverse=True)
                remaining = self.config.POPULATION_SIZE - len(next_population)
                for idx in ordered[:remaining]:
                    next_population.append(combined[idx])
                break

            self.population = next_population

        # Polish every Pareto-front member.
        final_objs = [obj for obj, _ in self.population]
        final_fronts = fast_non_dominated_sort(final_objs)
        pareto_indices = final_fronts[0] if final_fronts else []

        # Deduplicate by assignment signature to avoid clones in the Pareto set.
        seen_signatures: set[tuple] = set()
        pareto_solutions: list[tuple[tuple[float, float], list[Team]]] = []
        for idx in pareto_indices:
            obj, teams_solution = self.population[idx]
            signature = self._signature(teams_solution)
            if signature in seen_signatures:
                continue
            seen_signatures.add(signature)

            polished = polish(teams_solution, self.config, self.mask, self.config.USE_CAPTAINS)
            polished_obj = calculate_objectives(polished, self.config)
            # Accept the polished variant only if it does not regress on either
            # objective.
            if polished_obj[0] <= obj[0] + 1e-6 and polished_obj[1] <= obj[1] + 1e-6:
                pareto_solutions.append((polished_obj, polished))
            else:
                pareto_solutions.append((obj, teams_solution))

        # Sort Pareto solutions by balance first, then comfort, and truncate.
        pareto_solutions.sort(key=lambda x: (x[0][0], x[0][1]))
        max_solutions = max(1, min(self.config.MAX_GENETIC_SOLUTIONS, len(pareto_solutions)))
        selected = pareto_solutions[:max_solutions]

        elapsed = time.time() - start_time
        logger.success(
            f"MOO optimization completed in {elapsed:.2f}s. "
            f"Pareto front size: {len(pareto_solutions)}, returning {len(selected)} variants."
        )

        emit_progress(
            self.progress_callback,
            status="running",
            stage="finalizing",
            message=f"MOO optimization completed in {elapsed:.2f}s, {len(selected)} variants",
            progress={"current": self.config.GENERATIONS, "total": self.config.GENERATIONS, "percent": 100.0},
        )

        return [teams_solution for _, teams_solution in selected]

    @staticmethod
    def _signature(teams: list[Team]) -> tuple:
        """Stable signature of team assignment: frozenset of (team_id, role, uuid)."""
        entries: list[tuple[int, str, str]] = []
        for team in teams:
            for role, players in team.roster.items():
                for p in players:
                    entries.append((team.id, role, p.uuid))
        entries.sort()
        return tuple(entries)


# --- JSON Conversion ---


def teams_to_json(
    teams: list[Team], mask: dict[str, int], benched_players: list[Player] | None = None
) -> dict[str, typing.Any]:
    """Convert teams to JSON-serializable dictionary for API response."""
    result = {"teams": [], "statistics": {}, "benchedPlayers": []}
    teams = sorted(teams, key=lambda t: t.total_rating)

    for team in teams:
        captain_name = None
        for _role, players in team.roster.items():
            for p in players:
                if p.is_captain:
                    captain_name = p.name
                    break
            if captain_name:
                break

        team_name = captain_name or f"Team {team.id}"

        team_data = {
            "id": team.id,
            "name": team_name,
            "avgMMR": round(team.mmr, 2),
            "totalRating": round(team.total_rating, 2),
            "variance": round(team.intra_std, 2),
            "totalDiscomfort": team.discomfort,
            "maxDiscomfort": team.max_pain,
            "roster": {},
        }

        for role, players in team.roster.items():
            team_data["roster"][role] = [
                {
                    "uuid": p.uuid,
                    "name": p.name,
                    "rating": p.get_rating(role),
                    "discomfort": p.get_discomfort(role),
                    "isCaptain": p.is_captain,
                    "isFlex": p.is_flex,
                    "preferences": p.preferences,
                    "allRatings": p.ratings,
                    "subRole": p.subclasses.get(role) or None,
                }
                for p in players
            ]

        result["teams"].append(team_data)

    all_totals = [t.total_rating for t in teams]
    all_mmrs = [t.mmr for t in teams]

    # Count off-role players: assigned to a role that is not their first preference,
    # and they are NOT a flex player (flex players are comfortable in any of their roles).
    off_role_count = 0
    for team in teams:
        for role, players in team.roster.items():
            for p in players:
                if not p.is_flex and p.preferences and p.preferences[0] != role:
                    off_role_count += 1

    # Count sub-role collisions: pairs of players on the same team sharing the same (role, subclass).
    # E.g., two Hitscan DPS or two Main Heal supports on one team counts as 1 collision.
    sub_role_collision_count = 0
    for team in teams:
        role_subclass_list: list[tuple[str, str]] = []
        for role, players in team.roster.items():
            for p in players:
                subclass = p.subclasses.get(role, "")
                if subclass:
                    role_subclass_list.append((role, subclass))
        counts = Counter(role_subclass_list)
        for count in counts.values():
            if count > 1:
                sub_role_collision_count += count * (count - 1) // 2

    if len(all_totals) > 1:
        result["statistics"] = {
            "averageMMR": round(statistics.mean(all_mmrs), 2),
            "mmrStdDev": round(statistics.stdev(all_mmrs), 2),
            "averageTotalRating": round(statistics.mean(all_totals), 2),
            "totalRatingStdDev": round(statistics.stdev(all_totals), 2),
            "maxTotalRatingGap": round(max(all_totals) - min(all_totals), 2),
            "totalTeams": len(teams),
            "playersPerTeam": sum(mask.values()),
            "offRoleCount": off_role_count,
            "subRoleCollisionCount": sub_role_collision_count,
        }
    else:
        result["statistics"] = {
            "averageMMR": round(all_mmrs[0], 2) if all_mmrs else 0,
            "mmrStdDev": 0,
            "averageTotalRating": round(all_totals[0], 2) if all_totals else 0,
            "totalRatingStdDev": 0,
            "maxTotalRatingGap": 0,
            "totalTeams": len(teams),
            "playersPerTeam": sum(mask.values()),
            "offRoleCount": off_role_count,
            "subRoleCollisionCount": sub_role_collision_count,
        }

    if benched_players:
        result["benchedPlayers"] = [
            {
                "uuid": p.uuid,
                "name": p.name,
                "rating": p.max_rating,
                "discomfort": 0,
                "isCaptain": p.is_captain,
                "isFlex": p.is_flex,
                "preferences": p.preferences,
                "allRatings": p.ratings,
            }
            for p in benched_players
        ]

    return result


CONFIG_KEY_ALIASES: dict[str, str] = {
    "MASK": "DEFAULT_MASK",
    "ROLE_MAPPING": "DEFAULT_ROLE_MAPPING",
}

CONFIG_KEY_REVERSE_ALIASES: dict[str, str] = {value: key for key, value in CONFIG_KEY_ALIASES.items()}

CONFIG_LIMITS: dict[str, dict[str, int | float]] = {
    "POPULATION_SIZE": {"min": 10, "max": 1000},
    "GENERATIONS": {"min": 10, "max": 5000},
    "ELITISM_RATE": {"min": 0.0, "max": 1.0},
    "MUTATION_RATE": {"min": 0.0, "max": 1.0},
    "MUTATION_STRENGTH": {"min": 1, "max": 100},
    "STAGNATION_THRESHOLD": {"min": 1, "max": 500},
    "MMR_DIFF_WEIGHT": {"min": 0.0, "max": 10000.0},
    "TEAM_TOTAL_STD_WEIGHT": {"min": 0.0, "max": 10000.0},
    "DISCOMFORT_WEIGHT": {"min": 0.0, "max": 10000.0},
    "INTRA_TEAM_VAR_WEIGHT": {"min": 0.0, "max": 10000.0},
    "MAX_DISCOMFORT_WEIGHT": {"min": 0.0, "max": 10000.0},
    "ROLE_BALANCE_WEIGHT": {"min": 0.0, "max": 10000.0},
    "ROLE_SPREAD_WEIGHT": {"min": 0.0, "max": 10000.0},
    "INTRA_TEAM_STD_WEIGHT": {"min": 0.0, "max": 10000.0},
    "SUBROLE_COLLISION_WEIGHT": {"min": 0.0, "max": 10000.0},
    "MAX_TEAM_GAP_WEIGHT": {"min": 0.0, "max": 10000.0},
    "MAX_CPSAT_SOLUTIONS": {"min": 1, "max": 5},
    "MAX_GENETIC_SOLUTIONS": {"min": 1, "max": 50},
    "MAX_NSGA_SOLUTIONS": {"min": 1, "max": 200},
    "WEIGHT_TEAM_VARIANCE": {"min": 0.0, "max": 10.0},
    "TEAM_SPREAD_BLEND": {"min": 0.0, "max": 10.0},
    "SUBROLE_BLEND": {"min": 0.0, "max": 10.0},
}

EDITABLE_CONFIG_FIELD_KEYS = {
    "MASK",
    "ROLE_MAPPING",
    "ALGORITHM",
    "POPULATION_SIZE",
    "GENERATIONS",
    "ELITISM_RATE",
    "MUTATION_RATE",
    "MUTATION_STRENGTH",
    "STAGNATION_THRESHOLD",
    "MMR_DIFF_WEIGHT",
    "TEAM_TOTAL_STD_WEIGHT",
    "MAX_TEAM_GAP_WEIGHT",
    "DISCOMFORT_WEIGHT",
    "INTRA_TEAM_VAR_WEIGHT",
    "MAX_DISCOMFORT_WEIGHT",
    "ROLE_BALANCE_WEIGHT",
    "ROLE_SPREAD_WEIGHT",
    "INTRA_TEAM_STD_WEIGHT",
    "SUBROLE_COLLISION_WEIGHT",
    "USE_CAPTAINS",
    "MAX_CPSAT_SOLUTIONS",
    "MAX_GENETIC_SOLUTIONS",
    "MAX_NSGA_SOLUTIONS",
    "WEIGHT_TEAM_VARIANCE",
    "TEAM_SPREAD_BLEND",
    "SUBROLE_BLEND",
}

SYSTEM_CONFIG_FIELD_KEYS = {
    "workspace_id",
    "tournament_id",
    "division_grid",
    "division_scope",
    "MIXTURA_QUEUE",
}

CONFIG_FIELD_DEFINITIONS: list[dict[str, typing.Any]] = [
    {
        "key": "MASK",
        "label": "Role mask",
        "description": "Required player count per team role. Default Overwatch format is 1 Tank, 2 Damage, 2 Support.",
        "type": "role_mask",
        "group": "Roles",
        "applies_to": ["genetic", "nsga"],
    },
    {
        "key": "ROLE_MAPPING",
        "label": "Role mapping",
        "description": "Maps input role codes from uploaded player data to canonical balancer role names.",
        "type": "string_map",
        "group": "Roles",
        "applies_to": ["genetic", "nsga"],
    },
    {
        "key": "ALGORITHM",
        "label": "Algorithm",
        "description": "Selects the solver used to produce teams.",
        "type": "select",
        "group": "Algorithm",
        "options": ["genetic", "genetic_moo", "cpsat", "nsga"],
        "applies_to": ["genetic", "genetic_moo", "cpsat", "nsga"],
    },
    {
        "key": "POPULATION_SIZE",
        "label": "Population size",
        "description": "Number of candidate balances kept per generation. Higher values improve search coverage and cost more time.",
        "type": "integer",
        "group": "Algorithm",
        "applies_to": ["genetic", "genetic_moo", "nsga"],
    },
    {
        "key": "GENERATIONS",
        "label": "Generations",
        "description": "Maximum optimization iterations. Higher values can improve quality and increase runtime.",
        "type": "integer",
        "group": "Algorithm",
        "applies_to": ["genetic", "genetic_moo", "nsga"],
    },
    {
        "key": "ELITISM_RATE",
        "label": "Elitism rate",
        "description": "Fraction of the best genetic solutions preserved unchanged between generations.",
        "type": "float",
        "group": "Algorithm",
        "applies_to": ["genetic"],
    },
    {
        "key": "MUTATION_RATE",
        "label": "Mutation rate",
        "description": "Probability that a genetic solution is changed while producing the next generation.",
        "type": "float",
        "group": "Algorithm",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "MUTATION_STRENGTH",
        "label": "Mutation strength",
        "description": "Number of swap/change operations attempted during a genetic mutation.",
        "type": "integer",
        "group": "Algorithm",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "STAGNATION_THRESHOLD",
        "label": "Stagnation threshold",
        "description": (
            "Number of generations without best-cost improvement before reseeding "
            "the bottom 70% of the population. Elite solutions are preserved."
        ),
        "type": "integer",
        "group": "Algorithm",
        "applies_to": ["genetic"],
    },
    {
        "key": "MMR_DIFF_WEIGHT",
        "label": "Average MMR balance",
        "description": "Penalty weight for differences between team average MMR values.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "TEAM_TOTAL_STD_WEIGHT",
        "label": "Team total consistency",
        "description": "Penalty weight for standard deviation of total team rating sums.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "MAX_TEAM_GAP_WEIGHT",
        "label": "Max team gap",
        "description": "Penalty weight for the rating gap between the strongest and weakest teams.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "DISCOMFORT_WEIGHT",
        "label": "Role discomfort",
        "description": "Penalty weight for assigning players away from their preferred roles.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "INTRA_TEAM_VAR_WEIGHT",
        "label": "In-team variance",
        "description": "Penalty weight for rating spread inside each team.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "MAX_DISCOMFORT_WEIGHT",
        "label": "Worst discomfort",
        "description": "Penalty weight for the single worst role discomfort assignment in a solution.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "ROLE_BALANCE_WEIGHT",
        "label": "Role line balance",
        "description": "Penalty weight for uneven rating strength between the same role across teams.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "ROLE_SPREAD_WEIGHT",
        "label": "Role spread",
        "description": "Penalty weight for uneven role-line strength inside a team.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "SUBROLE_COLLISION_WEIGHT",
        "label": "Subrole collision",
        "description": (
            "Penalty weight per pair of players in the same team sharing the same "
            "role subclass (e.g., two hitscan DPS). Use 0.0 to ignore subclass duplicates."
        ),
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "INTRA_TEAM_STD_WEIGHT",
        "label": "Intra-team rating std",
        "description": (
            "NSGA-II blend coefficient for intra-team rating std. "
            "Higher values discourage pairing a top player with a weak one to hit the average — "
            "spreads strong players evenly across teams."
        ),
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["nsga"],
    },
    {
        "key": "USE_CAPTAINS",
        "label": "Use captains",
        "description": "Marks top-rated players as captains and uses them as team anchors when supported by the solver.",
        "type": "boolean",
        "group": "Strategy",
        "applies_to": ["genetic", "genetic_moo"],
    },
    {
        "key": "MAX_CPSAT_SOLUTIONS",
        "label": "CP-SAT solutions",
        "description": "Maximum requested solution count for the CP-SAT/heuristic solver.",
        "type": "integer",
        "group": "Solver output",
        "applies_to": ["cpsat"],
    },
    {
        "key": "MAX_GENETIC_SOLUTIONS",
        "label": "Genetic MOO solutions",
        "description": "Maximum number of Pareto solution variants returned by the multi-objective genetic optimizer.",
        "type": "integer",
        "group": "Solver output",
        "applies_to": ["genetic_moo"],
    },
    {
        "key": "MAX_NSGA_SOLUTIONS",
        "label": "NSGA-II solutions",
        "description": "Maximum number of Pareto solution variants returned by the NSGA-II solver.",
        "type": "integer",
        "group": "Solver output",
        "applies_to": ["nsga"],
    },
    {
        "key": "WEIGHT_TEAM_VARIANCE",
        "label": "Team variance weight",
        "description": "Weight of team rating variance in the NSGA-II balance objective. Higher values push the solver to equalize ratings across teams.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["nsga"],
    },
    {
        "key": "TEAM_SPREAD_BLEND",
        "label": "Team spread blend",
        "description": "Blend coefficient for per-team player spread variance in the folded balance objective.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["nsga"],
    },
    {
        "key": "SUBROLE_BLEND",
        "label": "Subrole blend",
        "description": "Blend coefficient for subrole penalty in the folded balance objective.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["nsga"],
    },
]


def normalize_config_overrides(config_overrides: dict[str, typing.Any]) -> dict[str, typing.Any]:
    """Normalize external config keys to internal AlgorithmConfig keys."""
    normalized: dict[str, typing.Any] = {}

    for key, value in config_overrides.items():
        normalized_key = CONFIG_KEY_ALIASES.get(key, key)
        normalized[normalized_key] = value

    return normalized


def serialize_algorithm_config(config: AlgorithmConfig) -> dict[str, typing.Any]:
    """Serialize runtime config back to external API keys."""
    payload = config.model_dump()
    serialized: dict[str, typing.Any] = {}

    for key, value in payload.items():
        external_key = CONFIG_KEY_REVERSE_ALIASES.get(key, key)
        serialized[external_key] = value

    return serialized


def normalize_tournament_config_payload(config_payload: dict[str, typing.Any] | None) -> dict[str, typing.Any]:
    """Validate and sanitize user-editable tournament balancing config."""
    from src.schemas.balancer import ConfigOverrides

    if not config_payload:
        return {}

    editable_payload: dict[str, typing.Any] = {}
    unknown_keys: dict[str, typing.Any] = {}

    for key, value in config_payload.items():
        if key in EDITABLE_CONFIG_FIELD_KEYS:
            if value is not None:
                editable_payload[key] = value
            continue

        if key in SYSTEM_CONFIG_FIELD_KEYS:
            continue

        unknown_keys[key] = value

    if unknown_keys:
        ConfigOverrides.model_validate(unknown_keys)

    validated = ConfigOverrides.model_validate(editable_payload)
    return validated.model_dump(exclude_none=True)


def build_config_fields(defaults: dict[str, typing.Any]) -> list[dict[str, typing.Any]]:
    """Build UI-facing field metadata from runtime defaults and limits."""
    fields: list[dict[str, typing.Any]] = []

    for definition in CONFIG_FIELD_DEFINITIONS:
        key = definition["key"]
        field = {
            **definition,
            "default": defaults.get(key),
            "limits": CONFIG_LIMITS.get(key),
        }
        fields.append(field)

    return fields


def get_balancer_config_payload() -> dict[str, typing.Any]:
    """Get defaults, limits, and presets for frontend configuration forms."""
    presets = {
        name: value.copy()
        for name, value in ConfigPresets.__dict__.items()
        if name.isupper() and isinstance(value, dict)
    }
    defaults = serialize_algorithm_config(AlgorithmConfig())

    return {
        "defaults": defaults,
        "limits": CONFIG_LIMITS,
        "presets": presets,
        "fields": build_config_fields(defaults),
    }


def _prepare_balance_context(
    input_data: dict[str, typing.Any],
    config_overrides: dict[str, typing.Any] | None,
    progress_callback: ProgressCallback | None,
) -> tuple[AlgorithmConfig, list[Player], int, bool, dict[str, str]]:
    """
    Shared preparation for genetic/genetic_moo balancing paths: parse config
    overrides, load players, validate role coverage, decide team count, assign
    captains, and compute a feasibility-proven role assignment.

    The returned ``role_assignment`` is passed into the optimizer so that the
    hot seeding path does not re-run bipartite matching for every population
    member.
    """
    config = AlgorithmConfig()
    has_applied_overrides = False

    emit_progress(
        progress_callback,
        status="running",
        stage="validating_input",
        message="Validating request payload",
    )

    if config_overrides:
        normalized_config_overrides = normalize_config_overrides(config_overrides)
        logger.info(f"Applying configuration overrides: {list(normalized_config_overrides.keys())}")

        for key, value in normalized_config_overrides.items():
            if value is None:
                continue

            if hasattr(config, key):
                setattr(config, key, value)
                logger.debug(f"Set {key} = {value}")
                has_applied_overrides = True
            else:
                logger.warning(f"Unknown config parameter '{key}' ignored")

    mask = config.DEFAULT_MASK
    role_mapping = config.DEFAULT_ROLE_MAPPING

    emit_progress(
        progress_callback,
        status="running",
        stage="loading_players",
        message=f"Loading players with role mask {mask}",
    )
    logger.info(f"Loading players with mask: {mask}")

    all_players = load_players_from_dict(input_data, mask, role_mapping)
    needed_roles = [r for r, c in mask.items() if c > 0]
    valid_players = [p for p in all_players if any(p.can_play(r) for r in needed_roles)]

    if not valid_players:
        logger.error("No valid players found after filtering")
        raise ValueError("No valid players found")

    emit_progress(
        progress_callback,
        status="running",
        stage="checking_roles",
        message="Checking role availability constraints",
    )

    for role, count in mask.items():
        if count > 0:
            role_players = [p for p in valid_players if p.can_play(role)]
            logger.info(f"Role '{role}' requires {count} per team, {len(role_players)} players can play it")
            if len(role_players) == 0:
                raise ValueError(f"No players can play required role '{role}'")

    players_per_team = sum(mask.values())
    if players_per_team <= 0:
        raise ValueError("Role mask defines zero players per team")

    if len(valid_players) % players_per_team != 0:
        raise ValueError(
            f"Player count must be divisible by team size. "
            f"Got {len(valid_players)} players, team size is {players_per_team} "
            f"(mask {mask}). Remove {len(valid_players) % players_per_team} "
            f"players or add {players_per_team - len(valid_players) % players_per_team} "
            f"to form complete teams."
        )

    num_teams = len(valid_players) // players_per_team
    if num_teams == 0:
        raise ValueError(
            f"Not enough players to form even one team. "
            f"Need at least {players_per_team} players, got {len(valid_players)}."
        )

    # Captain assignment must happen BEFORE the feasibility matcher so that
    # captains can be pinned to their top-preference role — otherwise the
    # matcher would place captains on whichever role satisfied feasibility,
    # which violates the "captains stay on their role" invariant.
    if config.USE_CAPTAINS:
        assign_captains(valid_players, num_teams, mask)
        captain_count = sum(1 for p in valid_players if p.is_captain)
        logger.info(f"Assigned {captain_count} captains")
        emit_progress(
            progress_callback,
            status="running",
            stage="forming_teams",
            message=f"Assigned {captain_count} captains",
        )

    # Hard feasibility: can we actually fill every team's every role slot?
    # Silent num_teams reduction is forbidden — callers guarantee a clean input,
    # and any mismatch must surface loudly.
    shortages = diagnose_role_shortage(valid_players, num_teams, mask)
    if shortages:
        shortage_desc = ", ".join(
            f"'{role}' short by {missing}" for role, missing in shortages.items()
        )
        raise ValueError(
            f"Cannot form {num_teams} full teams — not enough role coverage: "
            f"{shortage_desc}. Add more players capable of these roles or remove "
            f"enough players to shrink the team count."
        )

    # Even if every role has enough can_play coverage, overlap between roles
    # can still break completeness (Hall-style constraint). Run the bipartite
    # matcher once — with captain pinning — so we fail loudly instead of later
    # silently benching people.
    role_assignment = find_feasible_role_assignment(valid_players, num_teams, mask)
    if role_assignment is None:
        raise ValueError(
            f"Cannot form {num_teams} full teams: either players cannot cover "
            f"the required role overlap, or too many captains are pinned to "
            f"the same role (see logs for details)."
        )

    logger.info(f"Forming {num_teams} teams with {len(valid_players)} players")
    emit_progress(
        progress_callback,
        status="running",
        stage="forming_teams",
        message=f"Forming {num_teams} teams",
    )

    return config, valid_players, num_teams, has_applied_overrides, role_assignment


def _build_response_payload(
    result: list[Team],
    valid_players: list[Player],
    mask: dict[str, int],
    config: AlgorithmConfig,
    has_applied_overrides: bool,
) -> dict[str, typing.Any]:
    placed_uuids: set[str] = set()
    for team in result:
        for role_players in team.roster.values():
            for p in role_players:
                placed_uuids.add(p.uuid)
    benched = [p for p in valid_players if p.uuid not in placed_uuids]

    response_payload = teams_to_json(result, mask, benched_players=benched)

    if has_applied_overrides:
        response_payload["appliedConfig"] = serialize_algorithm_config(config)

    return response_payload


def balance_teams(
    input_data: dict[str, typing.Any],
    config_overrides: dict[str, typing.Any] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, typing.Any]:
    config, valid_players, num_teams, has_applied_overrides, role_assignment = _prepare_balance_context(
        input_data, config_overrides, progress_callback
    )
    mask = config.DEFAULT_MASK

    emit_progress(
        progress_callback,
        status="running",
        stage="optimizing",
        message="Running genetic optimizer",
    )

    opt = GeneticOptimizer(
        valid_players,
        num_teams,
        config,
        progress_callback,
        role_assignment=role_assignment,
    )
    result = opt.run()

    response_payload = _build_response_payload(
        result, valid_players, mask, config, has_applied_overrides
    )

    emit_progress(
        progress_callback,
        status="running",
        stage="finalizing",
        message="Preparing final response payload",
    )

    return response_payload


def balance_teams_moo(
    input_data: dict[str, typing.Any],
    config_overrides: dict[str, typing.Any] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> list[dict[str, typing.Any]]:
    """
    Multi-objective variant of :func:`balance_teams`. Returns a Pareto front of
    balance solutions (up to ``MAX_GENETIC_SOLUTIONS``) rather than a single
    scalar-optimal answer. Payload shape is identical to the single solution —
    every entry can be used wherever :func:`balance_teams` output is expected.
    """
    config, valid_players, num_teams, has_applied_overrides, role_assignment = _prepare_balance_context(
        input_data, config_overrides, progress_callback
    )
    mask = config.DEFAULT_MASK

    emit_progress(
        progress_callback,
        status="running",
        stage="optimizing",
        message="Running multi-objective genetic optimizer",
    )

    opt = MOOOptimizer(
        valid_players,
        num_teams,
        config,
        progress_callback,
        role_assignment=role_assignment,
    )
    pareto_solutions = opt.run()

    if not pareto_solutions:
        raise ValueError("MOO optimizer returned no Pareto solutions.")

    payloads: list[dict[str, typing.Any]] = []
    for result in pareto_solutions:
        payload = _build_response_payload(
            result, valid_players, mask, config, has_applied_overrides
        )
        payloads.append(payload)

    emit_progress(
        progress_callback,
        status="running",
        stage="finalizing",
        message=f"Prepared {len(payloads)} Pareto variants",
    )

    return payloads


def export_teams_to_json_file(teams_data: dict[str, typing.Any], output_path: str | Path) -> None:
    """
    Export balanced teams data to a JSON file.

    Args:
        teams_data: The teams dictionary returned from balance_teams()
        output_path: Path where the JSON file should be saved

    Raises:
        OSError: If the file cannot be written
    """
    output_path = Path(output_path)

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(teams_data, f, indent=2, ensure_ascii=False)

        logger.success(f"Teams exported successfully to {output_path}")

    except Exception as e:
        logger.error(f"Failed to export teams to {output_path}: {e}")
        raise OSError(f"Failed to export teams to file: {e}")


def export_captains_to_txt_file(teams_data: dict[str, typing.Any], output_path: str | Path) -> None:
    """
    Export captain names to a text file.

    Args:
        teams_data: The teams dictionary returned from balance_teams()
        output_path: Path where the text file should be saved

    Raises:
        OSError: If the file cannot be written
    """
    output_path = Path(output_path)

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)

        captain_names = []
        for team in teams_data.get("teams", []):
            for _role, players in team.get("roster", {}).items():
                for player in players:
                    if player.get("isCaptain", False):
                        captain_names.append(player["name"])

        with open(output_path, "w", encoding="utf-8") as f:
            for name in captain_names:
                f.write(f"{name}\n")

        logger.success(f"Exported {len(captain_names)} captain names to {output_path}")

    except Exception as e:
        logger.error(f"Failed to export captains to {output_path}: {e}")
        raise OSError(f"Failed to export captains to file: {e}")


def balance_and_export_teams(
    input_data: dict[str, typing.Any], output_path: str | Path, config_overrides: dict[str, typing.Any] | None = None
) -> dict[str, typing.Any]:
    """
    Balance teams and export the results to a JSON file in one operation.

    Args:
        input_data: Player data and configuration
        output_path: Path where the JSON file should be saved
        config_overrides: Optional configuration parameter overrides

    Returns:
        The balanced teams data dictionary

    Raises:
        ValueError: If team balancing fails
        IOError: If file export fails
    """
    teams_data = balance_teams(input_data, config_overrides)
    export_teams_to_json_file(teams_data, output_path)
    return teams_data
