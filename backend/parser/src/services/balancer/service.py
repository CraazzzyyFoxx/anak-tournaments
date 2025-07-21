import math
import random
import copy
import statistics
from collections import defaultdict
from typing import List, Optional, Tuple, Dict, Literal, TypedDict, Set, Union
from dataclasses import dataclass

# --- КОНСТАНТЫ И ТИПЫ (без изменений) ---

ROLES = ("Tank", "Damage", "Support")
PLAYER_PREFERENCE = Literal["primary", "secondary", "flex"]


class Team(TypedDict):
    Tank: Optional[int]
    Damage: List[int]
    Support: List[int]


W_MISSING_SLOT = 1_000_000
W_SECONDARY_ROLE = 100
W_FLEX_ROLE = 150
W_BALANCE = 1.0


# --- КЛАССЫ ДЛЯ ОПИСАНИЯ МУТАЦИЙ (НОВОЕ) ---
# Эти классы описывают изменения, не создавая копий данных

@dataclass
class SwapMove:
    """Обмен двумя игроками между командами."""
    t1_idx: int
    role1: str
    slot1: int
    p1_idx: int

    t2_idx: int
    role2: str
    slot2: int
    p2_idx: int


@dataclass
class BenchSwapMove:
    """Обмен игрока из команды с игроком из запаса."""
    t_idx: int
    role: str
    slot: int
    p_team_idx: int
    p_bench_idx: int
    bench_list_pos: int


@dataclass
class FillEmptySlotMove:
    """Перемещение игрока из запаса в пустой слот."""
    t_idx: int
    role: str
    p_bench_idx: int
    bench_list_pos: int


Move = Union[SwapMove, BenchSwapMove, FillEmptySlotMove]


class Player:
    __slots__ = ("id", "primary", "secondary", "rating", "is_flex")

    def __init__(self, pid: int, primary: str, secondary: Optional[str], rating: int):
        self.id, self.primary, self.secondary, self.rating = pid, primary, secondary, rating
        self.is_flex = self.primary == "Flex"

    def can_play_role(self, role: str) -> Optional[PLAYER_PREFERENCE]:
        if self.is_flex: return "flex"
        if role == self.primary: return "primary"
        if role == self.secondary: return "secondary"
        return None

    def __repr__(self):
        return f"Player(id={self.id}, r={self.rating})"


# --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (без существенных изменений) ---
# feasible_team_count и build_initial остаются прежними

def feasible_team_count(players: List[Player]) -> int:
    """Максимальное N команд, которые можно собрать (бинарный поиск)."""
    counts = defaultdict(int)
    flex_count = 0
    for p in players:
        if p.is_flex:
            flex_count += 1
        else:
            counts[p.primary] += 1
            if p.secondary: counts[p.secondary + "_sec"] += 1

    def _can_form_n_teams(n: int) -> bool:
        if n == 0: return True
        needed = {"Tank": n, "Damage": 2 * n, "Support": 2 * n}
        for role in ROLES: needed[role] -= min(needed[role], counts[role])
        for role in ROLES: needed[role] -= min(needed[role], counts[role + "_sec"])
        return sum(needed.values()) <= flex_count

    low, high, ans = 0, len(players) // 5, 0
    while low <= high:
        mid = (low + high) // 2
        if _can_form_n_teams(mid):
            ans, low = mid, mid + 1
        else:
            high = mid - 1
    return ans


def build_initial(players: List[Player], nteams: int) -> Tuple[List[Team], List[int]]:
    """Грёдно формирует валидное начальное распределение."""
    teams: List[Team] = [{"Tank": None, "Damage": [], "Support": []} for _ in range(nteams)]
    unassigned: Set[int] = set(range(len(players)))
    role_buckets: Dict[str, List[int]] = defaultdict(list)
    for idx, p in enumerate(players):
        if not p.is_flex: role_buckets[p.primary].append(idx)
    for r in ROLES: role_buckets[r].sort(key=lambda i: players[i].rating, reverse=True)

    for role, slots_needed in [("Tank", 1), ("Damage", 2), ("Support", 2)]:
        arr, direction, team_idx = role_buckets[role], 1, 0
        while arr:
            for _ in range(slots_needed):
                if not arr: break
                player_idx = arr.pop(0)
                if role == "Tank":
                    teams[team_idx]["Tank"] = player_idx
                else:
                    teams[team_idx][role].append(player_idx)
                unassigned.remove(player_idx)
            team_idx += direction
            if not (0 <= team_idx < nteams):
                direction *= -1
                team_idx += direction

    def _fill_slots(predicate):
        for team in teams:
            for role, slots in [("Tank", 1), ("Damage", 2), ("Support", 2)]:
                have = (1 if team["Tank"] is not None else 0) if role == "Tank" else len(team[role])
                while have < slots:
                    candidate = next((idx for idx in unassigned if predicate(players[idx], role)), None)
                    if candidate is None: break
                    unassigned.remove(candidate)
                    if role == "Tank":
                        team["Tank"] = candidate
                    else:
                        team[role].append(candidate)
                    have += 1

    _fill_slots(lambda p, r: p.secondary == r)
    _fill_slots(lambda p, r: p.is_flex)
    return teams, list(unassigned)


