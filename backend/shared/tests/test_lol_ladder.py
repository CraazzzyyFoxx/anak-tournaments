"""League's native ladder: Iron IV = 0..99 up to Diamond I = 2700..2799, apex bands from 2800, Solo/Duo native rank."""

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from shared.disciplines import DISCIPLINES
from shared.disciplines.lol.ladder import NATIVE_LADDER, rank_value
from shared.disciplines.lol.ranks import best_per_user, latest_rank_rows, positions


@pytest.mark.parametrize(
    ("tier", "rank", "lp", "value"),
    [
        ("IRON", "IV", 0, 0),
        ("IRON", "IV", 150, 99),
        ("GOLD", "II", 50, 1450),
        ("DIAMOND", "I", 75, 2775),
        ("MASTER", "I", 0, 2800),
        ("GRANDMASTER", "I", 450, 3250),
        ("CHALLENGER", "I", 1200, 4000),
        ("GOLD", None, 10, None),
        ("UNRANKED", None, 0, None),
    ],
)
def test_league_points_land_on_the_ladder(tier: str, rank: str | None, lp: int, value: int | None) -> None:
    assert rank_value(tier, rank, lp) == value


def test_the_ladder_is_31_contiguous_tiers_top_first() -> None:
    assert len(NATIVE_LADDER) == 31
    top, bottom = NATIVE_LADDER[0], NATIVE_LADDER[-1]
    assert (top.number, top.slug, top.name, top.rank_min, top.rank_max, top.native_division, top.native_tier) == (
        1,
        "challenger",
        "Challenger",
        3500,
        None,
        "CHALLENGER",
        None,
    )
    assert (bottom.number, bottom.slug, bottom.name, bottom.rank_min, bottom.rank_max, bottom.native_tier) == (
        31,
        "iron-4",
        "Iron IV",
        0,
        99,
        4,
    )
    diamond_1 = next(tier for tier in NATIVE_LADDER if tier.slug == "diamond-1")
    assert (diamond_1.number, diamond_1.name, diamond_1.rank_min, diamond_1.rank_max) == (4, "Diamond I", 2700, 2799)
    assert (diamond_1.native_division, diamond_1.native_tier) == ("DIAMOND", 1)
    for upper, lower in zip(NATIVE_LADDER, NATIVE_LADDER[1:], strict=False):
        assert lower.rank_max + 1 == upper.rank_min
    assert top.icon_url == "/disciplines/lol/ranks/challenger.png"
    assert diamond_1.icon_url == "/disciplines/lol/ranks/diamond.png"


def test_a_player_reads_the_best_solo_account_on_every_position() -> None:
    assert positions() == ("top", "jungle", "mid", "bot", "support")
    assert best_per_user([(1, 1250), (1, 2775), (2, 0)]) == {
        1: dict.fromkeys(positions(), 2775),
        2: dict.fromkeys(positions(), 0),
    }


def test_lol_declares_a_native_layer_and_its_overview_twin() -> None:
    spec = DISCIPLINES["lol"]
    assert spec.native_ladder is NATIVE_LADDER
    assert spec.native_ranks is not None and spec.native_rank_rows is not None


def test_the_overview_twin_names_its_columns_and_reads_only_fresh_solo_rows() -> None:
    members = sa.select(sa.literal(1).label("player_id")).cte("members")
    cte = latest_rank_rows(members, "lol")
    assert [column.name for column in cte.c] == [
        "user_id",
        "handle",
        "platform",
        "role",
        "rank_value",
        "division",
        "tier",
        "captured_at",
        "snapshot_id",
    ]
    compiled = sa.select(cte).compile(dialect=postgresql.dialect())
    assert "rank_native_latest_lol" in str(compiled)
    assert {"solo", "lol", "riot"} <= set(compiled.params.values())
