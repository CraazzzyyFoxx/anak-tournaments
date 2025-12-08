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
    # 1. Равенство команд (чтобы средний рейтинг команд был близким)
    MMR_DIFF_WEIGHT = 3.0

    # 2. Общий комфорт (среднее по больнице)
    DISCOMFORT_WEIGHT = 0.25

    # [NEW] 3. Внутрикомандный баланс (Consistency)
    # Штраф, если в одной команде играют Грандмастер и Бронза.
    # Чем выше вес, тем "ровнее" будут игроки внутри одной команды.
    INTRA_TEAM_VAR_WEIGHT = 0.8

    # [NEW] 4. Справедливость (Fairness)
    # Огромный штраф за "жертву". Алгоритм будет изо всех сил стараться избегать ситуации,
    # когда один человек страдает (дискомфорт 1000+), даже если это выгодно для среднего значения.
    MAX_DISCOMFORT_WEIGHT = 1.0

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

        # Кэшируем дискомфорт
        self.discomfort_map = {}
        for role in Config.MASK.keys():
            if role in preferences:
                # 0 за топ-1 роль, 100 за топ-2 и т.д.
                self.discomfort_map[role] = preferences.index(role) * 100
            else:
                # Если роль не в предпочтениях, но есть рейтинг -> штраф 1000
                # Если рейтинга нет -> штраф 5000 (недопустимо)
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
        return f"{self.name}{' [C]' if self.is_captain else ''}"


class Team:
    # Добавили _cached_intra_std (разброс внутри) и _cached_max_pain (макс боль)
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
        """
        Пересчитывает все метрики команды.
        Включает пункты 3 и 5: разброс скилла внутри и поиск самого "несчастного" игрока.
        """
        if not self._is_dirty:
            return

        total_rating = 0
        count = 0
        total_pain = 0

        # Для пункта 3: Собираем все рейтинги игроков команды в кучу
        all_ratings = []
        # Для пункта 5: Ищем максимальный дискомфорт в этой команде
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

        # Базовые метрики
        self._cached_mmr = total_rating / count if count > 0 else 0
        self._cached_discomfort = total_pain

        # [NEW] Пункт 3: Разброс внутри команды
        # Если игроков > 1, считаем стандартное отклонение. Иначе 0.
        if len(all_ratings) > 1:
            self._cached_intra_std = statistics.stdev(all_ratings)
        else:
            self._cached_intra_std = 0.0

        # [NEW] Пункт 5: Максимальная боль одного игрока
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
            if len(self.roster.get(role, [])) < needed:
                return False
        return True


# --- 3. Логика GA (Функция Стоимости) ---

def calculate_cost(teams: List[Team]) -> float:
    """
    Вычисляет "штраф" для текущего распределения команд.
    Меньше = Лучше.
    """
    mmrs = []
    total_avg_discomfort = 0
    total_intra_std = 0
    global_max_pain = 0

    for t in teams:
        # При обращении к свойствам происходит ленивый пересчет (если нужно)
        mmrs.append(t.mmr)

        # Суммируем общий дискомфорт (чтобы делить на кол-во команд потом)
        total_avg_discomfort += t.discomfort

        # [NEW] Пункт 3: Накапливаем разброс внутри команд
        total_intra_std += t.intra_std

        # [NEW] Пункт 5: Ищем самого страдающего игрока во всем турнире
        if t.max_pain > global_max_pain:
            global_max_pain = t.max_pain

    # 1. Разброс среднего MMR МЕЖДУ командами
    if len(mmrs) < 2:
        inter_team_std = 0
    else:
        inter_team_std = statistics.stdev(mmrs)

    # 2. Средний дискомфорт на команду
    avg_discomfort = total_avg_discomfort / len(teams)

    # 3. Средний разброс ВНУТРИ команд
    avg_intra_std = total_intra_std / len(teams)

    # === ИТОГОВАЯ ФОРМУЛА ===
    cost = (
            (inter_team_std * Config.MMR_DIFF_WEIGHT) +  # Баланс сил команд
            (avg_discomfort * Config.DISCOMFORT_WEIGHT) +  # Общее удобство
            (avg_intra_std * Config.INTRA_TEAM_VAR_WEIGHT) +  # Ровность состава внутри (Пункт 3)
            (global_max_pain * Config.MAX_DISCOMFORT_WEIGHT)  # Защита "жертвы" (Пункт 5)
    )

    return cost


