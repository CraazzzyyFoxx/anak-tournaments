"""OpenSkill must skip encounters whose roster is empty.

``pl.rate`` raises ``ValueError: Argument 'teams' must have at least 1 player
per team, not 0`` (OWT-TOURNAMENTS-29G) when a side has no players — a real
bracket state (bye / not-yet-rostered), not a defect in the rating math.
"""

from __future__ import annotations

import importlib
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

import pandas as pd

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "analytics-service"))

ratings = importlib.import_module("src.domain.ratings")


def _player(uid: int, role: str = "tank") -> SimpleNamespace:
    return SimpleNamespace(
        workspace_member=SimpleNamespace(player_id=uid),
        role=role,
        is_newcomer=False,
        is_newcomer_role=False,
        rank=1100,
    )


def _team(team_id: int, players: list, name: str = "T") -> SimpleNamespace:
    return SimpleNamespace(id=team_id, name=name, players=players)


def _encounter(*sides: tuple[SimpleNamespace, float, int]) -> SimpleNamespace:
    """An encounter with one live seat per ``(team, score, placement)``, in slot order."""
    return SimpleNamespace(
        tournament_id=1,
        teams=[
            SimpleNamespace(slot=slot, active=True, team_id=team.id, name=team.name, score=score, placement=placement)
            for slot, (team, score, placement) in enumerate(sides, 1)
        ],
        tournament=SimpleNamespace(start_date=datetime.now(UTC)),
    )


def _rosters(*teams: SimpleNamespace) -> dict[int, SimpleNamespace]:
    return {team.id: team for team in teams}


class EmptyRosterOpenskillTests(TestCase):
    def test_skips_an_empty_side_and_rates_the_rest(self) -> None:
        pl = ratings.get_plackett_luce()
        p1, p2 = _player(1), _player(2)
        empty_home, other, left, right = _team(10, []), _team(20, [p2]), _team(30, [p1]), _team(40, [p2])
        empty = _encounter((empty_home, 2, 1), (other, 1, 2))
        ok = _encounter((left, 2, 1), (right, 1, 2))

        _, players_rating, matches = ratings.prepare_openskill_data(
            pd.DataFrame(), pl, [], [empty, ok], _rosters(empty_home, other, left, right)
        )

        self.assertEqual(1, len(matches))
        self.assertEqual([30, 40], [side.team_id for side in matches[0].teams])
        self.assertIn("1-tank", players_rating)
        self.assertIn("2-tank", players_rating)

    def test_a_lobby_rates_every_seat_by_placement(self) -> None:
        pl = ratings.get_plackett_luce()
        teams = [_team(10 + i, [_player(i + 1)]) for i in range(3)]
        lobby = _encounter((teams[0], 10, 3), (teams[1], 30, 1), (teams[2], 20, 2))

        _, rating, matches = ratings.prepare_openskill_data(pd.DataFrame(), pl, [], [lobby], _rosters(*teams))

        self.assertEqual(3, len(matches[0].teams))
        mus = [rating[f"{i}-tank"].mu for i in (1, 2, 3)]
        self.assertGreater(mus[1], mus[2])
        self.assertGreater(mus[2], mus[0])

    def test_an_encounter_without_a_result_is_not_replayed(self) -> None:
        pl = ratings.get_plackett_luce()
        a, b = _team(10, [_player(1)]), _team(20, [_player(2)])
        open_ = _encounter((a, 0, None), (b, 0, None))

        _, _, matches = ratings.prepare_openskill_data(pd.DataFrame(), pl, [], [open_], _rosters(a, b))

        self.assertEqual([], matches)


class UnrankedSeedTests(TestCase):
    def test_unranked_player_seeds_at_the_model_default(self) -> None:
        pl = ratings.get_plackett_luce()
        player = _player(1)
        player.rank = None
        seed = ratings.get_player_rating(pl, player)
        self.assertEqual((pl.mu, pl.sigma), (seed.mu, seed.sigma))
        player.is_newcomer = True
        newcomer = ratings.get_player_rating(pl, player)
        self.assertEqual(pl.mu, newcomer.mu)
        self.assertGreater(newcomer.sigma, pl.sigma)
