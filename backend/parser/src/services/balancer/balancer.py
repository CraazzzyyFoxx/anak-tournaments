import json
import random
import statistics
import math
import copy
from typing import Dict, List, Optional
from pydantic import BaseModel

# --- 1. Настройки ---

# Если True - алгоритм выберет лучших игроков капитанами и распределит по 1 на команду.
USE_CAPTAINS_STRATEGY = True

# Вес комфорта (0.0 - только MMR, 2.0 - только пожелания игроков)
DISCOMFORT_WEIGHT = 0.5

ROLE_MAPPING = {
    "tank": "Tank",
    "dps": "DPS",
    "support": "Support"
}


# --- 2. Pydantic Модели ---

class RoleStats(BaseModel):
    rank: int
    playHours: float
    priority: int
    isActive: bool


class PlayerStats(BaseModel):
    classes: Dict[str, RoleStats]


class PlayerIdentity(BaseModel):
    name: str
    uuid: str


class PlayerData(BaseModel):
    identity: PlayerIdentity
    stats: PlayerStats


class RootData(BaseModel):
    data: Dict[str, dict]  # Упрощаем корневую структуру для гибкости чтения


class TournamentData(BaseModel):
    players: Dict[str, PlayerData]


class FullJsonRoot(BaseModel):
    data: TournamentData


# --- 3. Основные классы ---

class Player:
    def __init__(self, name, ratings, preferences):
        self.name = name
        self.ratings = ratings
        self.preferences = preferences
        self.is_captain = False

    @property
    def max_rating(self):
        """Возвращает максимальный рейтинг игрока на любой роли"""
        if not self.ratings: return 0
        return max(self.ratings.values())

    def can_play(self, role):
        return role in self.ratings

    def get_rating(self, role):
        return self.ratings.get(role, 0)

    def get_discomfort(self, current_role):
        if current_role not in self.preferences:
            return 1000
        index = self.preferences.index(current_role)
        return index * 100

    def __repr__(self):
        tag = " [C]" if self.is_captain else ""
        return f"{self.name}{tag}"


class Team:
    def __init__(self, id, mask):
        self.id = id
        self.mask = mask
        self.roster = {role: [] for role in mask}

    def add_player(self, role, player):
        if len(self.roster[role]) < self.mask[role]:
            self.roster[role].append(player)
            return True
        return False

    def get_team_mmr(self):
        total_rating = 0
        count = 0
        for role, players in self.roster.items():
            for p in players:
                total_rating += p.get_rating(role)
                count += 1
        return total_rating / count if count > 0 else 0

    def get_team_discomfort(self):
        total_pain = 0
        for role, players in self.roster.items():
            for p in players:
                total_pain += p.get_discomfort(role)
        return total_pain

    def is_full(self):
        for role, needed in self.mask.items():
            if len(self.roster[role]) < needed:
                return False
        return True


# --- 4. Загрузка данных ---

def load_players_from_json(file_path: str) -> List[Player]:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)
        parsed_root = FullJsonRoot(**raw_data)
    except Exception as e:
        print(f"Ошибка загрузки: {e}")
        return []

    players_list = []
    for uuid, p_data in parsed_root.data.players.items():
        name = p_data.identity.name
        ratings = {}
        role_priorities = []

        for json_role, stats in p_data.stats.classes.items():
            if not stats.isActive or stats.rank <= 0: continue
            algo_role = ROLE_MAPPING.get(json_role)
            if not algo_role: continue

            ratings[algo_role] = stats.rank
            role_priorities.append((stats.priority, algo_role))

        if not ratings: continue

        role_priorities.sort(key=lambda x: x[0])
        preferences = [role for priority, role in role_priorities]

        players_list.append(Player(name, ratings, preferences))

    return players_list


def assign_captains(players: List[Player], count: int):
    """Сортирует игроков по пиковому рейтингу и назначает топ-N капитанами."""
    sorted_players = sorted(players, key=lambda p: p.max_rating, reverse=True)
    for p in players: p.is_captain = False

    captains_count = 0
    for i in range(len(sorted_players)):
        if captains_count < count:
            sorted_players[i].is_captain = True
            captains_count += 1
        else:
            break
    print(f"Назначено {captains_count} капитанов.")


# --- 5. ФУНКЦИЯ ОЦЕНКИ (КОТОРУЮ Я ПРОПУСТИЛ) ---

def calculate_system_cost(teams):
    """
    Считает, насколько плоха текущая расстановка.
    Цель - минимизировать это число.
    """
    mmrs = [t.get_team_mmr() for t in teams]
    if len(mmrs) < 2: return 0

    # 1. Разброс по MMR (стандартное отклонение)
    mmr_stdev = statistics.stdev(mmrs)

    # 2. Общий дискомфорт (средний штраф за нелюбимые роли)
    total_discomfort = sum([t.get_team_discomfort() for t in teams])
    avg_discomfort = total_discomfort / len(teams)

    return mmr_stdev + (avg_discomfort * DISCOMFORT_WEIGHT)


# --- 6. Распределение и Оптимизация ---

