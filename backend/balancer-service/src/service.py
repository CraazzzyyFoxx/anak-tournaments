"""
Team balancing service using genetic algorithms.

This module provides the core balancing logic for tournament teams,
using a genetic algorithm approach to optimize team composition based on
player ratings, role preferences, and various balancing criteria.
"""

import json
import random
import statistics
import time
import typing
from pathlib import Path

from src.core.config import AlgorithmConfig
from src.core.logging import logger


class Player:
    """Represents a tournament player with ratings and role preferences."""
    __slots__ = ('uuid', 'name', 'ratings', 'preferences', 'discomfort_map', 'is_captain', '_max_rating', '_mask')

    def __init__(self, name: str, ratings: dict[str, int], preferences: list[str], uuid: str, mask: dict[str, int]) -> None:
        self.uuid = uuid
        self.name = name
        self.ratings = ratings
        self.preferences = preferences
        self.is_captain = False
        self._max_rating = max(ratings.values()) if ratings else 0
        self._mask = mask

        self.discomfort_map = {}
        for role in self._mask.keys():
            if role in preferences:
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
    __slots__ = ('id', 'roster', '_cached_mmr', '_cached_discomfort',
                 '_cached_intra_std', '_cached_max_pain', '_is_dirty', '_mask')

    def __init__(self, t_id: int, mask: dict[str, int]) -> None:
        self.id = t_id
        self._mask = mask
        self.roster = {role: [] for role in mask if mask[role] > 0}
        self._cached_mmr = 0.0
        self._cached_discomfort = 0.0
        self._cached_intra_std = 0.0
        self._cached_max_pain = 0
        self._is_dirty = True

    def copy(self) -> 'Team':
        new_team = Team(self.id, self._mask)
        new_team.roster = {r: list(p_list) for r, p_list in self.roster.items()}
        new_team._cached_mmr = self._cached_mmr
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
        if not self._is_dirty: return

        total_rating = 0
        count = 0
        total_pain = 0
        all_ratings = []
        max_pain_in_team = 0

        for role, players in self.roster.items():
            for p in players:
                r = p.get_rating(role)
                d = p.get_discomfort(role)
                total_rating += r
                total_pain += d
                count += 1
                all_ratings.append(r)
                if d > max_pain_in_team:
                    max_pain_in_team = d

        self._cached_mmr = total_rating / count if count > 0 else 0
        self._cached_discomfort = total_pain
        self._cached_intra_std = statistics.stdev(all_ratings) if len(all_ratings) > 1 else 0.0
        self._cached_max_pain = max_pain_in_team
        self._is_dirty = False

    @property
    def mmr(self) -> float:
        if self._is_dirty: self.calculate_stats()
        return self._cached_mmr

    @property
    def discomfort(self) -> float:
        if self._is_dirty: self.calculate_stats()
        return self._cached_discomfort

    @property
    def intra_std(self) -> float:
        if self._is_dirty: self.calculate_stats()
        return self._cached_intra_std

    @property
    def max_pain(self) -> int:
        if self._is_dirty: self.calculate_stats()
        return self._cached_max_pain

    def is_full(self) -> bool:
        for role, needed in self._mask.items():
            if len(self.roster.get(role, [])) < needed: 
                return False
        return True


# --- Genetic Algorithm Logic ---

def calculate_cost(teams: list[Team], config: AlgorithmConfig) -> float:
    """Calculate the cost (fitness) of a team configuration."""
    if not teams:
        return float('inf')

    mmrs = [t.mmr for t in teams]

    # Pre-calculate values
    inter_team_std = statistics.stdev(mmrs) if len(mmrs) > 1 else 0
    avg_discomfort = sum(t.discomfort for t in teams) / len(teams)
    avg_intra_std = sum(t.intra_std for t in teams) / len(teams)
    global_max_pain = max((t.max_pain for t in teams), default=0)

    return (
        inter_team_std * config.MMR_DIFF_WEIGHT +
        avg_discomfort * config.DISCOMFORT_WEIGHT +
        avg_intra_std * config.INTRA_TEAM_VAR_WEIGHT +
        global_max_pain * config.MAX_DISCOMFORT_WEIGHT
    )


# --- Utility Functions ---

