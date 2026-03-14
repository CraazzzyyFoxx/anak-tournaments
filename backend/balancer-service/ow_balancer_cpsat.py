from __future__ import annotations

import enum
import math
import random
from dataclasses import dataclass, field
from typing import Optional


class Role(str, enum.Enum):
    TANK = "tank"
    DPS = "dps"
    SUPPORT = "support"


class PlayerFlag(str, enum.Enum):
    SHOTCALLER = "shotcaller"
    NEWBIE = "newbie"
    TOXIC = "toxic"
    PASSIVE = "passive"
    FLEX = "flex"
    STREAMER = "streamer"


@dataclass
class Player:
    id: str
    name: str
    role_sr: dict[Role, int] = field(default_factory=dict)
    preferred_roles: list[Role] = field(default_factory=lambda: list(Role))
    subclasses: dict[Role, str] = field(default_factory=dict)
    flags: set[PlayerFlag] = field(default_factory=set)
    avoid: set[str] = field(default_factory=set)
    is_captain: bool = False
    captain_team: Optional[int] = None
    captain_role: Optional[Role] = None

    @property
    def is_flex(self) -> bool:
        return PlayerFlag.FLEX in self.flags

    def sr_for(self, role: Role) -> int:
        return self.role_sr.get(role, 0)

    @property
    def avg_sr(self) -> int:
        if not self.role_sr:
            return 0
        return sum(self.role_sr.values()) // len(self.role_sr)

    @property
    def max_sr(self) -> int:
        return max(self.role_sr.values()) if self.role_sr else 0

    def pref_cost(self, role: Role) -> int:
        if role not in self.preferred_roles:
            return 10
        if self.is_flex:
            return 0
        return self.preferred_roles.index(role)


@dataclass
class Mask:
    num_teams: int
    team_size: int
    roles: dict[Role, int]

    @classmethod
    def overwatch_5v5(cls, num_teams: int) -> "Mask":
        return cls(num_teams=num_teams, team_size=5, roles={Role.TANK: 1, Role.DPS: 2, Role.SUPPORT: 2})


@dataclass
class BalancerConfig:
    mask: Mask
    role_weights: dict[Role, float] = field(default_factory=lambda: {Role.TANK: 1.0, Role.DPS: 1.0, Role.SUPPORT: 1.0})
    w_sr_spread: int = 1000000
    w_sr_balance: int = 3000
    w_role_delta: int = 300
    w_role_pref: int = 20
    w_flag_balance: int = 10
    w_high_rank_stack: int = 10
    w_subclass_collision: int = 10
    balanced_flags: list[PlayerFlag] = field(default_factory=lambda: [PlayerFlag.SHOTCALLER, PlayerFlag.NEWBIE])
    high_rank_percentile: float = 0.80
    low_rank_percentile: float = 0.20
    time_limit_sec: float = 30.0
    max_solutions: int = 8
    num_restarts: int = 64
    local_search_iters: int = 6000
    captain_mode: bool = False
    require_exactly_one_captain_per_team: bool = True
    enforce_low_rank_hard: bool = True


@dataclass
class BalanceResult:
    variant: int
    assignment: dict[str, tuple[int, Role]]
    objective: int
    players: list[Player]
    config: BalancerConfig

    def _player_map(self) -> dict[str, Player]:
        return {p.id: p for p in self.players}

    def teams(self) -> dict[int, list[tuple[Player, Role]]]:
        pm = self._player_map()
        result: dict[int, list[tuple[Player, Role]]] = {t: [] for t in range(self.config.mask.num_teams)}
        for pid, (t, r) in self.assignment.items():
            result[t].append((pm[pid], r))
        order = {Role.TANK: 0, Role.DPS: 1, Role.SUPPORT: 2}
        for t in result:
            result[t].sort(key=lambda x: (order[x[1]], -x[0].sr_for(x[1]), x[0].name))
        return result

    def team_avg_sr(self, t: int) -> float:
        team = self.teams().get(t, [])
        return sum(p.sr_for(r) for p, r in team) / len(team) if team else 0.0

    def metrics(self) -> dict:
        teams = self.teams()
        avg_srs = [self.team_avg_sr(t) for t in sorted(teams)]
        global_avg = sum(avg_srs) / len(avg_srs) if avg_srs else 0.0
        sr_range = max(avg_srs) - min(avg_srs) if avg_srs else 0.0
        sr_std = (sum((s - global_avg) ** 2 for s in avg_srs) / len(avg_srs)) ** 0.5 if avg_srs else 0.0
        sr_mad = sum(abs(s - global_avg) for s in avg_srs) / len(avg_srs) if avg_srs else 0.0
        pref_pen = 0
        pm = self._player_map()
        for pid, (_, r) in self.assignment.items():
            pref_pen += pm[pid].pref_cost(r)
        return {
            "objective": self.objective,
            "global_avg_sr": round(global_avg, 1),
            "sr_range": round(sr_range, 1),
            "sr_std": round(sr_std, 1),
            "sr_mad": round(sr_mad, 1),
            "role_pref_penalty": pref_pen,
            "subclass_collisions": 0,
        }


