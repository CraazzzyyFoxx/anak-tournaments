"""Play-order helpers for user encounter / map-result assembly."""

from datetime import UTC, datetime
from types import SimpleNamespace

from src.services.user._mappers import encounter_play_key, settled_map_ids, sort_user_matches


def _match(id_: int, map_id: int, map_index: int | None = None):
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


def test_sort_user_matches_uses_map_index():
    matches = [_match(3, 15, None), _match(1, 31, 2), _match(2, 44, 1)]
    assert [m.id for m in sort_user_matches(matches)] == [2, 1, 3]


def test_sort_user_matches_restores_unindexed_from_pool():
    matches = [_match(10, 31, 1), _match(12, 40, None), _match(11, 44, None)]
    ordered = sort_user_matches(matches, [31, 44, 40])
    assert [m.map_id for m in ordered] == [31, 44, 40]


def test_settled_map_ids_ignores_bans_and_sorts_by_action_index():
    rows = [
        (26, "banned", 1, 0),
        (15, "played", 11, 1),
        (31, "played", 2, 1),
        (44, "picked", 5, 1),
    ]
    assert settled_map_ids(rows) == [31, 44, 15]
