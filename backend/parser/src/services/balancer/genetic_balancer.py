import json
import random
import statistics
import time
from typing import Dict, List, Optional


# --- 1. Настройки и Конфигурация ---

class Config:
    # Маска ролей
    MASK = {'DPS': 3, 'Support': 2}

    # Параметры генетического алгоритма
    POPULATION_SIZE = 200
    GENERATIONS = 750
    ELITISM_RATE = 0.2
    MUTATION_RATE = 0.4
    MUTATION_STRENGTH = 3

    # === ВЕСА (Бизнес-логика) ===
    MMR_DIFF_WEIGHT = 3.0
    DISCOMFORT_WEIGHT = 0.25
    INTRA_TEAM_VAR_WEIGHT = 0.8
    MAX_DISCOMFORT_WEIGHT = 1.0

    # Настройки отображения
    CARDS_PER_ROW = 3  # Сколько карточек в одной строке
    CARD_WIDTH = 40  # Ширина одной карточки в символах

    # Стратегии
    USE_CAPTAINS = True
    ROLE_MAPPING = {"tank": "Tank", "dps": "DPS", "support": "Support"}


# --- 2. Игровые Классы ---

class Player:
    __slots__ = ('uuid', 'name', 'ratings', 'preferences', 'discomfort_map', 'is_captain', '_max_rating')

    def __init__(self, name: str, ratings: Dict[str, int], preferences: List[str], uuid: str):
        self.uuid = uuid
        self.name = name
        self.ratings = ratings
        self.preferences = preferences
        self.is_captain = False
        self._max_rating = max(ratings.values()) if ratings else 0

        self.discomfort_map = {}
        for role in Config.MASK.keys():
            if role in preferences:
                self.discomfort_map[role] = preferences.index(role) * 100
            else:
                self.discomfort_map[role] = 1000 if role in ratings else 5000

    @property
    def max_rating(self):
        return self._max_rating

    def get_rating(self, role: str) -> int:
        return self.ratings.get(role, 0)

    def can_play(self, role: str) -> bool:
        return role in self.ratings

    def get_discomfort(self, current_role: str) -> int:
        return self.discomfort_map.get(current_role, 5000)

    def __repr__(self):
        return f"{self.name}"


class Team:
    __slots__ = ('id', 'roster', '_cached_mmr', '_cached_discomfort',
                 '_cached_intra_std', '_cached_max_pain', '_is_dirty')

    def __init__(self, t_id: int):
        self.id = t_id
        self.roster = {role: [] for role in Config.MASK if Config.MASK[role] > 0}
        self._cached_mmr = 0.0
        self._cached_discomfort = 0.0
        self._cached_intra_std = 0.0
        self._cached_max_pain = 0
        self._is_dirty = True

    def copy(self) -> 'Team':
        new_team = Team(self.id)
        new_team.roster = {r: list(p_list) for r, p_list in self.roster.items()}
        new_team._cached_mmr = self._cached_mmr
        new_team._cached_discomfort = self._cached_discomfort
        new_team._cached_intra_std = self._cached_intra_std
        new_team._cached_max_pain = self._cached_max_pain
        new_team._is_dirty = self._is_dirty
        return new_team

    def add_player(self, role: str, player: Player) -> bool:
        if len(self.roster[role]) < Config.MASK[role]:
            self.roster[role].append(player)
            self._is_dirty = True
            return True
        return False

    def replace_player(self, role: str, index: int, new_player: Player):
        self.roster[role][index] = new_player
        self._is_dirty = True

    def calculate_stats(self):
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
    def mmr(self):
        if self._is_dirty: self.calculate_stats()
        return self._cached_mmr

    @property
    def discomfort(self):
        if self._is_dirty: self.calculate_stats()
        return self._cached_discomfort

    @property
    def intra_std(self):
        if self._is_dirty: self.calculate_stats()
        return self._cached_intra_std

    @property
    def max_pain(self):
        if self._is_dirty: self.calculate_stats()
        return self._cached_max_pain

    def is_full(self) -> bool:
        for role, needed in Config.MASK.items():
            if len(self.roster.get(role, [])) < needed: return False
        return True


