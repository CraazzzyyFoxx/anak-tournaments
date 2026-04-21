from __future__ import annotations

import math
import random

from src.core.config import AlgorithmConfig
from src.domain.balancer.entities import Team
from src.domain.balancer.team_cost_evaluator import calculate_cost


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
    """Perform a swap with copy-on-write semantics."""
    if not copied[team_a_idx]:
        teams[team_a_idx] = teams[team_a_idx].copy()
        copied[team_a_idx] = True
    if team_b_idx != team_a_idx and not copied[team_b_idx]:
        teams[team_b_idx] = teams[team_b_idx].copy()
        copied[team_b_idx] = True

    team_a = teams[team_a_idx]
    team_b = teams[team_b_idx]
    player_a = team_a.roster[role_a][slot_a]
    player_b = team_b.roster[role_b][slot_b]
    team_a.replace_player(role_a, slot_a, player_b)
    team_b.replace_player(role_b, slot_b, player_a)


def _strategy_robin_hood(
    teams: list[Team],
    mask: dict[str, int],
    available_roles: list[str],
    copied: list[bool],
    use_captains: bool,
    rng: random.Random,
) -> bool:
    if len(teams) < 2 or not available_roles:
        return False

    totals = [team.total_rating for team in teams]
    max_idx = max(range(len(teams)), key=lambda index: totals[index])
    min_idx = min(range(len(teams)), key=lambda index: totals[index])
    if max_idx == min_idx:
        return False

    original_gap = totals[max_idx] - totals[min_idx]
    if original_gap <= 0:
        return False

    roles_shuffled = available_roles[:]
    rng.shuffle(roles_shuffled)

    for role in roles_shuffled:
        rich_roster = teams[max_idx].roster.get(role, [])
        poor_roster = teams[min_idx].roster.get(role, [])
        if not rich_roster or not poor_roster:
            continue

        rich_sorted = sorted(range(len(rich_roster)), key=lambda index: rich_roster[index].get_rating(role), reverse=True)
        poor_sorted = sorted(range(len(poor_roster)), key=lambda index: poor_roster[index].get_rating(role))

        for rich_index in rich_sorted:
            strongest = rich_roster[rich_index]
            if use_captains and strongest.is_captain:
                continue
            for poor_index in poor_sorted:
                weakest = poor_roster[poor_index]
                if use_captains and weakest.is_captain:
                    continue

                delta = strongest.get_rating(role) - weakest.get_rating(role)
                if delta <= 0:
                    continue

                new_rich_total = totals[max_idx] - delta
                new_poor_total = totals[min_idx] + delta
                new_gap = abs(new_rich_total - new_poor_total)
                for index, total in enumerate(totals):
                    if index in (max_idx, min_idx):
                        continue
                    other_gap = max(total, new_rich_total, new_poor_total) - min(total, new_rich_total, new_poor_total)
                    if other_gap > new_gap:
                        new_gap = other_gap
                if new_gap >= original_gap:
                    continue

                _swap_players_in_place(teams, max_idx, role, rich_index, min_idx, role, poor_index, copied)
                return True
    return False


