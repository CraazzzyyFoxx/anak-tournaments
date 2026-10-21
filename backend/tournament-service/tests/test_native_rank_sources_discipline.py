"""A game whose identity provider is not Battle.net reads its module's native layer (spec §6, §9)."""

import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))
os.environ["DEBUG"] = "true"

rank_sources = importlib.import_module("src.services.registration.rank_sources")
rank_autofill = importlib.import_module("src.services.registration.rank_autofill")
grid_service = importlib.import_module("src.services.division_grid.service")

from shared.core.social import SocialProvider  # noqa: E402
from shared.disciplines.spec import NativeTier  # noqa: E402
from shared.division_grid import DivisionGrid, DivisionTier  # noqa: E402

POSITIONS = ("top", "jungle", "mid", "bot", "support")
GRID = DivisionGrid(
    version_id=None,
    tiers=(
        DivisionTier(id=None, slug="diamond-1", number=4, name="Diamond I", rank_min=2700, rank_max=2799, icon_url=""),
    ),
)


def _spec(by_user: dict[int, dict[str, int]]) -> SimpleNamespace:
    async def native(session, user_ids):
        return {user: by_user[user] for user in user_ids if user in by_user}

    return SimpleNamespace(native_ranks=native, identity_provider=SocialProvider.RIOT)


def test_a_riot_game_registration_reads_its_modules_native_layer(monkeypatch) -> None:
    monkeypatch.setattr(rank_sources, "discipline", lambda code: _spec({7: dict.fromkeys(POSITIONS, 2775)}))
    registrations = [
        SimpleNamespace(id=1, workspace_member=SimpleNamespace(player_id=7)),
        SimpleNamespace(id=2, workspace_member=None),
    ]
    out = asyncio.run(rank_sources.native_ranks_by_registration(None, registrations, discipline_code="lol", grid=GRID))
    assert out == {1: dict.fromkeys(POSITIONS, 2700)}


def test_the_native_stage_stays_offered_to_a_game_with_a_native_layer() -> None:
    assert rank_autofill.autofill_sources({"ow", "division_history"}, "lol") == {"ow", "division_history"}


def test_a_module_native_rank_fills_the_ow_stage_whatever_number_it_asks_for(monkeypatch) -> None:
    monkeypatch.setattr(rank_sources, "discipline", lambda code: _spec({7: {"mid": 2775}}))
    signals = asyncio.run(
        rank_sources.RankSourcesService()._load_native_rank_signals_by_user_id(None, "lol", [7, 8, 7])
    )
    assert set(signals) == {7}
    for value in ("composite", "current", "peak"):
        data = rank_sources._build_priority_rank_data(("ow",), signals[7]["mid"], None, None, GRID, value)
        assert (data.rank_value, data.used_source) == (2700, "ow")


def test_a_ladder_icon_key_is_seeded_as_its_public_url(monkeypatch) -> None:
    tier = NativeTier(1, "x-1", "X 1", 100, None, "assets/x/rank/x-1.png", "x", 1)
    monkeypatch.setattr(grid_service, "discipline", lambda code: SimpleNamespace(native_ladder=(tier,)))
    monkeypatch.setattr(grid_service.config.settings, "s3_public_url", "https://cdn.example", raising=False)
    assert grid_service.ladder_tiers_write("x")[0].icon_url == "https://cdn.example/assets/x/rank/x-1.png"