# --- 3. Логика GA ---

def calculate_cost(teams: List[Team]) -> float:
    mmrs = []
    total_avg_discomfort = 0
    total_intra_std = 0
    global_max_pain = 0

    for t in teams:
        mmrs.append(t.mmr)
        total_avg_discomfort += t.discomfort
        total_intra_std += t.intra_std
        if t.max_pain > global_max_pain:
            global_max_pain = t.max_pain

    inter_team_std = statistics.stdev(mmrs) if len(mmrs) > 1 else 0
    avg_discomfort = total_avg_discomfort / len(teams)
    avg_intra_std = total_intra_std / len(teams)

    cost = (
            (inter_team_std * Config.MMR_DIFF_WEIGHT) +
            (avg_discomfort * Config.DISCOMFORT_WEIGHT) +
            (avg_intra_std * Config.INTRA_TEAM_VAR_WEIGHT) +
            (global_max_pain * Config.MAX_DISCOMFORT_WEIGHT)
    )
    return cost


# --- 4. Утилиты ---

def parse_player_node(uuid: str, data: dict) -> Optional[Player]:
    try:
        name = data.get('identity', {}).get('name', 'Unknown')
        raw_classes = data.get('stats', {}).get('classes', {})
        ratings = {}
        role_priorities = []

        for json_role, stats in raw_classes.items():
            if not stats.get('isActive', False): continue
            rank = stats.get('rank', 0)
            if rank <= 0: continue
            algo_role = Config.ROLE_MAPPING.get(json_role)
            if not algo_role or algo_role not in Config.MASK: continue
            ratings[algo_role] = rank
            priority = stats.get('priority', 99)
            role_priorities.append((priority, algo_role))

        if not ratings: return None
        role_priorities.sort(key=lambda x: x[0])
        preferences = [r for _, r in role_priorities]
        return Player(name, ratings, preferences, uuid)
    except Exception:
        return None


def load_players(file_path: str) -> List[Player]:
    players_list = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        data_root = raw.get('data', {})
        if 'data' in data_root and 'players' in data_root['data']:
            players_dict = data_root['data']['players']
        elif 'players' in data_root:
            players_dict = data_root['players']
        elif 'players' in raw:
            players_dict = raw['players']
        else:
            players_dict = raw.get('players', {})

        for uuid, p_data in players_dict.items():
            p = parse_player_node(uuid, p_data)
            if p: players_list.append(p)
    except Exception as e:
        print(f"Error loading JSON: {e}")
    return players_list


def assign_captains(players: List[Player], count: int):
    for p in players: p.is_captain = False
    sorted_players = sorted(players, key=lambda p: p.max_rating, reverse=True)
    for i in range(min(count, len(sorted_players))):
        sorted_players[i].is_captain = True


def create_random_solution(players: List[Player], num_teams: int) -> List[Team]:
    teams = [Team(i + 1) for i in range(num_teams)]
    captains = [p for p in players if p.is_captain]
    pool = [p for p in players if not p.is_captain]
    random.shuffle(captains)
    random.shuffle(pool)

    if Config.USE_CAPTAINS:
        for team in teams:
            if not captains: break
            cap = captains.pop()
            assigned = False
            for role in cap.preferences:
                if role in Config.MASK and team.add_player(role, cap):
                    assigned = True;
                    break
            if not assigned:
                for role in Config.MASK:
                    if cap.can_play(role) and team.add_player(role, cap):
                        assigned = True;
                        break
            if not assigned: pool.append(cap)
        pool.extend(captains)
        random.shuffle(pool)

    for role, count in Config.MASK.items():
        if count == 0: continue
        candidates = [p for p in pool if p.can_play(role)]
        random.shuffle(candidates)
        for team in teams:
            needed = count - len(team.roster[role])
            for _ in range(needed):
                if not candidates: break
                player = candidates.pop()
                team.add_player(role, player)
                pool.remove(player)
    return teams