def _strategy_fix_worst_discomfort(
    teams: list[Team],
    mask: dict[str, int],
    available_roles: list[str],
    copied: list[bool],
    use_captains: bool,
) -> bool:
    if len(teams) < 2:
        return False

    painful: list[tuple[int, str, int, int]] = []
    for team_index, team in enumerate(teams):
        for role, players in team.roster.items():
            for slot, player in enumerate(players):
                if use_captains and player.is_captain:
                    continue
                discomfort = player.get_discomfort(role)
                if discomfort >= 1000:
                    painful.append((team_index, role, slot, discomfort))

    if not painful:
        return False

    painful.sort(key=lambda entry: entry[3], reverse=True)

    for src_team_idx, src_role, src_slot, src_discomfort in painful:
        src_player = teams[src_team_idx].roster[src_role][src_slot]

        for dst_team_idx, dst_team in enumerate(teams):
            if dst_team_idx == src_team_idx:
                continue
            for dst_role, dst_players in dst_team.roster.items():
                for dst_slot, dst_player in enumerate(dst_players):
                    if use_captains and dst_player.is_captain:
                        continue
                    if not dst_player.preferences or dst_player.preferences[0] != src_role:
                        continue
                    if not src_player.can_play(dst_role):
                        continue

                    new_src_disc = src_player.get_discomfort(dst_role)
                    new_dst_disc = dst_player.get_discomfort(src_role)
                    old_disc = src_discomfort + dst_player.get_discomfort(dst_role)
                    new_disc = new_src_disc + new_dst_disc
                    if new_disc >= old_disc:
                        continue

                    _swap_players_in_place(
                        teams,
                        src_team_idx,
                        src_role,
                        src_slot,
                        dst_team_idx,
                        dst_role,
                        dst_slot,
                        copied,
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
    if len(teams) < 2 or not available_roles:
        return False

    best_role: str | None = None
    best_stdev = 0.0
    best_team_avgs: list[tuple[int, float]] = []

    for role in available_roles:
        team_avgs: list[tuple[int, float]] = []
        for team_index, team in enumerate(teams):
            players = team.roster.get(role, [])
            if not players:
                continue
            total = sum(player.get_rating(role) for player in players)
            team_avgs.append((team_index, total / len(players)))
        if len(team_avgs) < 2:
            continue

        averages = [avg for _, avg in team_avgs]
        mean = sum(averages) / len(averages)
        variance = sum((avg - mean) ** 2 for avg in averages) / (len(averages) - 1)
        stdev = math.sqrt(variance) if variance > 0 else 0.0
        if stdev > best_stdev:
            best_stdev = stdev
            best_role = role
            best_team_avgs = team_avgs

    if best_role is None or best_stdev <= 0:
        return False

    best_team_avgs.sort(key=lambda entry: entry[1])
    weak_team_idx = best_team_avgs[0][0]
    strong_team_idx = best_team_avgs[-1][0]
    if weak_team_idx == strong_team_idx:
        return False

    strong_roster = teams[strong_team_idx].roster[best_role]
    weak_roster = teams[weak_team_idx].roster[best_role]
    if not strong_roster or not weak_roster:
        return False

    strong_sorted = sorted(range(len(strong_roster)), key=lambda index: strong_roster[index].get_rating(best_role))
    weak_sorted = sorted(
        range(len(weak_roster)),
        key=lambda index: weak_roster[index].get_rating(best_role),
        reverse=True,
    )

    for strong_index in strong_sorted:
        strong_player = strong_roster[strong_index]
        if use_captains and strong_player.is_captain:
            continue
        for weak_index in weak_sorted:
            weak_player = weak_roster[weak_index]
            if use_captains and weak_player.is_captain:
                continue

            delta_strong = weak_player.get_rating(best_role) - strong_player.get_rating(best_role)
            delta_weak = -delta_strong
            if delta_strong >= 0:
                continue

            new_avgs: list[float] = []
            for team_index, avg in best_team_avgs:
                if team_index == strong_team_idx:
                    team_len = len(teams[team_index].roster[best_role])
                    new_avgs.append(avg + delta_strong / team_len)
                elif team_index == weak_team_idx:
                    team_len = len(teams[team_index].roster[best_role])
                    new_avgs.append(avg + delta_weak / team_len)
                else:
                    new_avgs.append(avg)

            mean = sum(new_avgs) / len(new_avgs)
            variance = sum((avg - mean) ** 2 for avg in new_avgs) / (len(new_avgs) - 1)
            new_stdev = math.sqrt(variance) if variance > 0 else 0.0
            if new_stdev >= best_stdev:
                continue

            _swap_players_in_place(
                teams,
                strong_team_idx,
                best_role,
                strong_index,
                weak_team_idx,
                best_role,
                weak_index,
                copied,
            )
            return True
    return False


def mutate_targeted(
    teams: list[Team],
    mask: dict[str, int],
    mutation_strength: int,
    config: AlgorithmConfig,
    use_captains: bool,
    rng: random.Random | None = None,
) -> list[Team]:
    """Apply smarter mutation strategies before falling back to a random shake."""
    rng = rng or random
    new_teams_list = list(teams)
    copied = [False] * len(new_teams_list)
    available_roles = sorted(role for role, count in mask.items() if count > 0)
    if not available_roles or len(new_teams_list) < 2:
        return new_teams_list

    strategies = (
        _strategy_robin_hood,
        _strategy_fix_worst_discomfort,
        _strategy_role_line_rebalance,
    )
    weights = (0.35, 0.35, 0.2)

    for _ in range(mutation_strength):
        roll = rng.random()
        cumulative = 0.0
        applied = False

        for strategy, probability in zip(strategies, weights, strict=True):
            cumulative += probability
            if roll < cumulative:
                if strategy is _strategy_robin_hood:
                    applied = strategy(new_teams_list, mask, available_roles, copied, use_captains, rng)
                else:
                    applied = strategy(new_teams_list, mask, available_roles, copied, use_captains)
                break
        if applied:
            continue

        shaken = mutate(new_teams_list, mask, 1, use_captains, rng=rng)
        for index, team in enumerate(shaken):
            if team is not new_teams_list[index]:
                new_teams_list[index] = team
                copied[index] = True

    return new_teams_list


def polish(
    teams: list[Team],
    config: AlgorithmConfig,
    mask: dict[str, int],
    use_captains: bool,
    max_passes: int = 5,
) -> list[Team]:
    """Run deterministic 2-opt style local search on the best solution."""
    current = [team.copy() for team in teams]
    best_cost = calculate_cost(current, config)
    available_roles = [role for role, count in mask.items() if count > 0]
    if not available_roles or len(current) < 2:
        return current

    team_count = len(current)
    for _ in range(max_passes):
        improved = False
        for left_index in range(team_count):
            team_left = current[left_index]
            for right_index in range(left_index + 1, team_count):
                team_right = current[right_index]
                for role in available_roles:
                    roster_left = team_left.roster.get(role, [])
                    roster_right = team_right.roster.get(role, [])
                    if not roster_left or not roster_right:
                        continue
                    for left_slot in range(len(roster_left)):
                        player_left = roster_left[left_slot]
                        if use_captains and player_left.is_captain:
                            continue
                        if not player_left.can_play(role):
                            continue
                        player_left_rating = player_left.get_rating(role)
                        player_left_discomfort = player_left.get_discomfort(role)
                        player_left_subclass = player_left.subclasses.get(role)
                        for right_slot in range(len(roster_right)):
                            player_right = roster_right[right_slot]
                            if use_captains and player_right.is_captain:
                                continue
                            if not player_right.can_play(role):
                                continue
                            if (
                                player_left_rating == player_right.get_rating(role)
                                and player_left_discomfort == player_right.get_discomfort(role)
                                and player_left_subclass == player_right.subclasses.get(role)
                            ):
                                continue

                            team_left.replace_player(role, left_slot, player_right)
                            team_right.replace_player(role, right_slot, player_left)
                            new_cost = calculate_cost(current, config)
                            if new_cost < best_cost - 1e-9:
                                best_cost = new_cost
                                improved = True
                                player_left = player_right
                                player_left_rating = player_left.get_rating(role)
                                player_left_discomfort = player_left.get_discomfort(role)
                                player_left_subclass = player_left.subclasses.get(role)
                            else:
                                team_left.replace_player(role, left_slot, player_left)
                                team_right.replace_player(role, right_slot, player_right)
        if not improved:
            break

    return current


def mutate(
    teams: list[Team],
    mask: dict[str, int],
    mutation_strength: int,
    use_captains: bool,
    rng: random.Random | None = None,
) -> list[Team]:
    """Apply legacy random mutations to a team configuration."""
    rng = rng or random
    new_teams_list = list(teams)
    copied = [False] * len(new_teams_list)

    def ensure_copy(index: int) -> None:
        if copied[index]:
            return
        new_teams_list[index] = new_teams_list[index].copy()
        copied[index] = True

    available_roles = sorted(role for role, count in mask.items() if count > 0)
    if not available_roles:
        return new_teams_list

    team_count = len(new_teams_list)
    if team_count < 2:
        return new_teams_list

    for _ in range(mutation_strength):
        if rng.random() < 0.8:
            role = rng.choice(available_roles)
            team_a_idx, team_b_idx = rng.sample(range(team_count), 2)
            team_a = new_teams_list[team_a_idx]
            team_b = new_teams_list[team_b_idx]
            roster_a = team_a.roster[role]
            roster_b = team_b.roster[role]
            if not roster_a or not roster_b:
                continue

            index_a = rng.randrange(len(roster_a))
            index_b = rng.randrange(len(roster_b))
            player_a = roster_a[index_a]
            player_b = roster_b[index_b]
            if use_captains and (player_a.is_captain or player_b.is_captain):
                continue

            ensure_copy(team_a_idx)
            ensure_copy(team_b_idx)
            new_teams_list[team_a_idx].replace_player(role, index_a, player_b)
            new_teams_list[team_b_idx].replace_player(role, index_b, player_a)
        else:
            if len(available_roles) < 2:
                continue

            team_idx = rng.randrange(team_count)
            team = new_teams_list[team_idx]
            role_a, role_b = rng.sample(available_roles, 2)
            roster_a = team.roster[role_a]
            roster_b = team.roster[role_b]
            if not roster_a or not roster_b:
                continue

            candidates_a = [
                index
                for index, player in enumerate(roster_a)
                if player.can_play(role_b) and (not use_captains or not player.is_captain)
            ]
            candidates_b = [
                index
                for index, player in enumerate(roster_b)
                if player.can_play(role_a) and (not use_captains or not player.is_captain)
            ]
            if not candidates_a or not candidates_b:
                continue

            index_a = rng.choice(candidates_a)
            index_b = rng.choice(candidates_b)
            player_a = roster_a[index_a]
            player_b = roster_b[index_b]
            if use_captains and (player_a.is_captain or player_b.is_captain):
                continue

            ensure_copy(team_idx)
            team_copy = new_teams_list[team_idx]
            team_copy.replace_player(role_a, index_a, player_b)
            team_copy.replace_player(role_b, index_b, player_a)

    return new_teams_list


class MutationEngine:
    def mutate(
        self,
        *,
        teams: list[Team],
        mask: dict[str, int],
        mutation_strength: int,
        config: AlgorithmConfig,
        use_captains: bool,
        rng: random.Random | None = None,
    ) -> list[Team]:
        return mutate_targeted(teams, mask, mutation_strength, config, use_captains, rng=rng)
