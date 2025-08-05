import json
import random
import math
import copy
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Set
from uuid import uuid4

SUB_ROLE_PENALTY = 2500.0
RATING_DIFFERENCE_WEIGHT = 10.0
HIGH_RANK_DIVISION_THRESHOLD = 7
HIGH_RANK_PENALTY = SUB_ROLE_PENALTY * 2
CAPTAIN_PENALTY = SUB_ROLE_PENALTY * 2
CAPTAIN_MAX_DIVISION = 9  # Капитаны должны иметь дивизион <= 7 (рейтинг >= 1300)


@dataclass
class Player:
    name: str
    uuid: str
    roles: Dict[str, Tuple[int, int]]
    is_captain: bool
    is_full_flex: bool
    damage_types: Set[str] = field(default_factory=set)
    support_types: Set[str] = field(default_factory=set)

    def __hash__(self):
        return hash(self.uuid)

    def __eq__(self, other):
        if not isinstance(other, Player):
            return NotImplemented
        return self.uuid == other.uuid


@dataclass
class Team:
    tank: Optional[Player] = None
    damage1: Optional[Player] = None
    damage2: Optional[Player] = None
    support1: Optional[Player] = None
    support2: Optional[Player] = None
    captain: Optional[Player] = None
    uuid: str = field(default_factory=lambda: str(uuid4()))
    cached_rating: Optional[float] = None

    def get_players(self) -> List[Player]:
        return [p for p in [self.tank, self.damage1, self.damage2, self.support1, self.support2] if p]

    def get_all_slots(self) -> List[Tuple[str, Optional[Player]]]:
        return [
            ('tank', self.tank), ('damage1', self.damage1), ('damage2', self.damage2),
            ('support1', self.support1), ('support2', self.support2)
        ]