def mutate(teams: List[Team]) -> List[Team]:
    new_teams_list = [t.copy() for t in teams]
    available_roles = [r for r, c in Config.MASK.items() if c > 0]
    if not available_roles: return new_teams_list

    for _ in range(Config.MUTATION_STRENGTH):
        if random.random() < 0.7:
            t1_idx, t2_idx = random.sample(range(len(new_teams_list)), 2)
            t1, t2 = new_teams_list[t1_idx], new_teams_list[t2_idx]
            role = random.choice(available_roles)
            if t1.roster[role] and t2.roster[role]:
                idx1 = random.randint(0, len(t1.roster[role]) - 1)
                idx2 = random.randint(0, len(t2.roster[role]) - 1)
                p1, p2 = t1.roster[role][idx1], t2.roster[role][idx2]
                if Config.USE_CAPTAINS and (p1.is_captain or p2.is_captain): continue
                t1.replace_player(role, idx1, p2)
                t2.replace_player(role, idx2, p1)
        else:
            t = random.choice(new_teams_list)
            if len(available_roles) < 2: continue
            r1, r2 = random.sample(available_roles, 2)
            cand_r1 = [i for i, p in enumerate(t.roster[r1]) if p.can_play(r2)]
            cand_r2 = [i for i, p in enumerate(t.roster[r2]) if p.can_play(r1)]
            if cand_r1 and cand_r2:
                i1, i2 = random.choice(cand_r1), random.choice(cand_r2)
                p1, p2 = t.roster[r1][i1], t.roster[r2][i2]
                t.replace_player(r1, i1, p2)
                t.replace_player(r2, i2, p1)
    return new_teams_list


class GeneticOptimizer:
    def __init__(self, players, num_teams):
        self.players = players
        self.num_teams = num_teams
        self.population = []

    def run(self):
        start_time = time.time()
        print("Инициализация...")
        attempts = 0
        while len(self.population) < Config.POPULATION_SIZE and attempts < Config.POPULATION_SIZE * 10:
            sol = create_random_solution(self.players, self.num_teams)
            if all(t.is_full() for t in sol):
                self.population.append((calculate_cost(sol), sol))
            attempts += 1

        if not self.population: raise ValueError("Не удалось собрать команды!")

        while len(self.population) < Config.POPULATION_SIZE:
            c, t = random.choice(self.population)
            self.population.append((c, [x.copy() for x in t]))

        print(f"Старт эволюции ({Config.GENERATIONS} поколений)...")
        elite_count = int(Config.POPULATION_SIZE * Config.ELITISM_RATE)

        for gen in range(Config.GENERATIONS):
            self.population.sort(key=lambda x: x[0])
            if gen % 50 == 0:
                print(f"Gen {gen:03d} | Cost: {self.population[0][0]:.2f}")
            if self.population[0][0] <= 0.1: break
            new_pop = self.population[:elite_count]
            while len(new_pop) < Config.POPULATION_SIZE:
                parents = random.sample(self.population[:50], 2)
                _, p_teams = min(parents, key=lambda x: x[0])
                child = mutate(p_teams)
                new_pop.append((calculate_cost(child), child))
            self.population = new_pop

        self.population.sort(key=lambda x: x[0])
        print(f"Завершено за {time.time() - start_time:.2f} сек.")
        return self.population[0][1]


# --- 5. Функция Вывода КАРТОЧКАМИ (GRID VIEW) ---

