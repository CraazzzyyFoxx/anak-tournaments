"""The universal scoring engine: which game is valid, what it pays, what an
encounter adds up to and whether a captain's series claim can be true (plan §5).

Pure, no session and no ORM row::

    uv run pytest shared/tests/test_encounter_scoring.py -v
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from shared.domain.encounter_scoring import (
    FfaResultError,
    GameLine,
    ScoringColumn,
    ScoringRules,
    SeriesClaim,
    compile_rules,
    evaluate_encounter,
    ffa_rules,
    game_points,
    normalize_game_lines,
    resolve_placements,
    series_claim_errors,
    team_totals,
)
from shared.domain.ffa_formula import END_VARIABLES, FfaFormulaError, compile_formula


def wins_rules() -> ScoringRules:
    return ScoringRules(
        preset="wins",
        columns=(),
        placement_points=(),
        game_formula=compile_formula("win", ()),
        end_formula=compile_formula("games >= best_of or max_wins * 2 > best_of", (), variables=END_VARIABLES),
    )


def points_rules(formula: str, columns: tuple[str, ...], placement_points=(10.0, 6.0, 4.0, 2.0)) -> ScoringRules:
    return ScoringRules(
        preset="points",
        columns=tuple(ScoringColumn(key=c, label=c) for c in columns),
        placement_points=placement_points,
        game_formula=compile_formula(formula, columns),
        end_formula=compile_formula("games >= best_of", (), variables=END_VARIABLES),
    )


def duel(a: int, b: int) -> list[GameLine]:
    return [GameLine(1, a, None, {}), GameLine(2, b, None, {})]


def test_bo2_ends_at_one_all():
    out = evaluate_encounter(wins_rules(), best_of=2, team_ids=[1, 2], games=[duel(3, 1), duel(0, 2)])
    assert out.ended
    assert out.totals == {1: 1.0, 2: 1.0}
    assert out.placements == {1: 1, 2: 1}


def test_drawn_map_gives_no_win():
    assert game_points(wins_rules(), duel(2, 2)) == {1: 0.0, 2: 0.0}


def test_bo3_two_nil_ends_after_two_games():
    rules = wins_rules()
    assert not evaluate_encounter(rules, best_of=3, team_ids=[1, 2], games=[duel(1, 0)]).ended
    out = evaluate_encounter(rules, best_of=3, team_ids=[1, 2], games=[duel(1, 0), duel(2, 1)])
    assert out.ended
    assert out.wins == {1: 2, 2: 0}
    assert out.placements == {1: 1, 2: 2}


def test_ffa_penalties_can_go_negative():
    rules = points_rules("place_pts + kills - 5 * fouls", ("kills", "fouls"))
    lines = [GameLine(1, None, 1, {"kills": 0, "fouls": 3}), GameLine(2, None, 2, {"kills": 1, "fouls": 0})]
    assert game_points(rules, lines) == {1: -5.0, 2: 7.0}


def test_tied_totals_share_a_place():
    rules = points_rules("kills", ("kills",))
    game = [GameLine(t, None, None, {"kills": k}) for t, k in ((1, 10), (2, 7), (3, 7), (4, 3))]
    out = evaluate_encounter(rules, best_of=1, team_ids=[1, 2, 3, 4], games=[game])
    assert out.placements == {1: 1, 2: 2, 3: 2, 4: 4}


def test_series_claim_three_nil_in_bo3_is_unreachable():
    claim = SeriesClaim(games_played=3, totals={1: 3.0, 2: 0.0}, wins={1: 3, 2: 0}, placements={1: 1, 2: 2})
    errors = series_claim_errors(wins_rules(), best_of=3, team_ids=[1, 2], confirmed_games=[], claim=claim)
    assert "series_claim_unreachable" in errors


def test_series_claim_with_unknown_games_has_no_lower_bound():
    rules = points_rules("place_pts - 5 * fouls", ("fouls",), placement_points=(3.0, 0.0))
    known = [[GameLine(1, None, 1, {"fouls": 0}), GameLine(2, None, 2, {"fouls": 0})]]  # 3 : 0 after game 1
    claim = SeriesClaim(games_played=2, totals={1: -2.0, 2: 3.0}, wins=None, placements={1: 2, 2: 1})
    assert series_claim_errors(rules, best_of=2, team_ids=[1, 2], confirmed_games=known, claim=claim) == []


def test_series_claim_mismatch_when_all_games_known():
    known = [duel(1, 0), duel(1, 0)]
    claim = SeriesClaim(games_played=2, totals={1: 1.0, 2: 1.0}, wins={1: 1, 2: 1}, placements={1: 1, 2: 1})
    errors = series_claim_errors(wins_rules(), best_of=3, team_ids=[1, 2], confirmed_games=known, claim=claim)
    assert "series_claim_mismatch" in errors


def test_end_formula_rejects_column_names():
    with pytest.raises(FfaFormulaError):
        compile_formula("kills > 3", (), variables=END_VARIABLES)


# ── an FFA lobby's game ──────────────────────────────────────────────────────


def lobby_rules(formula: str, *columns: ScoringColumn, placement_points: tuple[float, ...] = ()) -> ScoringRules:
    used = columns or (ScoringColumn(key="score", label="Счёт"),)
    return ScoringRules(
        preset="points",
        columns=used,
        placement_points=placement_points,
        game_formula=compile_formula(formula, [column.key for column in used]),
        end_formula=compile_formula("games >= best_of", (), variables=END_VARIABLES),
    )


KILLS = ScoringColumn(key="kills", label="Kills")
DEATHS = ScoringColumn(key="deaths", label="Deaths", public=False, better="lower")

BATTLE_ROYALE = lobby_rules("place_pts + kills", KILLS, placement_points=(10, 6, 5))
BY_SCORE = lobby_rules("kills * 2 - deaths", KILLS, DEATHS)


def line(team_id: int, placement: int | None = None, **values: float) -> GameLine:
    return GameLine(encounter_team_id=team_id, score=None, placement=placement, values=values)


def test_placement_is_required_exactly_when_the_formula_reads_it() -> None:
    assert BATTLE_ROYALE.requires_placement is True
    assert BY_SCORE.requires_placement is False
    assert lobby_rules("teams - place").requires_placement is True


def test_places_are_derived_from_game_points_with_shared_places() -> None:
    # 10, 7, 7, 3 -> 1, 2, 2, 4: the points the formula paid, not a raw column.
    lines = normalize_game_lines(
        [
            line(1, kills=5, deaths=0),
            line(2, kills=3, deaths=1),
            line(3, kills=3, deaths=1),
            line(4, kills=1, deaths=0),
        ],
        [1, 2, 3, 4],
        BY_SCORE,
    )

    assert [(item.encounter_team_id, item.placement) for item in lines] == [(1, 1), (2, 2), (3, 2), (4, 4)]


def test_a_formula_that_pays_for_placement_needs_every_place_exactly_once() -> None:
    with pytest.raises(FfaResultError) as missing:
        normalize_game_lines([line(1, kills=3), line(2, kills=1)], [1, 2], BATTLE_ROYALE)
    with pytest.raises(FfaResultError) as shared_place:
        normalize_game_lines([line(1, 1, kills=3), line(2, 1, kills=1)], [1, 2], BATTLE_ROYALE)

    assert missing.value.code == "ffa_result_placement_required"
    assert shared_place.value.code == "ffa_result_invalid_placement"


def test_a_formula_that_ignores_placement_accepts_given_places_including_ties() -> None:
    lines = normalize_game_lines([line(1, 1, kills=5, deaths=0), line(2, 1, kills=5, deaths=0)], [1, 2], BY_SCORE)

    assert [item.placement for item in lines] == [1, 1]


def test_a_stored_placeless_game_is_placed_by_the_current_formula() -> None:
    stored = [line(1, kills=5, deaths=0), line(2, kills=3, deaths=1), line(3, kills=1, deaths=0)]

    # kills * 2 - deaths: 10, 5, 2.
    assert resolve_placements(BY_SCORE, stored) == {1: 1, 2: 2, 3: 3}

    # The organizer swaps the formula for kills - deaths * 3: 5, 0, 1.
    later = lobby_rules("kills - deaths * 3", KILLS, DEATHS)
    assert resolve_placements(later, stored) == {1: 1, 3: 2, 2: 3}


def test_the_places_that_were_entered_are_kept() -> None:
    entered = [line(2, 1, kills=1, deaths=0), line(1, 2, kills=9, deaths=0)]

    # Team 1 scores far more and is still second: the organizer said so.
    assert resolve_placements(BY_SCORE, entered) == {2: 1, 1: 2}


def test_a_placeless_game_falls_back_to_the_place_independent_part() -> None:
    # A formula that reads the place, over a game recorded before it did: a
    # missing place pays 0, so ``place_pts`` is 0 for everyone and the kills
    # decide -- an answer, not a crash, and the same one on every read.
    placeless = [line(1, kills=2), line(2, kills=7), line(3, kills=4)]

    placed = resolve_placements(BATTLE_ROYALE, placeless)

    assert placed == {2: 1, 3: 2, 1: 3}
    assert resolve_placements(BATTLE_ROYALE, list(reversed(placeless))) == placed


@pytest.mark.parametrize(
    ("lines", "code"),
    [
        (
            [line(1, kills=1, deaths=0), line(2, kills=1, deaths=0), line(9, kills=1, deaths=0)],
            "ffa_result_unknown_team",
        ),
        (
            [line(1, kills=1, deaths=0), line(1, kills=2, deaths=0), line(2, kills=1, deaths=0)],
            "ffa_result_duplicate_team",
        ),
        ([line(1, kills=1, deaths=0)], "ffa_result_missing_team"),
        ([line(1, kills=1, deaths=0, assists=2), line(2, kills=1, deaths=0)], "ffa_result_unknown_stat"),
        ([line(1, kills=1), line(2, kills=1, deaths=0)], "ffa_result_missing_stat"),
        ([line(1, kills=-1, deaths=0), line(2, kills=1, deaths=0)], "ffa_result_invalid_stat"),
        ([line(1, kills=float("inf"), deaths=0), line(2, kills=1, deaths=0)], "ffa_result_invalid_stat"),
        ([line(1, kills=2e9, deaths=0), line(2, kills=1, deaths=0)], "ffa_result_invalid_stat"),
        ([line(1, 1, kills=1, deaths=0), line(2, kills=1, deaths=0)], "ffa_result_mixed_placement"),
        ([line(1, 3, kills=1, deaths=0), line(2, 1, kills=1, deaths=0)], "ffa_result_invalid_placement"),
    ],
)
def test_a_game_is_refused_with_the_code_the_client_branches_on(lines: list[GameLine], code: str) -> None:
    with pytest.raises(FfaResultError) as exc_info:
        normalize_game_lines(lines, [1, 2], BY_SCORE)

    assert exc_info.value.code == code


def test_game_points_are_the_formula_rounded_to_four_places() -> None:
    thirds = lobby_rules("kills / 3", KILLS)

    assert game_points(thirds, [line(1, 1, kills=10)]) == {1: 3.3333}
    assert game_points(BATTLE_ROYALE, [line(1, 2, kills=4)]) == {1: 10.0}
    # A place past the end of the table pays nothing; kills still count.
    assert game_points(BATTLE_ROYALE, [line(1, 9, kills=2)]) == {1: 2.0}


def test_a_key_with_no_value_counts_as_zero() -> None:
    # A column added mid-stage must not break the games already played.
    later = lobby_rules("kills + assists", KILLS, ScoringColumn(key="assists", label="Assists"))

    assert game_points(later, [line(1, 1, kills=4)]) == {1: 4.0}


def test_totals_sum_every_column_and_seed_the_whole_roster() -> None:
    games = [
        normalize_game_lines([line(1, 1, kills=3), line(2, 2, kills=5), line(3, 3, kills=0)], [1, 2, 3], BATTLE_ROYALE),
        normalize_game_lines([line(1, 3, kills=0), line(2, 1, kills=2), line(3, 2, kills=1)], [1, 2, 3], BATTLE_ROYALE),
    ]

    totals = team_totals([1, 2, 3, 4], games, BATTLE_ROYALE)

    assert totals[1].points == 13 + 5 and totals[1].wins == 1 and totals[1].last_placement == 3
    assert totals[2].points == 11 + 12 and totals[2].best_placement == 1
    assert totals[2].stats == {"kills": 7.0}
    assert totals[4].games == 0 and totals[4].points == 0 and totals[4].stats == {"kills": 0.0}


# ── where the rules come from ────────────────────────────────────────────────


def test_no_stage_reads_as_one_score_column() -> None:
    default = ffa_rules(None)

    assert default.column_keys == ("score",)
    assert default.requires_placement is False
    assert game_points(default, [line(1, 1, score=7)]) == {1: 7.0}


def test_a_stage_without_columns_scores_placement_only() -> None:
    # An empty column list is a legal stage, not a missing one: a placement-only
    # league must not fall back to the score column and score everyone zero.
    stage = SimpleNamespace(ffa_columns=[], ffa_placement_points=[10, 6, 3], ffa_formula="place_pts")

    rules = ffa_rules(stage)

    assert rules.column_keys == ()
    assert rules.requires_placement is True
    assert game_points(rules, [line(1, 2)]) == {1: 6.0}


def test_rules_read_the_stage_columns() -> None:
    stage = SimpleNamespace(
        ffa_columns=[
            {"key": "kills", "label": "Убийства"},
            {"key": "deaths", "label": "Смерти", "public": False, "better": "lower"},
        ],
        ffa_placement_points=[10, 6, 5],
        ffa_formula="place_pts + kills * 2 - deaths",
    )

    parsed = ffa_rules(stage)

    assert parsed.columns == (
        ScoringColumn(key="kills", label="Убийства"),
        ScoringColumn(key="deaths", label="Смерти", public=False, better="lower"),
    )
    assert parsed.placement_points == (10.0, 6.0, 5.0)
    assert parsed.requires_placement is True
    assert game_points(parsed, [line(1, 2, kills=3, deaths=1)]) == {1: 11.0}


def test_a_stored_rule_row_compiles_into_both_formulas() -> None:
    row = SimpleNamespace(
        preset="wins",
        columns=[],
        placement_points=[],
        game_formula="win",
        end_formula="games >= best_of or max_wins * 2 > best_of",
    )

    rules = compile_rules(row)

    assert (rules.preset, rules.columns, rules.placement_points) == ("wins", (), ())
    assert evaluate_encounter(rules, best_of=3, team_ids=[1, 2], games=[duel(1, 0), duel(2, 1)]).ended