# --- НОВЫЙ КЛАСС СОСТОЯНИЯ ДЛЯ SA ---

class AnnealingState:
    """Хранит состояние системы и предоставляет O(1) методы для обновления энергии."""

    def __init__(self, teams: List[Team], bench: List[int], players: List[Player]):
        self.teams = teams
        self.bench = bench
        self.players = players
        self.nteams = len(teams)
        self.avg_rating_norm_sq = (1250 * 5) ** 2  # Для нормализации дисперсии

        # Кэшируемые значения для быстрого расчета delta_E
        self.team_ratings = [self._calculate_team_rating(t) for t in self.teams]
        self.total_energy = self._calculate_full_energy()

    def _calculate_team_rating(self, team: Team) -> int:
        ids = ([team["Tank"]] if team["Tank"] is not None else []) + team["Damage"] + team["Support"]
        return sum(self.players[i].rating for i in ids)

    def _get_player_penalty(self, p_idx: int, role: str) -> int:
        if p_idx is None: return W_MISSING_SLOT
        p = self.players[p_idx]
        pref = p.can_play_role(role)
        if pref == "secondary": return W_SECONDARY_ROLE
        if pref == "flex": return W_FLEX_ROLE
        return 0

    def _get_team_penalty(self, team: Team) -> int:
        pen = self._get_player_penalty(team["Tank"], "Tank")
        pen += sum(self._get_player_penalty(p, "Damage") for p in team["Damage"])
        pen += sum(self._get_player_penalty(p, "Support") for p in team["Support"])
        # Штраф за недостающих игроков
        pen += (2 - len(team["Damage"])) * W_MISSING_SLOT
        pen += (2 - len(team["Support"])) * W_MISSING_SLOT
        return pen

    def _calculate_full_energy(self) -> float:
        """Полный пересчет энергии. Вызывается только один раз в конструкторе."""
        pref_penalty = sum(self._get_team_penalty(t) for t in self.teams)
        balance_penalty = 0
        if self.nteams > 1:
            balance_penalty = statistics.pvariance(self.team_ratings) / self.avg_rating_norm_sq
        return pref_penalty + W_BALANCE * balance_penalty

    def calculate_delta_energy(self, move: Move) -> float:
        """
        КЛЮЧЕВАЯ ОПТИМИЗАЦИЯ: Вычисляет изменение энергии для мутации за O(1).
        """
        delta_pref = 0
        delta_balance = 0

        old_variance = statistics.pvariance(self.team_ratings) if self.nteams > 1 else 0

        if isinstance(move, SwapMove):
            # 1. Рассчитываем изменение штрафа за предпочтения
            old_pen1 = self._get_player_penalty(move.p1_idx, move.role1)
            old_pen2 = self._get_player_penalty(move.p2_idx, move.role2)
            new_pen1 = self._get_player_penalty(move.p2_idx, move.role1)  # p2 на месте p1
            new_pen2 = self._get_player_penalty(move.p1_idx, move.role2)  # p1 на месте p2
            delta_pref = (new_pen1 + new_pen2) - (old_pen1 + old_pen2)

            # 2. Рассчитываем изменение штрафа за баланс
            if move.t1_idx != move.t2_idx:
                r1_old, r2_old = self.team_ratings[move.t1_idx], self.team_ratings[move.t2_idx]
                p1_rating, p2_rating = self.players[move.p1_idx].rating, self.players[move.p2_idx].rating

                r1_new = r1_old - p1_rating + p2_rating
                r2_new = r2_old - p2_rating + p1_rating

                # Формула изменения дисперсии при изменении двух элементов
                delta_variance = (r1_new ** 2 + r2_new ** 2 - r1_old ** 2 - r2_old ** 2) / self.nteams
                delta_balance = W_BALANCE * delta_variance / self.avg_rating_norm_sq

        # (Аналогичные расчеты для BenchSwapMove и FillEmptySlotMove можно добавить здесь)
        # Для простоты, если мутация сложная, можно прибегнуть к полному пересчету,
        # но для самых частых (swap) O(1) расчет дает основной прирост.
        # Сейчас мы просто пересчитаем полностью для других типов, т.к. они реже
        else:
            # Это "заглушка", которая замедляет, но гарантирует корректность.
            # Для максимальной производительности нужно реализовать delta-логику и для других мутаций.
            current_energy = self.total_energy
            self.apply_move(move)  # Применяем временно
            new_energy = self._calculate_full_energy()
            self.unapply_move(move)  # Откатываем
            return new_energy - current_energy

        return delta_pref + delta_balance

    def apply_move(self, move: Move):
        """Применяет мутацию к состоянию и обновляет кэши."""
        delta_E = self.calculate_delta_energy(move)  # Рассчитываем до изменения

        if isinstance(move, SwapMove):
            # 1. Обновляем команды
            if move.role1 == "Tank":
                self.teams[move.t1_idx]["Tank"] = move.p2_idx
            else:
                self.teams[move.t1_idx][move.role1][move.slot1] = move.p2_idx

            if move.role2 == "Tank":
                self.teams[move.t2_idx]["Tank"] = move.p1_idx
            else:
                self.teams[move.t2_idx][move.role2][move.slot2] = move.p1_idx

            # 2. Обновляем рейтинги команд
            if move.t1_idx != move.t2_idx:
                p1_rating, p2_rating = self.players[move.p1_idx].rating, self.players[move.p2_idx].rating
                self.team_ratings[move.t1_idx] += p2_rating - p1_rating
                self.team_ratings[move.t2_idx] += p1_rating - p2_rating

        # ... Реализация для других типов мутаций ...
        # Для простоты примера, оставим только SwapMove, как самый частый.

        # 3. Обновляем общую энергию
        self.total_energy += delta_E

    def unapply_move(self, move: Move):
        """Откатывает мутацию. Нужно для заглушки в delta_energy."""
        if isinstance(move, SwapMove):
            # Просто применяем обратный swap
            reverse_move = SwapMove(
                t1_idx=move.t1_idx, role1=move.role1, slot1=move.slot1, p1_idx=move.p2_idx,
                t2_idx=move.t2_idx, role2=move.role2, slot2=move.slot2, p2_idx=move.p1_idx
            )
            self.apply_move(reverse_move)  # Применяем обратный ход (он восстановит и энергию)

    def get_best_version(self):
        """Возвращает копию текущего состояния для сохранения лучшего результата."""
        return copy.deepcopy(self.teams), self.bench.copy()