def render_team_card(team: Team, width: int) -> List[str]:
    """Генерирует список строк для одной карточки команды"""
    lines = []

    # Границы
    border = "+" + "-" * (width - 2) + "+"

    # 1. Заголовок
    # TEAM #1 (Avg: 2500 Var: 150)
    title_text = f"TEAM #{team.id}"
    stats_text = f"Avg:{team.mmr:.0f} Var:{team.intra_std:.0f}"

    lines.append(border)
    lines.append(f"| {title_text:<{width - 4}} |")
    lines.append(f"| {stats_text:^{width - 4}} |")
    lines.append(border)

    # 2. Состав по ролям
    sorted_roles = sorted(Config.MASK.keys())

    for role in sorted_roles:
        count = Config.MASK[role]
        if count == 0: continue

        # Заголовок роли: [ DPS ]------
        role_header = f" [{role}]"
        padding_len = width - 2 - len(role_header) - 1
        lines.append(f"|{role_header}{'-' * padding_len} |")

        # Игроки
        if role in team.roster:
            for p in team.roster[role]:
                # Значки
                cap = "👑" if p.is_captain else ""
                disc = p.get_discomfort(role)
                if disc == 0:
                    heart = "❤️"
                elif disc >= 1000:
                    heart = "💔"
                else:
                    heart = "💛"

                rating = p.get_rating(role)

                # Формируем строку: 2500 👑❤️ Nickname
                # Считаем место под имя
                # 2 (граница) + 4 (рейт) + 1 + 2 (иконки) + 1 + Name + 2 (граница) = width
                # Name = width - 12
                name_max_len = width - 13
                p_name = (p.name[:name_max_len - 2] + "..") if len(p.name) > name_max_len else p.name

                content = f"{rating:<4} {cap}{heart} {p_name}"
                # Добиваем пробелами. Учитываем, что эмодзи иногда ломают длину в консоли,
                # поэтому используем чуть больший запас, если нужно, или просто ljust.
                # Простой ljust считает символы, эмодзи = 1 символ.

                # Хак выравнивания: считаем реальную длину без учета эмодзи и добавляем пробелы вручную
                lines.append(f"| {content:<{width - 4}} |")

    lines.append(border)
    return lines


def print_teams_as_grid(teams: List[Team]):
    """Печатает команды по N штук в ряд"""
    cols = Config.CARDS_PER_ROW
    card_w = Config.CARD_WIDTH

    # Разбиваем на чанки (строки сетки)
    for i in range(0, len(teams), cols):
        chunk = teams[i: i + cols]

        # Рендерим карточки для текущего ряда
        rendered_cards = [render_team_card(t, card_w) for t in chunk]

        # Определяем высоту ряда (максимальную среди карточек)
        max_height = max(len(rc) for rc in rendered_cards)

        # Печатаем построчно
        print("\n")  # Отступ между рядами
        for line_idx in range(max_height):
            row_str = ""
            for card_lines in rendered_cards:
                # Берем строку карточки или пробелы, если карточка кончилась
                if line_idx < len(card_lines):
                    row_str += card_lines[line_idx] + "  "  # 2 пробела между карточками
                else:
                    row_str += " " * card_w + "  "
            print(row_str)


# --- 6. Запуск ---

if __name__ == "__main__":
    FILENAME = "tournament_39.json"  # <--- Укажите ваш файл

    all_players = load_players(FILENAME)
    needed_roles = [r for r, c in Config.MASK.items() if c > 0]
    valid_players = [p for p in all_players if any(p.can_play(r) for r in needed_roles)]

    players_per_team = sum(Config.MASK.values())
    num_teams = len(valid_players) // players_per_team if players_per_team > 0 else 0

    print(f"Игроков: {len(valid_players)}. Команд: {num_teams}")
    print(f"Сетка: {Config.CARDS_PER_ROW} команды в ряд")

    if num_teams > 0:
        if Config.USE_CAPTAINS: assign_captains(valid_players, num_teams)
        opt = GeneticOptimizer(valid_players, num_teams)
        try:
            result = opt.run()

            # ВЫЗОВ НОВОЙ ФУНКЦИИ ВЫВОДА (СЕТКА)
            print_teams_as_grid(result)

            # Статистика внизу
            all_mmrs = [t.mmr for t in result]
            if len(all_mmrs) > 1:
                print(f"\nСтатистика турнира:")
                print(f"  Средний MMR: {statistics.mean(all_mmrs):.0f}")
                print(f"  Разброс MMR (StDev): {statistics.stdev(all_mmrs):.2f}")
                print(f"  Легенда: 👑=Кэп, ❤️=Мейн, 💛=Офф-роль, 💔=Нет рейта")

        except ValueError as e:
            print(e)