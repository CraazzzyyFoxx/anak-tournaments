from __future__ import annotations

import random

from src.domain.balancer.entities import Player, Team
from src.domain.balancer.role_assignment_service import find_feasible_role_assignment


def create_random_solution(
    players: list[Player],
    num_teams: int,
    mask: dict[str, int],
    use_captains: bool,
    role_assignment: dict[str, str] | None = None,
    rng: random.Random | None = None,
) -> list[Team]:
    """Build a complete random team assignment for a feasible player pool."""
    rng = rng or random
    teams = [Team(index + 1, mask) for index in range(num_teams)]
    if num_teams <= 0 or not players:
        return teams

    if role_assignment is None:
        role_assignment = find_feasible_role_assignment(players, num_teams, mask, rng=rng)
    if role_assignment is None:
        return teams

    active_roles = sorted(role for role, count in mask.items() if count > 0)
    buckets: dict[str, list[Player]] = {role: [] for role in active_roles}
    captain_buckets: dict[str, list[Player]] = {role: [] for role in buckets}
    for player in players:
        role = role_assignment.get(player.uuid)
        if role is None or role not in buckets:
            continue
        if use_captains and player.is_captain:
            captain_buckets[role].append(player)
        else:
            buckets[role].append(player)

    for role_players in buckets.values():
        rng.shuffle(role_players)
    for role_players in captain_buckets.values():
        rng.shuffle(role_players)

    if use_captains:
        captains_flat: list[tuple[str, Player]] = []
        for role, players_for_role in captain_buckets.items():
            for captain in players_for_role:
                captains_flat.append((role, captain))
        rng.shuffle(captains_flat)

        team_cursor = 0
        for role, captain in captains_flat:
            placed = False
            for _ in range(num_teams):
                team = teams[team_cursor % num_teams]
                team_cursor += 1
                if len(team.roster[role]) < mask[role]:
                    team.add_player(role, captain)
                    placed = True
                    break
            if not placed:
                buckets[role].append(captain)

    for role, players_for_role in buckets.items():
        if not players_for_role:
            continue
        team_cursor = 0
        while players_for_role:
            placed = False
            for _ in range(num_teams):
                team = teams[team_cursor % num_teams]
                team_cursor += 1
                if len(team.roster[role]) < mask[role]:
                    team.add_player(role, players_for_role.pop())
                    placed = True
                    break
            if not placed:
                break

    return teams


class PopulationSeeder:
    def seed(
        self,
        *,
        players: list[Player],
        num_teams: int,
        mask: dict[str, int],
        use_captains: bool,
        role_assignment: dict[str, str] | None = None,
        rng: random.Random | None = None,
    ) -> list[Team]:
        return create_random_solution(
            players,
            num_teams,
            mask,
            use_captains,
            role_assignment=role_assignment,
            rng=rng,
        )