def initial_distribution(players, num_teams, mask):
    teams = [Team(i + 1, mask) for i in range(num_teams)]

    if USE_CAPTAINS_STRATEGY:
        captains = [p for p in players if p.is_captain]
        regulars = [p for p in players if not p.is_captain]

        # Добиваем капитанов, если их мало
        if len(captains) < num_teams:
            regulars.sort(key=lambda p: p.max_rating, reverse=True)
            needed = num_teams - len(captains)
            new_caps = regulars[:needed]
            for nc in new_caps: nc.is_captain = True
            captains.extend(new_caps)
            regulars = regulars[needed:]

        random.shuffle(captains)
        random.shuffle(regulars)

        # Рассаживаем капитанов
        for team in teams:
            if not captains: break
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
                regulars.append(cap)

        pool = regulars
    else:
        pool = list(players)
        random.shuffle(pool)

    # Заполняем остальными
    random.shuffle(pool)
    for team in teams:
        for role in mask:
            needed = mask[role] - len(team.roster[role])
            for _ in range(needed):
                for i, p in enumerate(pool):
                    if p.can_play(role):
                        team.add_player(role, pool.pop(i))
                        break

    return teams, pool


def simulated_annealing(teams, iterations=30000, initial_temp=1500, cooling_rate=0.997):
    current_teams = teams
    current_cost = calculate_system_cost(current_teams)  # Теперь функция существует!

    best_teams = copy.deepcopy(current_teams)
    best_cost = current_cost
    temp = initial_temp

    print(f"Старт балансировки. Cost={current_cost:.2f}")

    for i in range(iterations):
        candidate_teams = copy.deepcopy(current_teams)
        mutation_type = random.random()
        valid_mutation = False

        # 1. Обмен между командами
        if mutation_type < 0.7:
            role_to_swap = random.choice(list(teams[0].mask.keys()))
            t1_idx, t2_idx = random.sample(range(len(candidate_teams)), 2)
            team1, team2 = candidate_teams[t1_idx], candidate_teams[t2_idx]

            if team1.roster[role_to_swap] and team2.roster[role_to_swap]:
                p1_idx = random.randint(0, len(team1.roster[role_to_swap]) - 1)
                p2_idx = random.randint(0, len(team2.roster[role_to_swap]) - 1)

                p1 = team1.roster[role_to_swap][p1_idx]
                p2 = team2.roster[role_to_swap][p2_idx]

                # Запрещаем менять капитана на обычного игрока
                if USE_CAPTAINS_STRATEGY and (p1.is_captain != p2.is_captain):
                    continue

                team1.roster[role_to_swap][p1_idx] = p2
                team2.roster[role_to_swap][p2_idx] = p1
                valid_mutation = True

        # 2. Смена ролей внутри команды
        else:
            team = random.choice(candidate_teams)
            roles = list(team.mask.keys())
            r1, r2 = random.sample(roles, 2)

            cand_r1 = [p for p in team.roster[r1] if p.can_play(r2)]
            cand_r2 = [p for p in team.roster[r2] if p.can_play(r1)]

            if cand_r1 and cand_r2:
                p1, p2 = random.choice(cand_r1), random.choice(cand_r2)
                team.roster[r1].remove(p1)
                team.roster[r2].remove(p2)
                team.roster[r2].append(p1)
                team.roster[r1].append(p2)
                valid_mutation = True

        if not valid_mutation: continue

        new_cost = calculate_system_cost(candidate_teams)
        delta = new_cost - current_cost

        if delta < 0 or random.random() < math.exp(-delta / temp):
            current_teams = candidate_teams
            current_cost = new_cost
            if current_cost < best_cost:
                best_cost = current_cost
                best_teams = copy.deepcopy(current_teams)

        temp *= cooling_rate
        if temp < 0.001: break

    print(f"Финиш. Cost={best_cost:.2f}")
    return best_teams


# --- 7. Запуск ---

if __name__ == "__main__":
    MASK = {'DPS': 3    , 'Support': 2}
    FILENAME = "tournament_39.json"  # Убедитесь, что файл лежит рядом

    all_players = load_players_from_json(FILENAME)

    players_per_team = sum(MASK.values())
    if len(all_players) == 0:
        print("Игроки не найдены.")
        exit()

    max_teams = len(all_players) // players_per_team
    print(f"Игроков: {len(all_players)}. Команд: {max_teams}")

    if max_teams > 0:
        if USE_CAPTAINS_STRATEGY:
            assign_captains(all_players, max_teams)

        initial_teams, bench = initial_distribution(all_players, max_teams, MASK)
        valid_teams = [t for t in initial_teams if t.is_full()]

        final_teams = simulated_annealing(valid_teams)

        final_teams = sorted(final_teams, key=lambda x: x.get_team_mmr())

        print("\n" + "=" * 60)
        teams_ratings = []
        for t in final_teams:
            rating = t.get_team_mmr()
            teams_ratings.append(rating)

            cap_names = [p.name for role in t.roster for p in t.roster[role] if p.is_captain]
            cap_str = f"👑 {cap_names[0]}" if cap_names else "⚠️ НЕТ КАПИТАНА"

            print(f"\nTEAM #{t.id} | Avg: {rating:.0f} | {cap_str}")
            for role, count in MASK.items():
                for p in t.roster[role]:
                    icon = "👑" if p.is_captain else ""
                    # Показываем сердечко, если роль любимая
                    pref = "❤️" if p.preferences and p.preferences[0] == role else ""
                    print(f"  {role:<8} | {p.get_rating(role):<4} | {p.name} {icon} {pref}")

        print("-" * 60)
        if len(teams_ratings) > 1:
            print(f"Разброс MMR: {max(teams_ratings) - min(teams_ratings):.0f}")