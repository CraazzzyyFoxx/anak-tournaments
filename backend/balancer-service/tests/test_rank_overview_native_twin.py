"""The native layer reads OverFast snapshots only for a Battle.net game; any other game reads its module's twin."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from shared.core.social import SocialProvider
from shared.division_grid import DivisionGrid
from src.domain.mix_ranker import RankerSettings
from src.services import rank_overview
from src.services.rank_overview import RankOverviewFilters

CTE_COLUMNS = ("user_id", "handle", "platform", "role", "rank_value", "division", "tier", "captured_at", "snapshot_id")


def _branches(monkeypatch, spec, layers=("native",)):
    monkeypatch.setattr(rank_overview, "discipline_spec", lambda code: spec)
    monkeypatch.setattr(rank_overview, "rated_role_codes", lambda code: ("mid",))
    members = sa.select(
        sa.literal(1).label("member_id"),
        sa.literal(7).label("player_id"),
        sa.literal("n").label("display_name"),
        sa.literal("h").label("handle"),
    ).cte("m")
    return rank_overview._branches(
        1,
        "lol",
        5,
        RankOverviewFilters(layers=layers),
        members,
        DivisionGrid(version_id=None, tiers=()),
        RankerSettings(),
    )


def test_a_riot_game_reads_its_modules_twin_on_the_native_layer(monkeypatch) -> None:
    calls: list[str] = []

    def twin(members, game):
        calls.append(game)
        return sa.select(*(sa.literal(None).label(name) for name in CTE_COLUMNS)).cte(f"twin_{game}")

    spec = type(
        "Spec",
        (),
        {"native_ranks": object(), "native_rank_rows": staticmethod(twin), "identity_provider": SocialProvider.RIOT},
    )()
    branches = _branches(monkeypatch, spec)
    assert calls == ["lol"] and len(branches) == 1
    columns = [column.name for column in branches[0].selected_columns]
    assert "native_division" in columns and "native_tier" in columns and "ow_division" not in columns


def test_a_battlenet_game_keeps_the_overfast_twin(monkeypatch) -> None:
    spec = type(
        "Spec", (), {"native_ranks": object(), "native_rank_rows": None, "identity_provider": SocialProvider.BATTLENET}
    )()
    branches = _branches(monkeypatch, spec)
    assert "rank_ow_latest_lol" in str(branches[0].compile(dialect=postgresql.dialect()))
