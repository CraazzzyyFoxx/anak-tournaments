from datetime import UTC, datetime

from shared.domain.workspace_player import (
    ResolvedRank,
    RoleRank,
    merge_ranks,
    normalize_battle_tag,
    normalize_battle_tag_key,
    pick_rank,
)

T1 = datetime(2026, 1, 1, tzinfo=UTC)
T2 = datetime(2026, 2, 1, tzinfo=UTC)


def test_normalize_empty_is_none():
    assert normalize_battle_tag("") is None
    assert normalize_battle_tag(None) is None
    assert normalize_battle_tag_key("") is None
    assert normalize_battle_tag_key(None) is None


def test_normalize_spaces_is_none():
    assert normalize_battle_tag("   ") is None
    assert normalize_battle_tag_key(" \t ") is None


def test_normalize_collapses_spaces_around_hash():
    assert normalize_battle_tag("  Foo # 1234  ") == "Foo#1234"
    assert normalize_battle_tag_key("  Foo # 1234  ") == "foo#1234"


def test_merge_latest_updated_at_wins():
    survivor = RoleRank("tank", 1000, T1, id=1)
    donor = RoleRank("tank", 2500, T2, id=2)
    plan = merge_ranks([survivor], [donor])
    assert [row.id for row in plan.keep] == [2]
    assert plan.keep[0].rank_value == 2500
    assert plan.delete_ids == [1]
    assert [row.id for row in plan.move] == [2]


def test_merge_tie_keeps_survivor():
    survivor = RoleRank("tank", 1000, T1, id=1)
    donor = RoleRank("tank", 2500, T1, id=2)
    plan = merge_ranks([survivor], [donor])
    assert plan.keep[0] is survivor
    assert plan.delete_ids == [2]
    assert plan.move == []


def test_merge_none_updated_at_is_oldest():
    survivor = RoleRank("tank", 1000, None, id=1)
    donor = RoleRank("tank", 2500, T1, id=2)
    plan = merge_ranks([survivor], [donor])
    assert plan.keep[0] is donor
    assert plan.delete_ids == [1]


def test_merge_moves_role_survivor_lacks():
    survivor = RoleRank("tank", 1000, T1, id=1)
    donor = RoleRank("dps", 2500, T1, id=2)
    plan = merge_ranks([survivor], [donor])
    assert {row.role for row in plan.keep} == {"tank", "dps"}
    assert plan.delete_ids == []
    assert plan.move == [donor]


def test_pick_rank_override_wins():
    assert pick_rank(override=1, canon=2, ow=3) == ResolvedRank(1, "override")


def test_pick_rank_canon():
    assert pick_rank(override=None, canon=2, ow=3) == ResolvedRank(2, "canon")


def test_pick_rank_ow():
    assert pick_rank(override=None, canon=None, ow=3) == ResolvedRank(3, "ow")


def test_pick_rank_none():
    assert pick_rank(override=None, canon=None, ow=None) == ResolvedRank(None, "none")
