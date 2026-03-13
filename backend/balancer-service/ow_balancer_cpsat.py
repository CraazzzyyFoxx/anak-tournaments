"""
Overwatch Tournament Team Balancer — CP-SAT Engine
====================================================
Требования:
  pip install ortools

Масштаб: 160+ игроков, 32+ команд (5v5: 1 Tank, 2 DPS, 2 Support)

Возможности:
  1. Маска (N команд × M игроков)
  2. Предпочитаемые роли с приоритетом
  3. Несколько вариантов баланса (solution pool)
  4. Анти-стак высокоранговых одной роли
  5. Режим капитанов
  6. Пользовательские флаги (newbie, shotcaller и т.д.)
  7. Avoid-лист
  8. Веса ролей
  9. Подклассы ролей (без дублей в команде)
"""

from __future__ import annotations

import enum
import random
import time
from dataclasses import dataclass, field
from typing import Optional

from ortools.sat.python import cp_model


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Модели данных (Overwatch)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class Role(str, enum.Enum):
    TANK = "tank"
    DPS = "dps"
    SUPPORT = "support"


class DPSSubclass(str, enum.Enum):
    HITSCAN = "hitscan"        # Soldier, Cassidy, Widowmaker, Ashe, Sojourn
    PROJECTILE = "projectile"  # Pharah, Junkrat, Hanzo, Torbjörn
    FLANKER = "flanker"        # Tracer, Genji, Sombra, Echo
    BRAWL = "brawl"            # Reaper, Symmetra, Mei


class SupportSubclass(str, enum.Enum):
    MAIN_HEAL = "main_heal"    # Ana, Moira, Kiriko, Lifeweaver
    FLEX_HEAL = "flex_heal"    # Baptiste, Mercy, Illari
    UTILITY = "utility"        # Lúcio, Zenyatta, Brigitte, Juno


class TankSubclass(str, enum.Enum):
    MAIN_TANK = "main_tank"    # Reinhardt, Orisa, Sigma, Ramattra
    DIVE_TANK = "dive_tank"    # Winston, D.Va, Wrecking Ball, Doomfist
    OFF_TANK = "off_tank"      # Zarya, Roadhog, Junker Queen, Mauga


class PlayerFlag(str, enum.Enum):
    SHOTCALLER = "shotcaller"
    NEWBIE = "newbie"
    TOXIC = "toxic"
    PASSIVE = "passive"
    FLEX = "flex"
    STREAMER = "streamer"


@dataclass
class Player:
    """Игрок с полным набором метаданных."""

    id: str
    name: str
    sr: int  # 0 – 5000

    # Предпочитаемые роли в порядке приоритета (первая = основная)
    preferred_roles: list[Role] = field(default_factory=lambda: list(Role))

    # Подкласс для каждой роли, на которой игрок может играть
    subclasses: dict[Role, str] = field(default_factory=dict)

    # Пользовательские флаги
    flags: set[PlayerFlag] = field(default_factory=set)

    # Avoid-лист: id игроков, с которыми нельзя в одну команду
    avoid: set[str] = field(default_factory=set)

    # Режим капитана
    is_captain: bool = False
    captain_team: Optional[int] = None
    captain_role: Optional[Role] = None


@dataclass
class Mask:
    """Маска формирования команд."""

    num_teams: int
    team_size: int
    roles: dict[Role, int]  # сколько слотов на каждую роль

    @classmethod
    def overwatch_5v5(cls, num_teams: int) -> "Mask":
        return cls(
            num_teams=num_teams,
            team_size=5,
            roles={Role.TANK: 1, Role.DPS: 2, Role.SUPPORT: 2},
        )


