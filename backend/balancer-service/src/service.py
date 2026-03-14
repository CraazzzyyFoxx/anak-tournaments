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

    __slots__ = ("uuid", "name", "ratings", "preferences", "subclasses", "discomfort_map", "is_captain", "is_flex", "_max_rating", "_mask")

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

        for role, players in self.roster.items():
            for p in players:
                r = p.ratings.get(role, 0)
                d = p.discomfort_map.get(role, 5000)
                sum_rating += r
                sum_rating2 += r * r
                total_pain += d
                count += 1
                if d > max_pain_in_team:
                    max_pain_in_team = d

        self._cached_total_rating = sum_rating

        if count > 0:
            self._cached_mmr = sum_rating / count
            self._cached_intra_std = _sample_stdev_from_sums(sum_rating, sum_rating2, count)
        else:
            self._cached_mmr = 0.0
            self._cached_intra_std = 0.0

        self._cached_discomfort = total_pain
        self._cached_max_pain = max_pain_in_team
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

        if team_total < min_team_total:
            min_team_total = team_total
        if team_total > max_team_total:
            max_team_total = team_total

        if t._cached_max_pain > global_max_pain:
            global_max_pain = t._cached_max_pain

        team_role_sum = 0.0
        team_role_sum2 = 0.0
        team_role_count = 0

        for role, required in mask.items():
            if required <= 0:
                continue

            players = t.roster.get(role, [])
            if not players:
                continue

            role_total = 0.0
            for p in players:
                role_total += p.ratings.get(role, 0)
            role_avg = role_total / len(players)

            role_sums[role] = role_sums.get(role, 0.0) + role_avg
            role_sums2[role] = role_sums2.get(role, 0.0) + role_avg * role_avg
            role_counts[role] = role_counts.get(role, 0) + 1

            team_role_sum += role_avg
            team_role_sum2 += role_avg * role_avg
            team_role_count += 1

        if team_role_count >= 2:
            spread_var = (team_role_sum2 / team_role_count) - (team_role_sum / team_role_count) ** 2
            if spread_var > 0.0:
                total_role_spread += spread_var
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
    )


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


def assign_captains(players: list[Player], count: int) -> None:
    for p in players:
        p.is_captain = False
    sorted_players = sorted(players, key=lambda p: p.max_rating, reverse=True)
    for i in range(min(count, len(sorted_players))):
        sorted_players[i].is_captain = True