def parse_player_node(uuid: str, data: dict[str, typing.Any], mask: dict[str, int], role_mapping: dict[str, str] | None = None) -> Player | None:
    """Parse player data from input dictionary."""
    try:
        name = data.get('identity', {}).get('name', 'Unknown')
        raw_classes = data.get('stats', {}).get('classes', {})
        ratings = {}
        role_priorities = []

        for json_role, stats in raw_classes.items():
            if not stats.get('isActive', False): 
                continue
            rank = stats.get('rank', 0)
            if rank <= 0: 
                continue
            algo_role = role_mapping.get(json_role) if role_mapping else json_role
            if not algo_role or algo_role not in mask: 
                continue
            ratings[algo_role] = rank
            priority = stats.get('priority', 99)
            role_priorities.append((priority, algo_role))

        if not ratings: 
            return None
        role_priorities.sort(key=lambda x: x[0])
        preferences = [r for _, r in role_priorities]
        return Player(name, ratings, preferences, uuid, mask)
    except Exception as e:
        logger.warning(f"Failed to parse player {uuid}: {e}")
        return None


def load_players_from_dict(data: dict[str, typing.Any], mask: dict[str, int], role_mapping: dict[str, str] | None= None) -> list[Player]:
    """Load players from dictionary (from JSON input)"""
    players_list = []
    try:
        # Try different paths to find players
        players_dict = None

        # Check for xv-1 format (format: "xv-1", players: {...})
        if 'format' in data and data.get('format') == 'xv-1' and 'players' in data:
            players_dict = data['players']
        # Check for nested data structure
        elif 'data' in data:
            data_root = data.get('data', {})
            if 'data' in data_root and 'players' in data_root['data']:
                players_dict = data_root['data']['players']
            elif 'players' in data_root:
                players_dict = data_root['players']
        # Check for direct players key
        elif 'players' in data:
            players_dict = data['players']

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


def create_random_solution(players: list[Player], num_teams: int, mask: dict[str, int], use_captains: bool) -> list[Team]:
    """Create a random team assignment solution.

    Teams are initially formed by grouping players with the same preferred role,
    then remaining slots are filled with other available players.
    """
    teams = [Team(i + 1, mask) for i in range(num_teams)]
    captains = [p for p in players if p.is_captain]
    x = 1
    pool = [p for p in players if not p.is_captain]
    random.shuffle(captains)
    random.shuffle(pool)

    # Step 1: Assign captains if enabled
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

    # Step 2: Group players by their top preferred role
    players_by_pref = {}
    for player in pool:
        if player.preferences:
            top_pref = player.preferences[0]
            if top_pref not in players_by_pref:
                players_by_pref[top_pref] = []
            players_by_pref[top_pref].append(player)

    # Shuffle each preference group
    for role_list in players_by_pref.values():
        random.shuffle(role_list)

    # Step 3: Assign players with same preferred role to teams first
    assigned_players = set()
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

    # Step 4: Fill remaining slots with any available players
    remaining_pool = [p for p in pool if p not in assigned_players]
    random.shuffle(remaining_pool)

    for role, count in mask.items():
        if count == 0: 
            continue
        candidates = [p for p in remaining_pool if p.can_play(role)]
        random.shuffle(candidates)
        for team in teams:
            needed = count - len(team.roster[role])
            for _ in range(needed):
                if not candidates: 
                    break
                player = candidates.pop()
                if team.add_player(role, player):
                    remaining_pool.remove(player)

    return teams


def mutate(teams: list[Team], mask: dict[str, int], mutation_strength: int, use_captains: bool) -> list[Team]:
    """Apply mutations to team configuration."""
    new_teams_list = [t.copy() for t in teams]
    available_roles = [r for r, c in mask.items() if c > 0]
    if not available_roles: 
        return new_teams_list

    for _ in range(mutation_strength):
        if random.random() < 0.7:
            # Inter-team role swap
            t1_idx, t2_idx = random.sample(range(len(new_teams_list)), 2)
            t1, t2 = new_teams_list[t1_idx], new_teams_list[t2_idx]
            role = random.choice(available_roles)
            if t1.roster[role] and t2.roster[role]:
                idx1 = random.randint(0, len(t1.roster[role]) - 1)
                idx2 = random.randint(0, len(t2.roster[role]) - 1)
                p1, p2 = t1.roster[role][idx1], t2.roster[role][idx2]
                if use_captains and (p1.is_captain or p2.is_captain): 
                    continue
                t1.replace_player(role, idx1, p2)
                t2.replace_player(role, idx2, p1)
        else:
            # Intra-team role swap
            t = random.choice(new_teams_list)
            if len(available_roles) < 2: 
                continue
            r1, r2 = random.sample(available_roles, 2)
            cand_r1 = [i for i, p in enumerate(t.roster[r1]) if p.can_play(r2) and (not use_captains or not p.is_captain)]
            cand_r2 = [i for i, p in enumerate(t.roster[r2]) if p.can_play(r1) and (not use_captains or not p.is_captain)]
            if cand_r1 and cand_r2:
                i1, i2 = random.choice(cand_r1), random.choice(cand_r2)
                p1, p2 = t.roster[r1][i1], t.roster[r2][i2]
                if use_captains and (p1.is_captain or p2.is_captain): 
                    continue
                t.replace_player(r1, i1, p2)
                t.replace_player(r2, i2, p1)
    return new_teams_list