@dataclass
class BalancerConfig:
    """Все настройки балансировщика в одном месте."""

    mask: Mask

    # ── Веса ролей при подсчёте SR команды ──
    role_weights: dict[Role, float] = field(
        default_factory=lambda: {
            Role.TANK: 1.3,
            Role.DPS: 1.0,
            Role.SUPPORT: 1.1,
        }
    )

    # ── Веса компонентов целевой функции (α) ──
    w_sr_balance: int = 100        # SR-баланс между командами
    w_role_pref: int = 50          # Учёт предпочтений ролей
    w_flag_balance: int = 30       # Равномерность флагов
    w_high_rank_stack: int = 40    # Анти-стак высокоранговых
    w_subclass_collision: int = 60 # Дубли подклассов в команде

    # ── Флаги для равномерного распределения ──
    balanced_flags: list[PlayerFlag] = field(
        default_factory=lambda: [PlayerFlag.SHOTCALLER, PlayerFlag.NEWBIE]
    )

    # ── Порог «высокого ранга» — процентиль ──
    high_rank_percentile: float = 0.80

    # ── Солвер ──
    time_limit_sec: float = 30.0
    max_solutions: int = 5

    # ── Режим капитанов ──
    captain_mode: bool = False


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Solution Callback — сбор нескольких решений
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class _SolutionCollector(cp_model.CpSolverSolutionCallback):
    """Собирает до K решений по мере работы солвера."""

    def __init__(self, x, players, config, max_solutions):
        super().__init__()
        self._x = x
        self._players = players
        self._config = config
        self._max = max_solutions
        self.solutions: list[dict[str, tuple[int, Role]]] = []
        self.objectives: list[int] = []

    def on_solution_callback(self):
        obj = self.ObjectiveValue()
        assignment: dict[str, tuple[int, Role]] = {}
        for i, p in enumerate(self._players):
            for t in range(self._config.mask.num_teams):
                for r in Role:
                    if self.Value(self._x[(i, t, r)]):
                        assignment[p.id] = (t, r)
        self.solutions.append(assignment)
        self.objectives.append(int(obj))
        if len(self.solutions) >= self._max:
            self.StopSearch()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Результат баланса
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@dataclass
class BalanceResult:
    """Один вариант баланса с метриками качества."""

    variant: int
    assignment: dict[str, tuple[int, Role]]
    objective: int
    players: list[Player]
    config: BalancerConfig

    # ── helpers ──

    def _player_map(self) -> dict[str, Player]:
        return {p.id: p for p in self.players}

    def teams(self) -> dict[int, list[tuple[Player, Role]]]:
        pm = self._player_map()
        result: dict[int, list[tuple[Player, Role]]] = {}
        for pid, (t, r) in self.assignment.items():
            result.setdefault(t, []).append((pm[pid], r))
        order = {Role.TANK: 0, Role.DPS: 1, Role.SUPPORT: 2}
        for t in result:
            result[t].sort(key=lambda x: (order[x[1]], -x[0].sr))
        return result

    def team_weighted_sr(self, t: int) -> float:
        teams = self.teams()
        if t not in teams:
            return 0.0
        total = sum(p.sr * self.config.role_weights[r] for p, r in teams[t])
        count = len(teams[t])
        return total / count if count else 0.0

    def metrics(self) -> dict:
        teams = self.teams()
        srs = [self.team_weighted_sr(t) for t in sorted(teams)]
        avg = sum(srs) / len(srs)
        sr_range = max(srs) - min(srs)
        variance = sum((s - avg) ** 2 for s in srs) / len(srs)

        # Штраф предпочтений
        pm = self._player_map()
        pref_pen = 0
        for pid, (_, r) in self.assignment.items():
            p = pm[pid]
            pref_pen += p.preferred_roles.index(r) if r in p.preferred_roles else 10

        # Subclass-коллизии
        sc_coll = 0
        for _, members in teams.items():
            seen: dict[tuple[Role, str], int] = {}
            for p, r in members:
                sc = p.subclasses.get(r)
                if sc:
                    key = (r, sc)
                    seen[key] = seen.get(key, 0) + 1
            sc_coll += sum(v - 1 for v in seen.values() if v > 1)

        return {
            "objective": self.objective,
            "avg_team_sr": round(avg, 1),
            "sr_range": round(sr_range, 1),
            "sr_variance": round(variance, 1),
            "role_pref_penalty": pref_pen,
            "subclass_collisions": sc_coll,
        }

    # ── вывод ──

    def print_compact(self):
        m = self.metrics()
        print(
            f"  #{self.variant}: obj={m['objective']:>8}  "
            f"SR_range={m['sr_range']:>7.1f}  "
            f"pref_pen={m['role_pref_penalty']:>3}  "
            f"sc_coll={m['subclass_collisions']:>2}"
        )

    def print_full(self):
        m = self.metrics()
        teams = self.teams()

        print(f"\n{'═' * 72}")
        print(f"  Вариант #{self.variant}  │  Objective: {m['objective']}")
        print(
            f"  Avg SR: {m['avg_team_sr']}  │  "
            f"SR range: {m['sr_range']}  │  "
            f"Pref pen: {m['role_pref_penalty']}  │  "
            f"SC coll: {m['subclass_collisions']}"
        )
        print(f"{'═' * 72}")

        for t_idx in sorted(teams):
            members = teams[t_idx]
            tsr = self.team_weighted_sr(t_idx)
            cap = next((p.name for p, _ in members if p.is_captain), None)
            cap_str = f"  ★ Cap: {cap}" if cap else ""

            print(f"\n  Команда {t_idx + 1:>2}  (wSR: {tsr:>7.1f}){cap_str}")
            print(f"  {'─' * 66}")

            for p, r in members:
                pref = (
                    p.preferred_roles.index(r) + 1
                    if r in p.preferred_roles
                    else "✗"
                )
                sc = p.subclasses.get(r, "—")
                fl = " ".join(f"[{f.value}]" for f in sorted(p.flags, key=lambda f: f.value))
                star = " ★" if p.is_captain else ""

                print(
                    f"    {r.value:<8} {p.name:<18} "
                    f"SR:{p.sr:<5} pref:{pref}  "
                    f"sub:{sc:<13} {fl}{star}"
                )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Основной балансировщик
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TeamBalancer:
    """
    CP-SAT балансировщик с полным набором ограничений.

    Формулирует задачу как Constraint Optimization Problem:
      жёсткие → линейные равенства / неравенства
      мягкие  → штрафные члены в целевой функции
    """

    def __init__(self, players: list[Player], config: BalancerConfig):
        self.players = players
        self.config = config
        self.model = cp_model.CpModel()

        self.n = len(players)
        self.T = config.mask.num_teams
        self.roles = list(Role)

        # Проверка размера пула
        self.total_slots = self.T * config.mask.team_size
        if self.n < self.total_slots:
            raise ValueError(
                f"Мало игроков: {self.n} < {self.total_slots}"
            )
        self.has_bench = self.n > self.total_slots

        # Порог высокого ранга
        sorted_sr = sorted(p.sr for p in players)
        idx = int(len(sorted_sr) * config.high_rank_percentile)
        self.high_sr_threshold = sorted_sr[min(idx, len(sorted_sr) - 1)]

        # Индекс по id
        self.pidx = {p.id: i for i, p in enumerate(players)}

        # Переменные x[i, t, r]
        self.x: dict[tuple[int, int, Role], cp_model.IntVar] = {}
        for i in range(self.n):
            for t in range(self.T):
                for r in self.roles:
                    self.x[(i, t, r)] = self.model.NewBoolVar(
                        f"x_{i}_{t}_{r.value}"
                    )

    # ── Жёсткие ограничения ──────────────────────

    def _hard_constraints(self):
        mask = self.config.mask

        # (H1) Каждый игрок ≤ 1 назначения; ровно 1 если нет скамейки
        for i in range(self.n):
            all_slots = [self.x[(i, t, r)] for t in range(self.T) for r in self.roles]
            if self.has_bench:
                self.model.Add(sum(all_slots) <= 1)
            else:
                self.model.Add(sum(all_slots) == 1)

        # Если есть скамейка — ровно total_slots назначений суммарно
        if self.has_bench:
            everything = [
                self.x[(i, t, r)]
                for i in range(self.n)
                for t in range(self.T)
                for r in self.roles
            ]
            self.model.Add(sum(everything) == self.total_slots)

        # (H2) Ролевой состав по маске
        for t in range(self.T):
            for r in self.roles:
                self.model.Add(
                    sum(self.x[(i, t, r)] for i in range(self.n)) == mask.roles[r]
                )

        # (H3) Avoid-лист
        seen_pairs: set[tuple[int, int]] = set()
        for i, p in enumerate(self.players):
            for avoid_id in p.avoid:
                if avoid_id not in self.pidx:
                    continue
                j = self.pidx[avoid_id]
                pair = (min(i, j), max(i, j))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                for t in range(self.T):
                    i_in_t = [self.x[(i, t, r)] for r in self.roles]
                    j_in_t = [self.x[(j, t, r)] for r in self.roles]
                    self.model.Add(sum(i_in_t) + sum(j_in_t) <= 1)

        # (H4) Капитаны
        if self.config.captain_mode:
            for i, p in enumerate(self.players):
                if (
                    p.is_captain
                    and p.captain_team is not None
                    and p.captain_role is not None
                ):
                    self.model.Add(
                        self.x[(i, p.captain_team, p.captain_role)] == 1
                    )

    # ── Мягкие ограничения (objective) ───────────

    def _build_objective(self):
        penalties: list = []
        SCALE = 100  # масштаб для целочисленности весов ролей

        # ─── (S1) SR Balance: min(max_team_sr − min_team_sr) ───
        team_sr_vars = []
        for t in range(self.T):
            terms = []
            for i, p in enumerate(self.players):
                for r in self.roles:
                    w = int(self.config.role_weights[r] * SCALE)
                    terms.append(p.sr * w * self.x[(i, t, r)])

            ub = 5000 * SCALE * self.config.mask.team_size
            ts = self.model.NewIntVar(0, ub, f"tsr_{t}")
            self.model.Add(ts == sum(terms))
            team_sr_vars.append(ts)

        ub_max = 5000 * SCALE * self.config.mask.team_size
        max_sr = self.model.NewIntVar(0, ub_max, "max_sr")
        min_sr = self.model.NewIntVar(0, ub_max, "min_sr")
        self.model.AddMaxEquality(max_sr, team_sr_vars)
        self.model.AddMinEquality(min_sr, team_sr_vars)

        sr_diff = self.model.NewIntVar(0, ub_max, "sr_diff")
        self.model.Add(sr_diff == max_sr - min_sr)

        # Нормализуем обратно (÷ SCALE)
        sr_penalty = self.model.NewIntVar(0, 5000 * self.config.mask.team_size, "sr_pen")
        self.model.AddDivisionEquality(sr_penalty, sr_diff, SCALE)
        penalties.append(self.config.w_sr_balance * sr_penalty)

        # ─── (S2) Role Preference ───
        pref_terms = []
        for i, p in enumerate(self.players):
            pref_cost = {}
            for rank, r in enumerate(p.preferred_roles):
                pref_cost[r] = rank  # 0 = лучшая, 1, 2
            for t in range(self.T):
                for r in self.roles:
                    cost = pref_cost.get(r, 10)
                    if cost > 0:
                        pref_terms.append(cost * self.x[(i, t, r)])

        if pref_terms:
            rp = self.model.NewIntVar(0, 10 * self.n, "rp")
            self.model.Add(rp == sum(pref_terms))
            penalties.append(self.config.w_role_pref * rp)

        # ─── (S3) Flag Balance ───
        for flag in self.config.balanced_flags:
            flag_idxs = [i for i, p in enumerate(self.players) if flag in p.flags]
            if len(flag_idxs) < 2:
                continue

            counts = []
            for t in range(self.T):
                c = self.model.NewIntVar(0, len(flag_idxs), f"fl_{flag.value}_{t}")
                self.model.Add(
                    c == sum(
                        self.x[(i, t, r)] for i in flag_idxs for r in self.roles
                    )
                )
                counts.append(c)

            mx = self.model.NewIntVar(0, len(flag_idxs), f"mx_{flag.value}")
            mn = self.model.NewIntVar(0, len(flag_idxs), f"mn_{flag.value}")
            self.model.AddMaxEquality(mx, counts)
            self.model.AddMinEquality(mn, counts)

            diff = self.model.NewIntVar(0, len(flag_idxs), f"fd_{flag.value}")
            self.model.Add(diff == mx - mn)
            penalties.append(self.config.w_flag_balance * diff)

        # ─── (S4) High Rank Stacking ───
        hi_idxs = [i for i, p in enumerate(self.players) if p.sr >= self.high_sr_threshold]
        for t in range(self.T):
            for r in self.roles:
                cnt = sum(self.x[(i, t, r)] for i in hi_idxs)
                exc = self.model.NewIntVar(0, len(hi_idxs), f"hi_{t}_{r.value}")
                self.model.Add(exc >= cnt - 1)
                self.model.Add(exc >= 0)
                penalties.append(self.config.w_high_rank_stack * exc)

        # ─── (S5) Subclass Collision ───
        for r in self.roles:
            groups: dict[str, list[int]] = {}
            for i, p in enumerate(self.players):
                sc = p.subclasses.get(r)
                if sc:
                    groups.setdefault(sc, []).append(i)

            for sc_name, idxs in groups.items():
                if len(idxs) < 2:
                    continue
                for t in range(self.T):
                    cnt = sum(self.x[(i, t, r)] for i in idxs)
                    exc = self.model.NewIntVar(0, len(idxs), f"sc_{r.value}_{sc_name}_{t}")
                    self.model.Add(exc >= cnt - 1)
                    self.model.Add(exc >= 0)
                    penalties.append(self.config.w_subclass_collision * exc)

        # ─── Minimize total penalty ───
        total = self.model.NewIntVar(0, 10**9, "total")
        self.model.Add(total == sum(penalties))
        self.model.Minimize(total)

    # ── Решение ──────────────────────────────────

    def solve(self) -> list[BalanceResult]:
        print(f"┌─ Построение модели ──────────────────────────────┐")
        print(f"│  Игроков: {self.n:>4}    Команд: {self.T:>3}                  │")
        print(f"│  Переменных: ~{self.n * self.T * len(self.roles):>6}                          │")
        print(f"│  High SR порог: {self.high_sr_threshold:>4}                          │")
        print(f"│  Time limit: {self.config.time_limit_sec:>4.0f}с   Solutions: {self.config.max_solutions:>2}             │")
        print(f"└──────────────────────────────────────────────────┘")

        t0 = time.time()
        self._hard_constraints()
        self._build_objective()
        build_time = time.time() - t0
        print(f"  Модель собрана за {build_time:.2f}с")

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.config.time_limit_sec
        solver.parameters.num_workers = 8
        # Подсказываем солверу искать несколько решений
        solver.parameters.enumerate_all_solutions = False

        collector = _SolutionCollector(
            self.x, self.players, self.config, self.config.max_solutions
        )

        print(f"  Солвер запущен...")
        t1 = time.time()
        status = solver.Solve(self.model, collector)
        solve_time = time.time() - t1

        status_map = {
            cp_model.OPTIMAL: "✅ OPTIMAL",
            cp_model.FEASIBLE: "✅ FEASIBLE",
            cp_model.INFEASIBLE: "❌ INFEASIBLE",
            cp_model.MODEL_INVALID: "❌ MODEL_INVALID",
            cp_model.UNKNOWN: "⚠️  UNKNOWN",
        }
        print(f"  Статус: {status_map.get(status, status)}")
        print(f"  Время: {solve_time:.2f}с (сборка {build_time:.2f}с + решение {solve_time:.2f}с)")
        print(f"  Найдено решений: {len(collector.solutions)}")

        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if status == cp_model.INFEASIBLE:
                print("\n  Проблема неразрешима. Проверьте:")
                print("    • avoid-лист не создаёт невозможных цепочек")
                print("    • капитаны не конфликтуют с avoid-листом")
                print("    • достаточно игроков на каждую роль")
            return []

        # Если callback не поймал — достаём из солвера напрямую
        if not collector.solutions:
            assignment: dict[str, tuple[int, Role]] = {}
            for i, p in enumerate(self.players):
                for t in range(self.T):
                    for r in self.roles:
                        if solver.Value(self.x[(i, t, r)]):
                            assignment[p.id] = (t, r)
            collector.solutions.append(assignment)
            collector.objectives.append(int(solver.ObjectiveValue()))

        return [
            BalanceResult(
                variant=idx + 1,
                assignment=sol,
                objective=obj,
                players=self.players,
                config=self.config,
            )
            for idx, (sol, obj) in enumerate(
                zip(collector.solutions, collector.objectives)
            )
        ]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Генератор тестовых данных
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def generate_players(
    count: int = 160,
    seed: int = 42,
    captain_count: int = 0,
    num_teams: int = 32,
) -> list[Player]:
    """Генерирует реалистичный набор игроков."""
    rng = random.Random(seed)

    def rand_sr() -> int:
        return int(max(500, min(4800, int(rng.gauss(2500, 600)))) / 2)

    dps_subs = [e.value for e in DPSSubclass]
    sup_subs = [e.value for e in SupportSubclass]
    tank_subs = [e.value for e in TankSubclass]

    players = []
    for idx in range(count):
        prefs = list(Role)
        rng.shuffle(prefs)

        flags: set[PlayerFlag] = set()
        # if rng.random() < 0.15:
        #     flags.add(PlayerFlag.SHOTCALLER)
        # if rng.random() < 0.10:
        #     flags.add(PlayerFlag.NEWBIE)
        # if rng.random() < 0.05:
        #     flags.add(PlayerFlag.TOXIC)
        # if rng.random() < 0.08:
        #     flags.add(PlayerFlag.PASSIVE)
        # if rng.random() < 0.12:
        #     flags.add(PlayerFlag.FLEX)

        players.append(
            Player(
                id=f"p{idx:03d}",
                name=f"Player_{idx:03d}",
                sr=rand_sr(),
                preferred_roles=prefs,
                subclasses={
                    Role.DPS: rng.choice(dps_subs),
                    Role.SUPPORT: rng.choice(sup_subs),
                    Role.TANK: rng.choice(tank_subs),
                },
                flags=flags,
            )
        )

    # Avoid-лист (~20 пар)
    # for _ in range(20):
    #     a, b = rng.sample(range(count), 2)
    #     players[a].avoid.add(players[b].id)
    #     players[b].avoid.add(players[a].id)

    # Капитаны — топ по SR, по одному на команду
    if captain_count > 0:
        by_sr = sorted(range(count), key=lambda i: players[i].sr, reverse=True)
        for team_idx in range(min(captain_count, num_teams)):
            ci = by_sr[team_idx]
            p = players[ci]
            p.is_captain = True
            p.captain_team = team_idx
            p.captain_role = p.preferred_roles[0]

    return players


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Запуск
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def main():
    print()
    print("╔════════════════════════════════════════════════════════╗")
    print("║   Overwatch Tournament Balancer — CP-SAT Engine       ║")
    print("║   160 players · 32 teams · 5v5 (1T / 2D / 2S)        ║")
    print("╚════════════════════════════════════════════════════════╝")
    print()

    N = 160
    T = 32
    CAP = True

    players = generate_players(
        count=N, seed=42, captain_count=T if CAP else 0, num_teams=T
    )

    # ── Статистика пула ──
    srs = [p.sr for p in players]
    caps = [p for p in players if p.is_captain]
    avoids = sum(len(p.avoid) for p in players) // 2
    shotcallers = sum(1 for p in players if PlayerFlag.SHOTCALLER in p.flags)
    newbies = sum(1 for p in players if PlayerFlag.NEWBIE in p.flags)

    print(f"  Игроков:      {N}")
    print(f"  Команд:       {T}")
    print(f"  Капитанов:    {len(caps)}")
    print(f"  SR:           {min(srs)} – {max(srs)}, avg {sum(srs)/len(srs):.0f}")
    print(f"  Avoid-пар:    {avoids}")
    print(f"  Shotcallers:  {shotcallers}")
    print(f"  Newbies:      {newbies}")
    print()

    # ── Конфигурация ──
    config = BalancerConfig(
        mask=Mask.overwatch_5v5(T),
        role_weights={Role.TANK: 1.3, Role.DPS: 1.0, Role.SUPPORT: 1.1},
        w_sr_balance=100,
        w_role_pref=50,
        w_flag_balance=30,
        w_high_rank_stack=40,
        w_subclass_collision=60,
        time_limit_sec=30.0,
        max_solutions=5,
        captain_mode=CAP,
    )

    # ── Запуск ──
    balancer = TeamBalancer(players, config)
    results = balancer.solve()

    if not results:
        print("\nРешение не найдено.")
        return

    # ── Сравнение вариантов ──
    print(f"\n{'━' * 60}")
    print("  Сравнение вариантов:")
    print(f"{'━' * 60}")
    for r in results:
        r.print_compact()

    # ── Лучший вариант — полный вывод ──
    best = min(results, key=lambda r: r.objective)
    best.print_full()

    # ── Статистика баланса ──
    teams = best.teams()
    team_srs = [best.team_weighted_sr(t) for t in sorted(teams)]
    print(f"\n{'━' * 60}")
    print("  Итоговые wSR команд (отсортированы):")
    print(f"{'━' * 60}")
    for i, sr in enumerate(sorted(team_srs)):
        bar = "█" * int(sr / 50)
        print(f"  {sr:>7.1f}  {bar}")

    spread = max(team_srs) - min(team_srs)
    print(f"\n  Разброс: {spread:.1f} wSR")
    print(f"  Это ~{spread / (sum(team_srs)/len(team_srs)) * 100:.1f}% от среднего")


if __name__ == "__main__":
    main()