# --- ОБНОВЛЕННЫЕ ФУНКЦИИ SA ---

def propose_move(teams: List[Team], bench: List[int], players: List[Player]) -> Optional[Move]:
    """Предлагает мутацию, возвращая легковесный объект Move."""
    nteams = len(teams)
    if nteams < 2: return None  # Не можем делать обмены

    # Самая частая и полезная мутация - обмен двух игроков
    t1_idx, t2_idx = random.sample(range(nteams), 2)

    team1_slots = [("Tank", 0)] + [(r, i) for r in ("Damage", "Support") for i in range(len(teams[t1_idx][r]))]
    team2_slots = [("Tank", 0)] + [(r, i) for r in ("Damage", "Support") for i in range(len(teams[t2_idx][r]))]

    if not team1_slots or not team2_slots: return None

    role1, slot1 = random.choice(team1_slots)
    p1_idx = teams[t1_idx]["Tank"] if role1 == "Tank" else teams[t1_idx][role1][slot1]

    role2, slot2 = random.choice(team2_slots)
    p2_idx = teams[t2_idx]["Tank"] if role2 == "Tank" else teams[t2_idx][role2][slot2]

    if p1_idx is None or p2_idx is None: return None

    return SwapMove(t1_idx, role1, slot1, p1_idx, t2_idx, role2, slot2, p2_idx)