class GeneticOptimizer:
    """Genetic algorithm optimizer for team balancing."""

    def __init__(self, players: list[Player], num_teams: int, config: AlgorithmConfig) -> None:
        self.players = players
        self.num_teams = num_teams
        self.config = config
        self.population: list[tuple[float, list[Team]]] = []
        self.mask = config.DEFAULT_MASK

    def run(self) -> list[Team]:
        """Run the genetic algorithm optimization."""
        start_time = time.time()
        logger.info(f"Initializing population with {self.config.POPULATION_SIZE} solutions...")

        # Create initial population
        attempts = 0
        max_attempts = self.config.POPULATION_SIZE * 10
        partial_solutions = []

        while len(self.population) < self.config.POPULATION_SIZE and attempts < max_attempts:
            sol = create_random_solution(self.players, self.num_teams, self.mask, self.config.USE_CAPTAINS)
            x = 1
            if all(t.is_full() for t in sol):
                self.population.append((calculate_cost(sol, self.config), sol))
            else:
                if len(partial_solutions) < 5:
                    partial_solutions.append(sol)
            attempts += 1

        x = 1

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

        # Fill remaining population slots by duplicating existing solutions
        while len(self.population) < self.config.POPULATION_SIZE:
            c, t = random.choice(self.population)
            self.population.append((c, [x.copy() for x in t]))

        logger.info(f"Starting evolution for {self.config.GENERATIONS} generations...")
        elite_count = int(self.config.POPULATION_SIZE * self.config.ELITISM_RATE)

        # Evolution loop
        for gen in range(self.config.GENERATIONS):
            self.population.sort(key=lambda x: x[0])

            if gen % 50 == 0:
                logger.debug(f"Generation {gen:03d} | Best cost: {self.population[0][0]:.2f}")

            # Early stopping if solution is good enough
            if self.population[0][0] <= 0.1:
                logger.info(f"Optimal solution found at generation {gen}")
                break

            # Create new population with elitism
            new_pop = self.population[:elite_count]

            while len(new_pop) < self.config.POPULATION_SIZE:
                # Select parents and create offspring
                parents = random.sample(self.population[:50], 2)
                _, p_teams = min(parents, key=lambda x: x[0])

                # Apply mutation
                if random.random() < self.config.MUTATION_RATE:
                    child = mutate(p_teams, self.mask, self.config.MUTATION_STRENGTH, self.config.USE_CAPTAINS)
                else:
                    child = [t.copy() for t in p_teams]

                new_pop.append((calculate_cost(child, self.config), child))

            self.population = new_pop

        self.population.sort(key=lambda x: x[0])
        elapsed = time.time() - start_time
        logger.success(f"Optimization completed in {elapsed:.2f} seconds. Final cost: {self.population[0][0]:.2f}")

        return self.population[0][1]


# --- JSON Conversion ---

def teams_to_json(teams: list[Team], mask: dict[str, int]) -> dict[str, typing.Any]:
    """Convert teams to JSON-serializable dictionary for API response."""
    result = {
        "teams": [],
        "statistics": {}
    }

    teams = sorted(teams, key=lambda t: t.mmr)

    for team in teams:
        # Find captain's name for team name
        captain_name = None
        for role, players in team.roster.items():
            for p in players:
                if p.is_captain:
                    captain_name = p.name
                    break
            if captain_name:
                break

        team_data = {
            "id": team.id,
            "name": captain_name,
            "avgMMR": round(team.mmr, 2),
            "variance": round(team.intra_std, 2),
            "totalDiscomfort": team.discomfort,
            "maxDiscomfort": team.max_pain,
            "roster": {}
        }

        for role, players in team.roster.items():
            team_data["roster"][role] = [
                {
                    "uuid": p.uuid,
                    "name": p.name,
                    "rating": p.get_rating(role),
                    "discomfort": p.get_discomfort(role),
                    "isCaptain": p.is_captain,
                    "preferences": p.preferences,
                    "allRatings": p.ratings
                }
                for p in players
            ]

        result["teams"].append(team_data)

    # Add statistics
    all_mmrs = [t.mmr for t in teams]
    if len(all_mmrs) > 1:
        result["statistics"] = {
            "averageMMR": round(statistics.mean(all_mmrs), 2),
            "mmrStdDev": round(statistics.stdev(all_mmrs), 2),
            "totalTeams": len(teams),
            "playersPerTeam": sum(mask.values())
        }
    else:
        result["statistics"] = {
            "averageMMR": round(all_mmrs[0], 2) if all_mmrs else 0,
            "mmrStdDev": 0,
            "totalTeams": len(teams),
            "playersPerTeam": sum(mask.values())
        }

    return result


