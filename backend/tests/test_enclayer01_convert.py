"""Golden test for the pure converters inside the ``enclayer01`` revision.

Loaded by path, like ``test_regident01_convert.py``: a migration may not import
``shared`` -- the data half has to keep working against the schema as it stood
when it ran, not against whatever the models look like later -- so the only way
to pin its rules is to call them from here.
"""

from __future__ import annotations

import importlib.util
import pathlib

import pytest

_PATH = pathlib.Path(__file__).resolve().parents[1] / "migrations" / "versions" / "enclayer01_encounter_layer.py"
spec = importlib.util.spec_from_file_location("enclayer01", _PATH)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

WINS_END = "games >= best_of or max_wins * 2 > best_of"


def test_ffa_league_stage_becomes_a_points_rule_keeping_its_columns():
    columns = [{"key": "kills", "label": "Фраги", "public": True, "better": "higher"}]
    rule = mod.scoring_rule_for_stage("ffa_league", columns, "place_pts + kills", [10.0, 6.0, 4.0])

    assert rule == {
        "preset": "points",
        "columns": columns,
        "placement_points": [10.0, 6.0, 4.0],
        "game_formula": "place_pts + kills",
        "end_formula": "games >= best_of",
    }
    # A lobby stage that never had a formula still needs one the engine compiles.
    assert mod.scoring_rule_for_stage("ffa_league", None, None, None)["game_formula"] == "score"


def test_every_other_stage_type_becomes_the_wins_preset():
    for stage_type in ("round_robin", "single_elimination", "double_elimination", "swiss"):
        rule = mod.scoring_rule_for_stage(stage_type, [{"key": "score"}], "score", [5.0])
        # The FFA columns of a bracket stage are defaults nobody entered: a
        # series is decided by wins, and carrying them would compile a formula
        # the preset never evaluates.
        assert rule == {
            "preset": "wins",
            "columns": [],
            "placement_points": [],
            "game_formula": "win",
            "end_formula": WINS_END,
        }


def test_an_unmapped_lobby_stage_type_stops_the_revision():
    # ``ffa_league`` is the only ``ffa_`` member of ``StageType`` today. A new
    # one silently scored as ``wins`` would never be picked up by the lobby
    # recompute (it selects ``preset == 'points'``) and would keep score 0
    # forever, so the migration refuses instead.
    with pytest.raises(RuntimeError, match="ffa_rounds"):
        mod.scoring_rule_for_stage("ffa_rounds", None, "score", None)


def test_duel_placements_rank_by_score_only_once_the_encounter_is_over():
    assert mod.duel_placements(2, 0, True) == (1, 2)
    assert mod.duel_placements(1, 3, True) == (2, 1)
    assert mod.duel_placements(1, 1, True) == (1, 1)
    assert mod.duel_placements(0, 0, True) == (1, 1)
    assert mod.duel_placements(2, 0, False) == (None, None)


def test_result_source_is_games_only_when_the_stored_score_is_the_games_score():
    assert mod.result_source_for(True, (2, 1), (2, 1)) == "games"
    assert mod.result_source_for(True, (2, 0), (2, 1)) == "import"
    assert mod.result_source_for(True, (2, 0), None) == "import"
    # Nothing official happened yet: readers fall back to the live game score.
    assert mod.result_source_for(False, (2, 0), (2, 0)) is None


def test_a_confirmed_lobby_with_games_is_games_not_import():
    # A lobby stores no series score and none of its games carries an accepted
    # pair, so there is nothing to compare -- but ``import`` would freeze it
    # against every later game correction, which only a ``games`` result follows.
    assert mod.result_source_for(True, (0, 0), None, lobby_with_games=True) == "games"
    # Not official yet is still no source, lobby or not.
    assert mod.result_source_for(False, (0, 0), None, lobby_with_games=True) is None
    # A confirmed lobby with no game to recompute from is somebody's number.
    assert mod.result_source_for(True, (0, 0), None, lobby_with_games=False) == "import"