def create_random_solution(
    players: list[Player], num_teams: int, mask: dict[str, int], use_captains: bool
) -> list[Team]:
    """Create a random team assignment solution (Optimized Search Space)."""
    teams = [Team(i + 1, mask) for i in range(num_teams)]
    captains = [p for p in players if p.is_captain]
    pool = [p for p in players if not p.is_captain]
    random.shuffle(captains)
    random.shuffle(pool)

    if use_captains:
        for team in teams:
            if not captains:
                break
            cap = captains.pop()
            assigned = False
            for role in cap.preferences:
                if role in mask and team.add_player(role, cap):
                    assigned = True
                    break
            if not assigned:
                for role in mask:
                    if cap.can_play(role) and team.add_player(role, cap):
                        assigned = True
                        break
            if not assigned:
                pool.append(cap)
        pool.extend(captains)
        random.shuffle(pool)

    players_by_pref: dict[str, list[Player]] = {}
    for player in pool:
        if player.preferences:
            top_pref = player.preferences[0]
            players_by_pref.setdefault(top_pref, []).append(player)

    for role_list in players_by_pref.values():
        random.shuffle(role_list)

    assigned_players: set[Player] = set()
    for role in mask.keys():
        if role not in players_by_pref or mask[role] == 0:
            continue

        same_pref_players = players_by_pref[role]
        for team in teams:
            needed = mask[role] - len(team.roster[role])
            for _ in range(needed):
                if not same_pref_players:
                    break
                player = same_pref_players.pop()
                if team.add_player(role, player):
                    assigned_players.add(player)

    remaining_pool = [p for p in pool if p not in assigned_players]
    random.shuffle(remaining_pool)

    for role, count in mask.items():
        if count == 0:
            continue

        candidates = [p for p in remaining_pool if p.can_play(role)]
        random.shuffle(candidates)
        used_players: set[Player] = set()

        for team in teams:
            needed = count - len(team.roster[role])
            for _ in range(needed):
                while candidates and candidates[-1] in used_players:
                    candidates.pop()

                if not candidates:
                    break

                player = candidates.pop()
                if team.add_player(role, player):
                    used_players.add(player)

        if used_players:
            remaining_pool = [p for p in remaining_pool if p not in used_players]

    return teams


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
    ) -> None:
        self.players = players
        self.num_teams = num_teams
        self.config = config
        self.population: list[tuple[float, list[Team]]] = []
        self.mask = config.DEFAULT_MASK
        self.progress_callback = progress_callback

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

        attempts = 0
        max_attempts = self.config.POPULATION_SIZE * 12
        partial_solutions = []

        while len(self.population) < self.config.POPULATION_SIZE and attempts < max_attempts:
            sol = create_random_solution(self.players, self.num_teams, self.mask, self.config.USE_CAPTAINS)
            if all(t.is_full() for t in sol):
                self.population.append((calculate_cost(sol, self.config), sol))
            else:
                if len(partial_solutions) < 5:
                    partial_solutions.append(sol)
            attempts += 1

        if not self.population:
            role_stats = {}
            for role in self.mask.keys():
                role_players = [p for p in self.players if p.can_play(role)]
                role_stats[role] = len(role_players)

            error_msg = (
                f"Unable to create valid team configurations after {attempts} attempts. "
                f"Teams needed: {self.num_teams}, Players: {len(self.players)}, "
                f"Required roles per team: {self.mask}, "
                f"Available players per role: {role_stats}"
            )

            if partial_solutions:
                first_sol = partial_solutions[0]
                incomplete_teams = [t for t in first_sol if not t.is_full()]
                if incomplete_teams:
                    missing = {}
                    for team in incomplete_teams[:3]:
                        for role, count in self.mask.items():
                            needed = count - len(team.roster[role])
                            if needed > 0:
                                missing[role] = missing.get(role, 0) + needed
                    error_msg += f". Example missing slots: {missing}"

            logger.error(error_msg)
            raise ValueError(error_msg)

        while len(self.population) < self.config.POPULATION_SIZE:
            cost, solution = random.choice(self.population)
            self.population.append((cost, [x.copy() for x in solution]))

        logger.info(f"Starting evolution for {self.config.GENERATIONS} generations...")
        emit_progress(
            self.progress_callback,
            status="running",
            stage="evolving",
            message=f"Starting evolution ({self.config.GENERATIONS} generations)",
            progress={"current": 0, "total": self.config.GENERATIONS, "percent": 0.0},
        )

        elite_count = max(1, int(self.config.POPULATION_SIZE * self.config.ELITISM_RATE))

        for gen in range(self.config.GENERATIONS):
            self.population.sort(key=lambda x: x[0])

            if gen % 25 == 0:
                best_cost = self.population[0][0]
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

            if self.population[0][0] <= 0.1:
                logger.info(f"Optimal solution found at generation {gen}")
                emit_progress(
                    self.progress_callback,
                    status="running",
                    stage="evolving",
                    message=f"Early stop at generation {gen} (cost {self.population[0][0]:.2f})",
                    progress={
                        "current": gen,
                        "total": self.config.GENERATIONS,
                        "percent": round((gen / max(self.config.GENERATIONS, 1)) * 100, 2),
                    },
                )
                break

            new_pop = self.population[:elite_count]
            parent_pool_size = min(24, len(self.population))
            parent_pool = self.population[:parent_pool_size]

            while len(new_pop) < self.config.POPULATION_SIZE:
                parent_a, parent_b = random.sample(parent_pool, 2)
                parent_cost, p_teams = parent_a if parent_a[0] <= parent_b[0] else parent_b

                if random.random() < self.config.MUTATION_RATE:
                    child = mutate(p_teams, self.mask, self.config.MUTATION_STRENGTH, self.config.USE_CAPTAINS)
                    child_cost = calculate_cost(child, self.config)
                    new_pop.append((child_cost, child))
                else:
                    new_pop.append((parent_cost, p_teams))

            self.population = new_pop

        self.population.sort(key=lambda x: x[0])
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
    "MUTATION_STRENGTH": {"min": 1, "max": 10},
    "MMR_DIFF_WEIGHT": {"min": 0.0, "max": 1000.0},
    "TEAM_TOTAL_STD_WEIGHT": {"min": 0.0, "max": 1000.0},
    "DISCOMFORT_WEIGHT": {"min": 0.0, "max": 100.0},
    "INTRA_TEAM_VAR_WEIGHT": {"min": 0.0, "max": 100.0},
    "MAX_DISCOMFORT_WEIGHT": {"min": 0.0, "max": 100.0},
    "ROLE_BALANCE_WEIGHT": {"min": 0.0, "max": 100.0},
    "ROLE_SPREAD_WEIGHT": {"min": 0.0, "max": 100.0},
    "MAX_TEAM_GAP_WEIGHT": {"min": 0.0, "max": 1000.0},
}


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