def balance_teams(input_data: dict[str, typing.Any], config_overrides: dict[str, typing.Any] | None = None) -> dict[str, typing.Any]:
    config = AlgorithmConfig()

    if config_overrides:
        logger.info(f"Applying configuration overrides: {list(config_overrides.keys())}")
        for key, value in config_overrides.items():
            if hasattr(config, key):
                setattr(config, key, value)
                logger.debug(f"Set {key} = {value}")
            else:
                logger.warning(f"Unknown config parameter '{key}' ignored")

    mask = config.DEFAULT_MASK
    role_mapping = config.DEFAULT_ROLE_MAPPING

    logger.info(f"Loading players with mask: {mask}")

    all_players = load_players_from_dict(input_data, mask, role_mapping)
    needed_roles = [r for r, c in mask.items() if c > 0]
    valid_players = [p for p in all_players if any(p.can_play(r) for r in needed_roles)]

    if not valid_players:
        logger.error("No valid players found after filtering")
        raise ValueError("No valid players found")

    # Check role availability
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
        raise ValueError(f"Not enough players to form teams. Need at least {players_per_team} players, got {len(valid_players)}")

    # Check if we can actually form valid teams
    for role, count_needed in mask.items():
        if count_needed > 0:
            role_players = [p for p in valid_players if p.can_play(role)]
            min_teams_for_role = len(role_players) // count_needed
            if min_teams_for_role < num_teams:
                logger.warning(f"Role '{role}' constraint: can only form {min_teams_for_role} teams, adjusting from {num_teams}")
                num_teams = min_teams_for_role

    if num_teams == 0:
        role_stats = {role: len([p for p in valid_players if p.can_play(role)]) for role in mask.keys()}
        raise ValueError(f"Cannot form any valid teams. Role availability: {role_stats}, Required per team: {mask}")

    logger.info(f"Forming {num_teams} teams with {len(valid_players)} players")

    # Assign captains if enabled
    if config.USE_CAPTAINS:
        assign_captains(valid_players, num_teams)
        captain_count = sum(1 for p in valid_players if p.is_captain)
        logger.info(f"Assigned {captain_count} captains")

    # Run genetic optimizer
    opt = GeneticOptimizer(valid_players, num_teams, config)
    result = opt.run()

    # Convert to JSON
    return teams_to_json(result, mask)


def export_teams_to_json_file(teams_data: dict[str, typing.Any], output_path: str | Path) -> None:
    """
    Export balanced teams data to a JSON file.
    
    Args:
        teams_data: The teams dictionary returned from balance_teams()
        output_path: Path where the JSON file should be saved
        
    Raises:
        IOError: If the file cannot be written
    """
    output_path = Path(output_path)
    
    try:
        # Create parent directories if they don't exist
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write JSON with pretty formatting
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(teams_data, f, indent=2, ensure_ascii=False)
        
        logger.success(f"Teams exported successfully to {output_path}")
        
    except Exception as e:
        logger.error(f"Failed to export teams to {output_path}: {e}")
        raise IOError(f"Failed to export teams to file: {e}")


def export_captains_to_txt_file(teams_data: dict[str, typing.Any], output_path: str | Path) -> None:
    """
    Export captain names to a text file.
    
    Args:
        teams_data: The teams dictionary returned from balance_teams()
        output_path: Path where the text file should be saved
        
    Raises:
        IOError: If the file cannot be written
    """
    output_path = Path(output_path)
    
    try:
        # Create parent directories if they don't exist
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Extract captain names from teams
        captain_names = []
        for team in teams_data.get("teams", []):
            for role, players in team.get("roster", {}).items():
                for player in players:
                    if player.get("isCaptain", False):
                        captain_names.append(player["name"])
        
        # Write captain names to file (one per line)
        with open(output_path, 'w', encoding='utf-8') as f:
            for name in captain_names:
                f.write(f"{name}\n")
        
        logger.success(f"Exported {len(captain_names)} captain names to {output_path}")
        
    except Exception as e:
        logger.error(f"Failed to export captains to {output_path}: {e}")
        raise IOError(f"Failed to export captains to file: {e}")


def balance_and_export_teams(
    input_data: dict[str, typing.Any],
    output_path: str | Path,
    config_overrides: dict[str, typing.Any] | None = None
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
