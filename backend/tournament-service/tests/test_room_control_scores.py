"""The forfeit score rule, as plain arithmetic.

``default_technical_score`` is what a walkover is recorded as when the organizer
names no explicit score, and it is a pure function of the card length and what
each participation had already won -- so it is pinned here without a database,
the way its two-sided ancestor was.
"""

from __future__ import annotations

from unittest import TestCase

from src.services.encounter.room_control import default_technical_score

A, B = 101, 102


class DefaultTechnicalScoreTests(TestCase):
    def test_a_forfeit_from_nil_gives_the_winner_a_winning_series(self) -> None:
        self.assertEqual(
            {A: 2.0, B: 0.0},
            default_technical_score(best_of=3, wins={A: 0, B: 0}, loser_team_id=B),
        )

    def test_the_forfeiting_seat_keeps_the_maps_it_really_won(self) -> None:
        """A Bo5 standing 2:0 for the seat that then forfeits is recorded 2:3 --
        the two maps are history, the series is not theirs."""
        self.assertEqual(
            {A: 3.0, B: 2.0},
            default_technical_score(best_of=5, wins={A: 0, B: 2}, loser_team_id=B),
        )

    def test_the_forfeiting_seat_is_capped_one_short_of_winning(self) -> None:
        """Even a seat that had already won the series on maps cannot be
        recorded as winning it by forfeit."""
        self.assertEqual(
            {A: 3.0, B: 2.0},
            default_technical_score(best_of=5, wins={A: 0, B: 3}, loser_team_id=B),
        )

    def test_the_winner_keeps_more_than_the_minimum_when_it_had_it(self) -> None:
        self.assertEqual(
            {A: 4.0, B: 1.0},
            default_technical_score(best_of=5, wins={A: 4, B: 1}, loser_team_id=B),
        )

    def test_a_best_of_one_is_a_single_map(self) -> None:
        self.assertEqual(
            {A: 1.0, B: 0.0},
            default_technical_score(best_of=1, wins={A: 0, B: 0}, loser_team_id=B),
        )

    def test_a_card_of_any_width_is_scored_the_same_way(self) -> None:
        """Nothing here is about two sides: every seat but the forfeiting one is
        given the winning count."""
        self.assertEqual(
            {A: 2.0, B: 0.0, 103: 2.0},
            default_technical_score(best_of=3, wins={A: 0, B: 0, 103: 2}, loser_team_id=B),
        )