def get_balancer_config_payload() -> dict[str, typing.Any]:
    """Get defaults, limits, and presets for frontend configuration forms."""
    presets = {
        name: value.copy()
        for name, value in ConfigPresets.__dict__.items()
        if name.isupper() and isinstance(value, dict)
    }

    return {
        "defaults": serialize_algorithm_config(AlgorithmConfig()),
        "limits": CONFIG_LIMITS,
        "presets": presets,
    }


def balance_teams(
    input_data: dict[str, typing.Any],
    config_overrides: dict[str, typing.Any] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, typing.Any]:
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
    num_teams = len(valid_players) // players_per_team if players_per_team > 0 else 0

    if num_teams == 0:
        logger.error(f"Not enough players to form teams. Need at least {players_per_team}, got {len(valid_players)}")
        raise ValueError(
            f"Not enough players to form teams. Need at least {players_per_team} players, got {len(valid_players)}"
        )

    for role, count_needed in mask.items():
        if count_needed > 0:
            role_players = [p for p in valid_players if p.can_play(role)]
            min_teams_for_role = len(role_players) // count_needed
            if min_teams_for_role < num_teams:
                logger.warning(
                    f"Role '{role}' constraint: can only form {min_teams_for_role} teams, adjusting from {num_teams}"
                )
                num_teams = min_teams_for_role

    if num_teams == 0:
        role_stats = {role: len([p for p in valid_players if p.can_play(role)]) for role in mask.keys()}
        raise ValueError(f"Cannot form any valid teams. Role availability: {role_stats}, Required per team: {mask}")

    logger.info(f"Forming {num_teams} teams with {len(valid_players)} players")
    emit_progress(
        progress_callback,
        status="running",
        stage="forming_teams",
        message=f"Forming {num_teams} teams",
    )

    if config.USE_CAPTAINS:
        assign_captains(valid_players, num_teams)
        captain_count = sum(1 for p in valid_players if p.is_captain)
        logger.info(f"Assigned {captain_count} captains")
        emit_progress(
            progress_callback,
            status="running",
            stage="forming_teams",
            message=f"Assigned {captain_count} captains",
        )

    emit_progress(
        progress_callback,
        status="running",
        stage="optimizing",
        message="Running genetic optimizer",
    )

    opt = GeneticOptimizer(valid_players, num_teams, config, progress_callback)
    result = opt.run()

    # Determine which players were NOT placed into any team (benched)
    placed_uuids: set[str] = set()
    for team in result:
        for role_players in team.roster.values():
            for p in role_players:
                placed_uuids.add(p.uuid)
    benched = [p for p in valid_players if p.uuid not in placed_uuids]

    response_payload = teams_to_json(result, mask, benched_players=benched)

    if has_applied_overrides:
        response_payload["appliedConfig"] = serialize_algorithm_config(config)

    emit_progress(
        progress_callback,
        status="running",
        stage="finalizing",
        message="Preparing final response payload",
    )

    return response_payload


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