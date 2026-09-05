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


def _encounter(home, away, *, home_score: int = 2, away_score: int = 1) -> SimpleNamespace:
    return SimpleNamespace(
        tournament_id=1,
        home_team_id=home.id,
        away_team_id=away.id,
        home_team=home,
        away_team=away,
        home_score=home_score,
        away_score=away_score,
        tournament=SimpleNamespace(start_date=datetime.now(UTC)),
    )


class EmptyRosterOpenskillTests(TestCase):
    def test_skips_an_empty_side_and_rates_the_rest(self) -> None:
        pl = ratings.get_plackett_luce()
        p1, p2 = _player(1), _player(2)
        empty = _encounter(_team(10, []), _team(20, [p2]))
        ok = _encounter(_team(30, [p1]), _team(40, [p2]))

        _, players_rating, matches = ratings.prepare_openskill_data(pd.DataFrame(), pl, [], [empty, ok])

        self.assertEqual(1, len(matches))
        self.assertEqual(ok.home_team_id, matches[0].home_team_id)
        self.assertIn("1-tank", players_rating)
        self.assertIn("2-tank", players_rating)