# --- 4. Вспомогательные функции (Загрузка, Генерация) ---

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
    # ... (логика загрузки та же, что и раньше) ...
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

    # 1. Рассадка капитанов
    if Config.USE_CAPTAINS:
        for team in teams:
            if not captains: break
            cap = captains.pop()
            assigned = False
            # Пробуем приоритетную роль
            for role in cap.preferences:
                if role in Config.MASK and team.add_player(role, cap):
                    assigned = True;
                    break
            # Пробуем любую роль
            if not assigned:
                for role in Config.MASK:
                    if cap.can_play(role) and team.add_player(role, cap):
                        assigned = True;
                        break
            if not assigned: pool.append(cap)
        pool.extend(captains)
        random.shuffle(pool)

    # 2. Заполнение остальных
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
            # Swap между командами
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
            # Swap внутри команды
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

        # Init population
        attempts = 0
        while len(self.population) < Config.POPULATION_SIZE and attempts < Config.POPULATION_SIZE * 10:
            sol = create_random_solution(self.players, self.num_teams)
            if all(t.is_full() for t in sol):
                self.population.append((calculate_cost(sol), sol))
            attempts += 1

        if not self.population: raise ValueError("Не удалось собрать команды!")

        # Clone if needed
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
                parents = random.sample(self.population[:50], 2)  # Выбор из топ-50
                _, p_teams = min(parents, key=lambda x: x[0])
                child = mutate(p_teams)
                new_pop.append((calculate_cost(child), child))
            self.population = new_pop

        self.population.sort(key=lambda x: x[0])
        print(f"Завершено за {time.time() - start_time:.2f} сек.")
        return self.population[0][1]


# --- 5. Запуск ---

if __name__ == "__main__":
    FILENAME = "tournament_39.json"  # <--- Укажите ваш файл

    all_players = load_players(FILENAME)
    needed_roles = [r for r, c in Config.MASK.items() if c > 0]
    valid_players = [p for p in all_players if any(p.can_play(r) for r in needed_roles)]

    players_per_team = sum(Config.MASK.values())
    num_teams = len(valid_players) // players_per_team if players_per_team > 0 else 0

    print(f"Игроков: {len(valid_players)}. Команд: {num_teams}")

    if num_teams > 0:
        if Config.USE_CAPTAINS: assign_captains(valid_players, num_teams)
        opt = GeneticOptimizer(valid_players, num_teams)
        try:
            result = opt.run()

            print("\n" + "=" * 60)
            print(" РЕЗУЛЬТАТЫ ")
            print("=" * 60)

            all_mmrs = []
            for t in result:
                all_mmrs.append(t.mmr)
                # Вывод
                max_pain_alert = "⚠️ ВЫСОКИЙ ДИСКОМФОРТ" if t.max_pain >= 1000 else ""

                print(f"\nTEAM #{t.id} | Avg: {t.mmr:.0f} | Внутри-разброс: {t.intra_std:.1f} | {max_pain_alert}")

                for role in Config.MASK:
                    if Config.MASK[role] == 0: continue
                    print(f"  [{role}]")
                    for p in t.roster[role]:
                        icon = "👑" if p.is_captain else "  "
                        # Отображение дискомфорта
                        disc = p.get_discomfort(role)
                        heart = "❤️" if disc == 0 else ("💔" if disc >= 1000 else "💛")

                        print(f"    {p.get_rating(role):<4} {icon} {heart} {p.name} (Pain: {disc})")

            print("-" * 60)
            if len(all_mmrs) > 1:
                print(f"Разброс между командами (StDev): {statistics.stdev(all_mmrs):.2f}")

        except ValueError as e:
            print(e)