class TeamBalancer:
    def __init__(self, players: list[Player], config: BalancerConfig):
        self.players = players
        self.config = config
        self.T = config.mask.num_teams
        self.roles = list(Role)
        self.total_slots = self.T * config.mask.team_size
        if len(players) < self.total_slots:
            raise ValueError(f"Мало игроков: {len(players)} < {self.total_slots}")

        self.low_sr_thresholds: dict[Role, int] = {}
        for r in self.roles:
            vals = sorted(p.sr_for(r) for p in players if p.sr_for(r) > 0)
            if vals:
                idx = min(int(len(vals) * config.low_rank_percentile), len(vals) - 1)
                self.low_sr_thresholds[r] = vals[idx]
            else:
                self.low_sr_thresholds[r] = 0

        for r in self.roles:
            needed = config.mask.roles[r] * self.T
            available = sum(1 for p in players if p.sr_for(r) > 0)
            if available < needed:
                raise ValueError(f"Невозможно заполнить роль {r.value}: нужно {needed}, доступно {available}")

    def solve(self) -> list[BalanceResult]:
        print("Быстрый балансер: multi-start greedy + local search")
        candidates = []
        restart_count = max(self.config.num_restarts, self.config.max_solutions * 8)
        seeds = [17 + i * 101 for i in range(restart_count)]
        for seed in seeds:
            try:
                assignment = self._build_assignment(seed)
                assignment = self._local_search(assignment, seed)
                obj = self._objective(assignment)
                candidates.append((obj, assignment))
            except Exception:
                continue
        if not candidates:
            return []
        unique = []
        seen = set()
        for obj, ass in sorted(candidates, key=lambda x: x[0]):
            key = tuple(sorted((pid, t, r.value) for pid, (t, r) in ass.items()))
            if key in seen:
                continue
            seen.add(key)
            unique.append((obj, ass))
            if len(unique) >= self.config.max_solutions:
                break
        return [BalanceResult(i + 1, ass, obj, self.players, self.config) for i, (obj, ass) in enumerate(unique)]

    def _build_assignment(self, seed: int) -> dict[str, tuple[int, Role]]:
        rng = random.Random(seed)
        role_assignment = self._assign_roles(seed)
        role_pools: dict[Role, list[Player]] = {r: [] for r in self.roles}
        benched = []
        for p in self.players:
            rr = role_assignment.get(p.id)
            if rr is None:
                benched.append(p)
            else:
                role_pools[rr].append(p)

        teams = [self._new_team_state(t) for t in range(self.T)]

        # captain pass first
        if self.config.captain_mode and self.config.require_exactly_one_captain_per_team:
            captains = [p for p in self.players if p.is_captain and p.id in role_assignment]
            captains.sort(key=lambda p: role_assignment[p.id].value)
            for role in self.roles:
                caps = [p for p in captains if role_assignment[p.id] == role]
                caps.sort(key=lambda p: p.sr_for(role), reverse=True)
                for p in caps:
                    candidates = [tm for tm in teams if tm["captains"] == 0 and tm["slots"][role] < self.config.mask.roles[role]]
                    if not candidates:
                        break
                    candidates.sort(key=lambda tm: (tm["total_sr"], tm["role_sr"][role], tm["team_id"]))
                    chosen = candidates[0]
                    self._place_player(chosen, p, role)
                    role_pools[role].remove(p)
            if any(tm["captains"] != 1 for tm in teams):
                raise ValueError("Не удалось распределить по одному капитану на команду")

        role_order = sorted(self.roles, key=lambda r: (self.config.mask.roles[r], sum(p.sr_for(r) > 0 for p in self.players)))
        for role in role_order:
            pool = role_pools[role][:]
            pool.sort(key=lambda p: (p.sr_for(role), -len(p.role_sr), -p.avg_sr, rng.random()), reverse=True)
            for p in pool:
                eligible = [tm for tm in teams if tm["slots"][role] < self.config.mask.roles[role] and self._can_place(tm, p, role)]
                if not eligible:
                    raise ValueError(f"Не удалось поставить игрока {p.name} на {role.value}")
                chosen = min(eligible, key=lambda tm: self._placement_score(teams, tm, p, role, rng))
                self._place_player(chosen, p, role)

        assignment = {}
        for tm in teams:
            for role, plist in tm["players_by_role"].items():
                for p in plist:
                    assignment[p.id] = (tm["team_id"], role)
        return assignment

    def _assign_roles(self, seed: int) -> dict[str, Role]:
        rng = random.Random(seed)
        demand = {r: self.config.mask.roles[r] * self.T for r in self.roles}
        remaining = dict(demand)
        assigned: dict[str, Role] = {}

        # first lock exactly one captain/team if needed
        available_caps = [p for p in self.players if p.is_captain]
        if self.config.captain_mode and self.config.require_exactly_one_captain_per_team and len(available_caps) >= self.T:
            caps = sorted(available_caps, key=lambda p: (p.avg_sr, rng.random()), reverse=True)[: self.T]
            for p in caps:
                roles = [r for r in self.roles if p.sr_for(r) > 0 and remaining[r] > 0]
                if not roles:
                    continue
                role = max(roles, key=lambda r: (remaining[r], p.sr_for(r), -p.pref_cost(r)))
                assigned[p.id] = role
                remaining[role] -= 1

        players = [p for p in self.players if p.id not in assigned]
        scarcity = {r: demand[r] / max(1, sum(1 for p in self.players if p.sr_for(r) > 0)) for r in self.roles}
        players.sort(key=lambda p: (len([r for r in self.roles if p.sr_for(r) > 0]), -p.max_sr, -p.avg_sr, rng.random()))

        for p in players:
            roles = [r for r in self.roles if p.sr_for(r) > 0 and remaining[r] > 0]
            if not roles:
                continue
            role = min(
                roles,
                key=lambda r: (
                    p.pref_cost(r) * 1000 - p.sr_for(r) * 3 - remaining[r] * 20 - int(scarcity[r] * 100)
                ),
            )
            assigned[p.id] = role
            remaining[role] -= 1

        # repair any shortages by reassigning flexible players
        for role in self.roles:
            while remaining[role] > 0:
                candidates = [
                    p for p in self.players
                    if p.id in assigned and assigned[p.id] != role and p.sr_for(role) > 0
                ]
                if not candidates:
                    raise ValueError(f"Не удалось добрать роль {role.value}")
                def move_cost(p: Player):
                    from_role = assigned[p.id]
                    if remaining[from_role] >= 0:
                        # moving away creates shortage if from_role already exactly full
                        base = 100000 if sum(1 for pid, rr in assigned.items() if rr == from_role) <= demand[from_role] else 0
                    else:
                        base = 0
                    return (
                        base + p.pref_cost(role) * 500 + max(0, p.sr_for(from_role) - p.sr_for(role))
                    )
                p = min(candidates, key=move_cost)
                old = assigned[p.id]
                assigned[p.id] = role
                remaining[role] -= 1
                remaining[old] += 1

        # if too many assigned because of repairs, bench weakest surplus players per role
        by_role = {r: [p for p in self.players if assigned.get(p.id) == r] for r in self.roles}
        for role in self.roles:
            need = demand[role]
            if len(by_role[role]) <= need:
                continue
            surplus = len(by_role[role]) - need
            by_role[role].sort(key=lambda p: (p.pref_cost(role), -p.sr_for(role), -p.avg_sr))
            for p in by_role[role][:surplus]:
                del assigned[p.id]

        # fill any missing after bench trim from unassigned players
        unassigned = [p for p in self.players if p.id not in assigned]
        for role in self.roles:
            need = demand[role] - sum(1 for rr in assigned.values() if rr == role)
            if need <= 0:
                continue
            candidates = [p for p in unassigned if p.sr_for(role) > 0]
            candidates.sort(key=lambda p: (p.pref_cost(role), -p.sr_for(role), -p.avg_sr))
            if len(candidates) < need:
                raise ValueError(f"Не удалось окончательно собрать роль {role.value}")
            for p in candidates[:need]:
                assigned[p.id] = role
                unassigned.remove(p)

        if len(assigned) != self.total_slots:
            # keep strongest starters overall if still oversubscribed
            starters = list(assigned.keys())
            if len(starters) > self.total_slots:
                ranked = sorted((self._starter_keep_score(self._player(pid), assigned[pid]), pid) for pid in starters)
                for _, pid in ranked[: len(starters) - self.total_slots]:
                    del assigned[pid]
            elif len(starters) < self.total_slots:
                raise ValueError("Не удалось набрать точное число слотов")
        return assigned

    def _starter_keep_score(self, p: Player, role: Role):
        return p.pref_cost(role) * 1000 - p.sr_for(role) * 3 - p.avg_sr

    def _new_team_state(self, team_id: int):
        return {
            "team_id": team_id,
            "players_by_role": {r: [] for r in self.roles},
            "slots": {r: 0 for r in self.roles},
            "role_sr": {r: 0 for r in self.roles},
            "total_sr": 0,
            "captains": 0,
        }

    def _player(self, pid: str) -> Player:
        for p in self.players:
            if p.id == pid:
                return p
        raise KeyError(pid)

    def _is_low(self, p: Player, role: Role) -> bool:
        thr = self.low_sr_thresholds[role]
        return thr > 0 and 0 < p.sr_for(role) <= thr

    def _can_place(self, team, p: Player, role: Role) -> bool:
        if team["slots"][role] >= self.config.mask.roles[role]:
            return False
        if self.config.enforce_low_rank_hard and self._is_low(p, role):
            lows = sum(1 for q in team["players_by_role"][role] if self._is_low(q, role))
            if lows >= 1:
                return False
        if self.config.captain_mode and self.config.require_exactly_one_captain_per_team and p.is_captain and team["captains"] >= 1:
            return False
        return True

    def _place_player(self, team, p: Player, role: Role):
        team["players_by_role"][role].append(p)
        team["slots"][role] += 1
        team["role_sr"][role] += p.sr_for(role)
        team["total_sr"] += p.sr_for(role)
        if p.is_captain:
            team["captains"] += 1

    def _placement_score(self, teams, team, p: Player, role: Role, rng: random.Random):
        projected = [tm["total_sr"] for tm in teams]
        projected[team["team_id"]] += p.sr_for(role)
        spread = max(projected) - min(projected)
        role_vals = [tm["role_sr"][role] for tm in teams]
        role_vals[team["team_id"]] += p.sr_for(role)
        role_spread = max(role_vals) - min(role_vals)
        pref = p.pref_cost(role)
        low_pen = 0
        if self._is_low(p, role):
            low_pen = 1
        return (spread, role_spread, pref, low_pen, team["slots"][role], rng.random())

    def _local_search(self, assignment: dict[str, tuple[int, Role]], seed: int) -> dict[str, tuple[int, Role]]:
        rng = random.Random(seed + 999)
        teams = self._assignment_to_team_lists(assignment)
        current_obj = self._objective(assignment)

        for _ in range(self.config.local_search_iters):
            team_sums = [sum(p.sr_for(r) for p, r in teams[t]) for t in range(self.T)]
            order = sorted(range(self.T), key=lambda t: team_sums[t])
            top = order[-4:] if len(order) >= 4 else order
            bottom = order[:4] if len(order) >= 4 else order
            candidate_pairs = []
            for hi in reversed(top):
                for lo in bottom:
                    if hi != lo:
                        candidate_pairs.append((hi, lo))
            improved = False
            for hi, lo in candidate_pairs:
                by_role_hi = {r: [p for p, rr in teams[hi] if rr == r] for r in self.roles}
                by_role_lo = {r: [p for p, rr in teams[lo] if rr == r] for r in self.roles}
                roles = self.roles[:]
                rng.shuffle(roles)
                best = None
                for role in roles:
                    hi_players = by_role_hi[role]
                    lo_players = by_role_lo[role]
                    for p1 in hi_players:
                        for p2 in lo_players:
                            if p1.is_captain != p2.is_captain:
                                continue
                            if p1.sr_for(role) <= p2.sr_for(role):
                                continue
                            new_assignment = dict(assignment)
                            new_assignment[p1.id] = (lo, role)
                            new_assignment[p2.id] = (hi, role)
                            if not self._assignment_valid_fast(new_assignment, changed_teams={hi, lo}, changed_role=role):
                                continue
                            new_obj = self._objective(new_assignment)
                            if new_obj < current_obj and (best is None or new_obj < best[0]):
                                best = (new_obj, new_assignment)

                    if len(hi_players) >= 2 and len(lo_players) >= 2:
                        for i in range(len(hi_players)):
                            for j in range(i + 1, len(hi_players)):
                                pair_hi = (hi_players[i], hi_players[j])
                                hi_cap = sum(1 for p in pair_hi if p.is_captain)
                                hi_sr = sum(p.sr_for(role) for p in pair_hi)
                                for a in range(len(lo_players)):
                                    for b in range(a + 1, len(lo_players)):
                                        pair_lo = (lo_players[a], lo_players[b])
                                        if hi_cap != sum(1 for p in pair_lo if p.is_captain):
                                            continue
                                        if hi_sr <= sum(p.sr_for(role) for p in pair_lo):
                                            continue
                                        new_assignment = dict(assignment)
                                        for p in pair_hi:
                                            new_assignment[p.id] = (lo, role)
                                        for p in pair_lo:
                                            new_assignment[p.id] = (hi, role)
                                        if not self._assignment_valid_fast(new_assignment, changed_teams={hi, lo}, changed_role=role):
                                            continue
                                        new_obj = self._objective(new_assignment)
                                        if new_obj < current_obj and (best is None or new_obj < best[0]):
                                            best = (new_obj, new_assignment)

                if best is not None:
                    current_obj, assignment = best
                    teams = self._assignment_to_team_lists(assignment)
                    improved = True
                    break
            if not improved:
                break
        return assignment

    def _assignment_to_team_lists(self, assignment):
        pm = {p.id: p for p in self.players}
        teams = {t: [] for t in range(self.T)}
        for pid, (t, r) in assignment.items():
            teams[t].append((pm[pid], r))
        return teams

    def _assignment_valid_fast(self, assignment, changed_teams=None, changed_role=None):
        teams = self._assignment_to_team_lists(assignment)
        for t, members in teams.items():
            if changed_teams is not None and t not in changed_teams:
                continue
            if len(members) != self.config.mask.team_size:
                return False
            cap_count = sum(1 for p, _ in members if p.is_captain)
            if self.config.captain_mode and self.config.require_exactly_one_captain_per_team and cap_count != 1:
                return False
            for role in self.roles:
                if changed_role is not None and role != changed_role and changed_teams is not None:
                    continue
                players = [p for p, rr in members if rr == role]
                if len(players) != self.config.mask.roles[role]:
                    return False
                if self.config.enforce_low_rank_hard:
                    lows = sum(1 for p in players if self._is_low(p, role))
                    if lows > 1:
                        return False
        return True

    def _objective(self, assignment: dict[str, tuple[int, Role]]) -> int:
        teams = self._assignment_to_team_lists(assignment)
        team_sums = [sum(p.sr_for(r) for p, r in teams[t]) for t in range(self.T)]
        spread = max(team_sums) - min(team_sums)
        mean_sum = sum(team_sums) / len(team_sums)
        mad = sum(abs(x - mean_sum) for x in team_sums) / len(team_sums)
        role_delta = 0
        for role in self.roles:
            vals = [sum(p.sr_for(r) for p, r in teams[t] if r == role) for t in range(self.T)]
            role_delta += max(vals) - min(vals)
        pref = sum(self._player(pid).pref_cost(role) for pid, (_, role) in assignment.items())
        # primary focus on avgMMR range -> team sum range is equivalent * 5
        return int(spread * self.config.w_sr_spread + mad * self.config.w_sr_balance + role_delta * self.config.w_role_delta + pref * self.config.w_role_pref)