def test_ruleset_actors_become_slots_and_everything_else_is_left_alone():
    assert mod.ruleset_actor("home") == "slot:1"
    assert mod.ruleset_actor("away") == "slot:2"
    for actor in ("first", "second", "both", "winner_prev", "loser_prev", "system"):
        assert mod.ruleset_actor(actor) == actor

    doc = {
        "version": 2,
        "phases": [
            {"id": "p1", "steps": [{"id": "s1", "action": "ban", "actors": "home"}]},
            {"id": "p2", "steps": [{"id": "s2", "action": "pick", "actors": "winner_prev"}]},
        ],
    }
    assert mod.rewrite_ruleset(doc) == {
        "version": 2,
        "phases": [
            {"id": "p1", "steps": [{"id": "s1", "action": "ban", "actors": "slot:1"}]},
            {"id": "p2", "steps": [{"id": "s2", "action": "pick", "actors": "winner_prev"}]},
        ],
    }
    assert mod.rewrite_ruleset(None) is None


def test_stored_notification_payloads_trade_the_home_away_pair_for_team_names():
    stored = {"encounter_id": 5, "tournament_id": 2, "home_team_name": "Vanguard", "away_team_name": "Rearguard"}
    assert mod.notification_payload(stored) == {
        "encounter_id": 5,
        "tournament_id": 2,
        "team_names": ["Vanguard", "Rearguard"],
    }
    # The producers wrote "" for a missing seat; a null or absent half is the same seat.
    assert mod.notification_payload({"home_team_name": "Solo", "away_team_name": None})["team_names"] == ["Solo", ""]
    assert mod.notification_payload({"away_team_name": "B"})["team_names"] == ["", "B"]


def test_notification_payload_step_is_idempotent_and_keeps_a_lobby_list():
    assert mod.notification_payload(
        {"team_names": ["A", "B", "C"], "home_team_name": "A", "away_team_name": "B", "position": 1}
    ) == {"team_names": ["A", "B", "C"], "position": 1}
    done = {"encounter_id": 5, "team_names": ["Vanguard", "Rearguard"]}
    assert mod.notification_payload(done) == done
    assert mod.notification_payload(mod.notification_payload({"home_team_name": "A", "away_team_name": "B"})) == {
        "team_names": ["A", "B"]
    }
    assert mod.notification_payload(None) is None


def test_duel_audit_rows_become_one_entry_per_occupied_slot():
    slots = {1: 71, 2: 72}
    row = {
        "home_score_before": 1,
        "away_score_before": 0,
        "home_score_after": 2,
        "away_score_after": 0,
        "ffa_results_json": None,
        "game_id": None,
    }
    assert mod.audit_snapshot(row, slots, {}) == {
        "before": [
            {"encounter_team_id": 71, "score": 1, "placement": 1},
            {"encounter_team_id": 72, "score": 0, "placement": 2},
        ],
        "after": [
            {"encounter_team_id": 71, "score": 2, "placement": 1},
            {"encounter_team_id": 72, "score": 0, "placement": 2},
        ],
        "snapshot_scope": "encounter",
    }

    # A position's first accepted result: nothing preceded it, and the numbers
    # are the game's, not the series'.
    first = dict(row, home_score_before=None, away_score_before=None, game_id=9)
    snapshot = mod.audit_snapshot(first, slots, {})
    assert snapshot["before"] is None
    assert snapshot["snapshot_scope"] == "game"


def test_a_lobby_total_is_an_encounter_snapshot_even_on_a_game_row():
    row = {
        "home_score_before": None,
        "away_score_before": None,
        "home_score_after": None,
        "away_score_after": None,
        "game_id": 9,
        "ffa_results_json": {
            "before": [{"team_id": 5, "points": 10.0, "games": 1}],
            "after": [{"team_id": 5, "points": 17.0, "games": 2}],
        },
    }
    assert mod.audit_snapshot(row, {}, {5: 55}) == {
        "before": [{"encounter_team_id": 55, "points": 10.0, "games": 1}],
        "after": [{"encounter_team_id": 55, "points": 17.0, "games": 2}],
        "snapshot_scope": "encounter",
    }


def test_a_lobby_game_snapshot_stays_a_game_snapshot():
    row = {
        "home_score_before": None,
        "away_score_before": None,
        "home_score_after": None,
        "away_score_after": None,
        "game_id": 9,
        "ffa_results_json": {
            "before": [],
            # The team that left the lobby since has no participation to name;
            # its entry stays readable in the legacy column, which enclayer01
            # does not drop.
            "after": [
                {"team_id": 5, "placement": 1, "stats": {"kills": 4}},
                {"team_id": 6, "placement": 2, "stats": {}},
            ],
        },
    }
    assert mod.audit_snapshot(row, {}, {5: 55}) == {
        "before": [],
        "after": [{"encounter_team_id": 55, "placement": 1, "stats": {"kills": 4}}],
        "snapshot_scope": "game",
    }