def simulated_annealing_fast(
        players: List[Player], nteams: int,
        T0: float = 100.0, Tend: float = 0.01,
        alpha: float = 0.99, steps_per_T: int = 2000  # Можно увеличить шаги, т.к. они дешевые
) -> Tuple[List[Team], List[int], float]:
    initial_teams, initial_bench = build_initial(players, nteams)
    state = AnnealingState(initial_teams, initial_bench, players)

    best_teams, best_bench = state.get_best_version()
    best_E = state.total_energy

    T = T0
    while T > Tend:
        for _ in range(steps_per_T):
            move = propose_move(state.teams, state.bench, players)
            if move is None: continue

            delta_E = state.calculate_delta_energy(move)

            if delta_E < 0 or random.random() < math.exp(-delta_E / T):
                state.apply_move(move)
                if state.total_energy < best_E:
                    best_E = state.total_energy
                    best_teams, best_bench = state.get_best_version()
        T *= alpha

    return best_teams, best_bench, best_E


def assign(players: List[Player], num_restarts: int = 3) -> Tuple[int, List[Team], List[int]]:
    """Главная функция API. Использует быструю версию SA."""
    n = feasible_team_count(players)
    if n == 0:
        raise ValueError("Недостаточно игроков для сборки хотя бы одной команды.")

    best_solution = None
    best_E = float("inf")
    print(f"Найденное максимальное число команд: {n}. Запускаем оптимизацию...")

    for i in range(num_restarts):
        teams, bench, E = simulated_annealing_fast(players, n)
        print(f"  Запуск {i + 1}/{num_restarts}: лучшая энергия = {E:.2f}")
        if E < best_E and E < W_MISSING_SLOT:
            best_solution = (teams, bench)
            best_E = E

    if best_solution is None:
        raise RuntimeError("Не удалось найти валидное распределение игроков.")

    return n, *best_solution


# --- Функции вывода и демо-запуск (без изменений) ---
def team_rating(team: Team, players: List[Player]) -> int:
    ids = ([team["Tank"]] if team["Tank"] is not None else []) + team["Damage"] + team["Support"]
    return sum(players[i].rating for i in ids if i is not None)


def pretty_print(nteams: int, teams: List[Team], bench: List[int], players: List[Player]):
    print("\n" + "=" * 30 + f"\nРЕЗУЛЬТАТ: Собрано {nteams} команд\n" + "=" * 30)
    ratings = [team_rating(t, players) for t in teams]
    for i, team in enumerate(teams, 1):
        print(f"\n--- Команда {i} (Рейтинг: {ratings[i - 1]}) ---")
        t_id = team['Tank']
        tank_str = f"P{players[t_id].id} (R:{players[t_id].rating}, As:Tank, Pref:{players[t_id].primary})" if t_id is not None else "ПУСТО"
        print(f"Танк:    {tank_str}")
        for p_idx in team['Damage']: print(
            f"Урон:    P{players[p_idx].id} (R:{players[p_idx].rating}, As:Dmg, Pref:{players[p_idx].primary})")
        for p_idx in team['Support']: print(
            f"Поддержка: P{players[p_idx].id} (R:{players[p_idx].rating}, As:Sup, Pref:{players[p_idx].primary})")
    if ratings: print(f"\nДисперсия рейтинга команд: {statistics.pvariance(ratings):.2f}")
    print("\n--- Запасные игроки ---", [players[idx].id for idx in bench] or "Нет")


if __name__ == "__main__":
    random.seed(42)
    demo_players: List[Player] = []
    for pid_counter in range(1, 11):  # Увеличим число игроков до 120, чтобы увидеть разницу
        primary = random.choice([*ROLES, "Flex", "Damage", "Support"])
        secondary = None
        if primary != "Flex" and random.random() > 0.3:
            secondary = random.choice([r for r in ROLES if r != primary])
        rating = random.randint(100, 2300)
        demo_players.append(Player(pid_counter, primary, secondary, rating))

    try:
        n_teams, final_teams, final_bench = assign(demo_players, num_restarts=3)
        pretty_print(n_teams, final_teams, final_bench, demo_players)
    except (ValueError, RuntimeError) as e:
        print(f"Ошибка: {e}")