class TournamentBalancer:
    def __init__(self, players: List[Player], num_teams: Optional[int] = None):
        self.all_players = players
        self.tanks = [p for p in players if 'Tank' in p.roles or 'Flex' in p.roles]
        self.damages = [p for p in players if 'Dps' in p.roles or 'Flex' in p.roles]
        self.supports = [p for p in players if 'Support' in p.roles or 'Flex' in p.roles]
        self.validate_captains()  # Проверяем дивизионы капитанов
        self.num_teams = num_teams if num_teams is not None else self.calculate_num_teams()

        if len(players) < self.num_teams * 5:
            print(f"Внимание: Игроков ({len(players)}) недостаточно для полных {self.num_teams} команд по 5 человек.")

        self.best_teams_state: Optional[List[Team]] = None
        self.best_score = float('inf')
        self.temperature = 1000.0
        self.cooling_rate = 0.99
        self.max_iterations = 50000

    def validate_captains(self) -> None:
        """Проверяет и корректирует статус капитанов на основе их дивизионов."""
        for player in self.all_players:
            if player.is_captain:
                captain_role = 'tank' if 'Tank' in player.roles else 'damage' if 'Dps' in player.roles else 'support'
                if captain_role in ['tank', 'damage', 'support']:
                    div = self.rank_to_div(player, captain_role)
                    if div > CAPTAIN_MAX_DIVISION:
                        print(
                            f"Предупреждение: Игрок {player.name} не может быть капитаном (дивизион {div:.2f} > {CAPTAIN_MAX_DIVISION}). Устанавливаем is_captain=False.")
                        player.is_captain = False

    def calculate_num_teams(self) -> int:
        """Вычисляет максимальное количество команд на основе числа игроков и ролей."""
        total_players = len(self.all_players)
        num_tanks = len(self.tanks)
        num_damages = len(self.damages)
        num_supports = len(self.supports)
        num_captains = len([p for p in self.all_players if p.is_captain and self.rank_to_div(p,
                                                                                             'tank' if 'Tank' in p.roles else 'damage' if 'Dps' in p.roles else 'support') <= CAPTAIN_MAX_DIVISION])

        max_teams_by_players = total_players // 5
        max_teams_by_tanks = num_tanks
        max_teams_by_damages = num_damages // 2
        max_teams_by_supports = num_supports // 2
        max_teams_by_captains = num_captains if num_captains > 0 else float('inf')

        return max(1, min(max_teams_by_players, max_teams_by_tanks,
                          max_teams_by_damages, max_teams_by_supports,
                          max_teams_by_captains))

    @staticmethod
    def load_players_from_json(file_path: str) -> List[Player]:
        """Загружает и парсит игроков из JSON-файла."""
        try:
            with open(file_path, 'r', encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            raise FileNotFoundError(f"Файл '{file_path}' не найден.")
        except json.JSONDecodeError:
            raise ValueError(f"Ошибка в формате JSON-файла '{file_path}'.")

        players = []
        for player_data in data['players'].values():
            identity = player_data['identity']
            stats = player_data['stats']['classes']

            roles = {}
            for role_name, info in stats.items():
                role_key = role_name.capitalize()
                if info['isActive'] and info['rank'] > 0:
                    roles[role_key] = (info['rank'], info['priority'])
                elif identity['isFullFlex']:
                    roles[role_key] = (info['rank'] if info['rank'] > 0 else 1000, info['priority'])

            if identity['isFullFlex']:
                max_rating = max((info['rank'] for info in stats.values() if info['rank'] > 0), default=1000)
                roles['Flex'] = (max_rating, 0)

            damage_types = {'Hitscan', 'Projectile'} if 'Dps' in roles else set()
            support_types = {'Main', 'Light'} if 'Support' in roles else set()

            player = Player(
                name=identity['name'],
                uuid=identity['uuid'],
                roles=roles,
                is_captain=identity['isCaptain'],
                is_full_flex=identity['isFullFlex'],
                damage_types=damage_types,
                support_types=support_types
            )
            players.append(player)

        return players

    def _get_player_rating_for_role(self, player: Player, role: str) -> int:
        role_map = {'tank': 'Tank', 'damage': 'Dps', 'support': 'Support', 'team': 'Team'}
        main_role = role_map.get(role.lower().replace('1', '').replace('2', ''))
        if main_role in player.roles:
            return player.roles[main_role][0]
        if 'Flex' in player.roles:
            return player.roles['Flex'][0]
        return 0

    def rank_to_div(self, player: Optional[Player], role: str) -> float:
        if not player:
            return 1.0
        div = 20 - self._get_player_rating_for_role(player, role) / 100 + 1
        div = max(div, 1)
        return round(div)

    def _calculate_team_rating(self, team: Team) -> float:
        if team.cached_rating is not None:
            return team.cached_rating
        ratings = []
        if team.tank: ratings.append(self._get_player_rating_for_role(team.tank, 'tank'))
        if team.damage1: ratings.append(self._get_player_rating_for_role(team.damage1, 'damage'))
        if team.damage2: ratings.append(self._get_player_rating_for_role(team.damage2, 'damage'))
        if team.support1: ratings.append(self._get_player_rating_for_role(team.support1, 'support'))
        if team.support2: ratings.append(self._get_player_rating_for_role(team.support2, 'support'))

        team.cached_rating = sum(ratings) / len(ratings) if ratings else 0
        return team.cached_rating

    def _calculate_cost(self, teams: List[Team]) -> float:
        valid_teams = [team for team in teams if len(team.get_players()) > 0]
        if not valid_teams:
            return float('inf')

        ratings = [self._calculate_team_rating(team) for team in valid_teams]
        rating_diff = max(ratings) - min(ratings) if ratings else 0

        penalty = 0
        for team in teams:
            if team.damage1 and team.damage2:
                if not (team.damage1.damage_types - team.damage2.damage_types):
                    penalty += SUB_ROLE_PENALTY
            if team.support1 and team.support2:
                if not (team.support1.support_types - team.support2.support_types):
                    penalty += SUB_ROLE_PENALTY
            # Штраф за двух или более высокорейтинговых игроков (дивизион <= 7)
            players = team.get_players()
            high_rank_count = sum(1 for p in players if self.rank_to_div(p,
                                                                         'tank' if p == team.tank else 'damage' if p in [
                                                                             team.damage1,
                                                                             team.damage2] else 'support') <= HIGH_RANK_DIVISION_THRESHOLD)
            if high_rank_count >= 2:
                penalty += HIGH_RANK_PENALTY
            # Штраф за двух или более капитанов
            captain_count = sum(1 for p in players if p.is_captain)
            if captain_count >= 2:
                penalty += CAPTAIN_PENALTY

        return rating_diff * RATING_DIFFERENCE_WEIGHT + penalty

    def _create_initial_solution(self) -> List[Team]:
        teams = [Team() for _ in range(self.num_teams)]
        available_players = set(self.all_players)
        captains = sorted([p for p in available_players if p.is_captain and self.rank_to_div(p,
                                                                                             'tank' if 'Tank' in p.roles else 'damage' if 'Dps' in p.roles else 'support') <= CAPTAIN_MAX_DIVISION],
                          key=lambda p: max(r[0] for r in p.roles.values()), reverse=True)

        for i, team in enumerate(teams):
            if not captains:
                break
            captain = captains.pop(0)
            team.captain = captain
            best_role_name = max(captain.roles, key=lambda r: captain.roles[r][0])
            if best_role_name == 'Tank':
                team.tank = captain
            elif best_role_name == 'Dps':
                team.damage1 = captain
            elif best_role_name == 'Support':
                team.support1 = captain
            elif best_role_name == 'Flex' and not team.tank:
                team.tank = captain
            if captain in available_players:
                available_players.remove(captain)

        for role_slot in ['tank', 'damage1', 'damage2', 'support1', 'support2']:
            for team in teams:
                if getattr(team, role_slot) is None and available_players:
                    best_player = self._find_best_candidate(available_players, role_slot)
                    if best_player:
                        setattr(team, role_slot, best_player)
                        available_players.remove(best_player)

        for team in teams:
            team.cached_rating = self._calculate_team_rating(team)

        return teams

    def _find_best_candidate(self, available_players: Set[Player], role_slot: str) -> Optional[Player]:
        role_name = {'tank': 'Tank', 'damage1': 'Dps', 'damage2': 'Dps', 'support1': 'Support', 'support2': 'Support'}[
            role_slot]
        candidates = [p for p in available_players if role_name in p.roles or 'Flex' in p.roles]
        if not candidates:
            return None

        candidates.sort(key=lambda p: (
            p.roles.get(role_name, p.roles.get('Flex', (0, 99)))[1],
            -self._get_player_rating_for_role(p, role_slot)
        ))
        return candidates[0]

    def _generate_neighbor(self, teams: List[Team]) -> Optional[Tuple]:
        try:
            ratings = [(i, self._calculate_team_rating(team)) for i, team in enumerate(teams) if team.tank]
            if not ratings:
                return None
            max_team_idx = max(ratings, key=lambda x: x[1])[0]
            min_team_idx = min(ratings, key=lambda x: x[1])[0]
            team1, team2 = teams[max_team_idx], teams[min_team_idx]

            team1_slots = [s for s, p in team1.get_all_slots() if p and not p.is_captain]
            team2_slots = [s for s, p in team2.get_all_slots() if p and not p.is_captain]

            if not team1_slots or not team2_slots:
                return None

            slot1_name = random.choice(team1_slots)
            slot2_name = random.choice(team2_slots)

            player1 = getattr(team1, slot1_name)
            player2 = getattr(team2, slot2_name)

            role1_name = 'Tank' if slot1_name == 'tank' else 'Dps' if 'damage' in slot1_name else 'Support'
            role2_name = 'Tank' if slot2_name == 'tank' else 'Dps' if 'damage' in slot2_name else 'Support'

            p1_can_play_role2 = role2_name in player1.roles or 'Flex' in player1.roles
            p2_can_play_role1 = role1_name in player2.roles or 'Flex' in player2.roles

            if not (p1_can_play_role2 and p2_can_play_role1):
                return None

            if role1_name in player1.roles and player1.roles[role1_name][1] > 2:
                return None
            if role2_name in player2.roles and player2.roles[role2_name][1] > 2:
                return None

            setattr(team1, slot1_name, player2)
            setattr(team2, slot2_name, player1)
            team1.cached_rating = None
            team2.cached_rating = None

            return (team1, slot1_name, player1, team2, slot2_name, player2)

        except (ValueError, IndexError):
            return None

    def balance(self) -> List[Team]:
        current_teams = self._create_initial_solution()
        current_score = self._calculate_cost(current_teams)
        self.best_teams_state = copy.deepcopy(current_teams)
        self.best_score = current_score

        for i in range(self.max_iterations):
            if self.best_score / RATING_DIFFERENCE_WEIGHT <= 60:
                break
            swap_info = self._generate_neighbor(current_teams)

            if not swap_info:
                continue

            neighbor_score = self._calculate_cost(current_teams)

            if neighbor_score < current_score or random.random() < math.exp(
                    (current_score - neighbor_score) / self.temperature):
                current_score = neighbor_score
                if current_score < self.best_score:
                    self.best_teams_state = copy.deepcopy(current_teams)
                    self.best_score = current_score
            else:
                team1, slot1, p1, team2, slot2, p2 = swap_info
                setattr(team1, slot1, p1)
                setattr(team2, slot2, p2)
                team1.cached_rating = None
                team2.cached_rating = None

            self.temperature *= self.cooling_rate

            if i > 0 and i % 1000 == 0:
                rating_diff = current_score / RATING_DIFFERENCE_WEIGHT
                print(
                    f"Итерация {i}, Текущий счет: {current_score:.2f}, Лучший счет: {self.best_score:.2f}, Разница рейтингов: {rating_diff:.2f}, T: {self.temperature:.2f}")

        rating_diff = self.best_score / RATING_DIFFERENCE_WEIGHT
        print(f"\nБалансировка завершена. Лучшая достигнутая разница в рейтинге: {rating_diff:.2f}")
        return self.best_teams_state

    def print_teams(self, teams: List[Team]) -> None:
        if not teams:
            print("Нет команд для отображения.")
            return

        print(f"\nNumber of Teams: {self.num_teams}")
        unused_players = set(self.all_players) - set(p for team in teams for p in team.get_players())
        print(f"Unused Players: {len(unused_players)}")
        for i, team in enumerate(teams):
            team_rating = self._calculate_team_rating(team)
            team_division = self.rank_to_div(None, 'team') if team_rating == 0 else self.rank_to_div(
                Player(name="team", uuid="team", roles={'Team': (team_rating, 0)}, is_captain=False,
                       is_full_flex=False), 'team')
            print(f"\nTeam {i + 1} (Average Rating: {team_rating:.2f}, Division: {team_division:.2f}):")
            warnings = []
            high_rank_count = sum(1 for p in team.get_players() if self.rank_to_div(p,
                                                                                    'tank' if p == team.tank else 'damage' if p in [
                                                                                        team.damage1,
                                                                                        team.damage2] else 'support') <= HIGH_RANK_DIVISION_THRESHOLD)
            captain_count = sum(1 for p in team.get_players() if p.is_captain)
            captain_div_invalid = team.captain and self.rank_to_div(team.captain,
                                                                    'tank' if team.captain == team.tank else 'damage' if team.captain in [
                                                                        team.damage1,
                                                                        team.damage2] else 'support') > CAPTAIN_MAX_DIVISION
            # Проверка dubspecs для Damage
            if team.damage1 and team.damage2 and not (team.damage1.damage_types - team.damage2.damage_types):
                warnings.append("Dubspec Damage")
            # Проверка dubspecs для Support
            if team.support1 and team.support2 and not (team.support1.support_types - team.support2.support_types):
                warnings.append("Dubspec Support")
            # Проверка других недопустимых условий
            if high_rank_count >= 2:
                warnings.append("Multiple high-rank players (div <= 7)")
            if captain_count >= 2:
                warnings.append("Multiple captains")
            if captain_div_invalid:
                warnings.append("Invalid captain division")
            if warnings:
                print(f"  [WARNING: Invalid team composition - {', '.join(warnings)}]")
            print(
                f"  Tank: {team.tank.name + ' (Captain)' if team.tank and team.tank.is_captain else team.tank.name if team.tank else 'None'} (UUID: {team.tank.uuid if team.tank else 'None'}, Division: {self.rank_to_div(team.tank, 'tank'):.2f})")
            print(
                f"  Damage1: {team.damage1.name + ' (Captain)' if team.damage1 and team.damage1.is_captain else team.damage1.name if team.damage1 else 'None'} (UUID: {team.damage1.uuid if team.damage1 else 'None'}, Type: {team.damage1.damage_types if team.damage1 else 'Any'}, Division: {self.rank_to_div(team.damage1, 'damage'):.2f})")
            print(
                f"  Damage2: {team.damage2.name + ' (Captain)' if team.damage2 and team.damage2.is_captain else team.damage2.name if team.damage2 else 'None'} (UUID: {team.damage2.uuid if team.damage2 else 'None'}, Type: {team.damage2.damage_types if team.damage2 else 'Any'}, Division: {self.rank_to_div(team.damage2, 'damage'):.2f})")
            print(
                f"  Support1: {team.support1.name + ' (Captain)' if team.support1 and team.support1.is_captain else team.support1.name if team.support1 else 'None'} (UUID: {team.support1.uuid if team.support1 else 'None'}, Type: {team.support1.support_types if team.support1 else 'Any'}, Division: {self.rank_to_div(team.support1, 'support'):.2f})")
            print(
                f"  Support2: {team.support2.name + ' (Captain)' if team.support2 and team.support2.is_captain else team.support2.name if team.support2 else 'None'} (UUID: {team.support2.uuid if team.support2 else 'None'}, Type: {team.support2.support_types if team.support2 else 'Any'}, Division: {self.rank_to_div(team.support2, 'support'):.2f})")
            print(
                f"  Captain: {team.captain.name if team.captain else 'None'} (UUID: {team.captain.uuid if team.captain else 'None'}, Division: {self.rank_to_div(team.captain, 'tank' if team.captain == team.tank else 'damage' if team.captain in [team.damage1, team.damage2] else 'support'):.2f})")


if __name__ == "__main__":
    try:
        file_path = "players-18.07.2025, 05_19_27.json"
        players = TournamentBalancer.load_players_from_json(file_path)
        print(f"Загружено {len(players)} игроков. Формируем максимальное количество команд.")

        balancer = TournamentBalancer(players, num_teams=17)
        balanced_teams = balancer.balance()
        balancer.print_teams(balanced_teams)

        final_cost = balancer._calculate_cost(balanced_teams)
        rating_diff = (final_cost % SUB_ROLE_PENALTY) / RATING_DIFFERENCE_WEIGHT
        print(f"\nИтоговая разница в рейтингах между самой сильной и слабой командой: {rating_diff:.2f}")

    except FileNotFoundError:
        print(f"Ошибка: Файл '{file_path}' не найден. Убедитесь, что он находится в той же директории.")
    except Exception as e:
        print(f"Произошла непредвиденная ошибка: {e}")