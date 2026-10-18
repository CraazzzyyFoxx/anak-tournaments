"""Play-order helpers for user encounter / map-result assembly."""

from datetime import UTC, datetime
from types import SimpleNamespace

from src.services.user._mappers import (
    encounter_play_key,
    sort_user_matches,
    to_match_with_user_stats,
)


def _match(id_: int, map_id: int, map_index: int):
    return SimpleNamespace(id=id_, map_id=map_id, map_index=map_index)


def test_encounter_play_key_prefers_ended_at_over_id():
    earlier = SimpleNamespace(
        id=99,
        ended_at=datetime(2026, 8, 1, tzinfo=UTC),
        started_at=None,
        scheduled_at=None,
        created_at=datetime(2026, 8, 10, tzinfo=UTC),
    )
    later = SimpleNamespace(
        id=1,
        ended_at=datetime(2026, 8, 16, tzinfo=UTC),
        started_at=None,
        scheduled_at=None,
        created_at=datetime(2026, 8, 1, tzinfo=UTC),
    )
    assert encounter_play_key(earlier) < encounter_play_key(later)


def test_encounter_play_key_uses_confirmed_at_not_insert_order():
    group = SimpleNamespace(
        id=6136,
        ended_at=None,
        confirmed_at=datetime(2026, 8, 15, 18, 0, tzinfo=UTC),
        started_at=None,
        created_at=datetime(2026, 8, 16, 10, 0, tzinfo=UTC),
    )
    playoff = SimpleNamespace(
        id=6104,
        ended_at=None,
        confirmed_at=datetime(2026, 8, 16, 18, 32, tzinfo=UTC),
        started_at=None,
        created_at=datetime(2026, 8, 14, 10, 0, tzinfo=UTC),
    )
    assert encounter_play_key(group) < encounter_play_key(playoff)


def test_sort_user_matches_uses_map_index():
    matches = [_match(3, 15, 3), _match(1, 31, 2), _match(2, 44, 1)]
    assert [m.id for m in sort_user_matches(matches)] == [2, 1, 3]


def test_sort_user_matches_keeps_repeated_maps_and_stable_position_ties():
    matches = [_match(12, 31, 3), _match(11, 31, 2), _match(10, 31, 2)]
    assert [m.id for m in sort_user_matches(matches)] == [10, 11, 12]


def test_sort_user_matches_accepts_no_observed_games():
    assert sort_user_matches([]) == []


def test_match_mapper_uses_historical_game_context():
    context = SimpleNamespace(
        match=SimpleNamespace(id=17, duration_s=600, map_entity_id=31),
        game=SimpleNamespace(encounter_id=9, position=2),
        encounter=SimpleNamespace(id=9),
        job=None,
        home_team=SimpleNamespace(id=2155),
        away_team=SimpleNamespace(id=2152),
        home_score=3,
        away_score=0,
        display_filename="observed-match.txt",
        map=None,
    )
    result = to_match_with_user_stats(context, performance=None, heroes=None)
    assert (result.home_team_id, result.away_team_id) == (2155, 2152)
    assert (result.score.home, result.score.away) == (3, 0)
    assert (result.encounter_id, result.map_index, result.time) == (9, 2, 600)
    assert result.log_name == "observed-match.txt"
    assert "code" not in result.model_dump()
