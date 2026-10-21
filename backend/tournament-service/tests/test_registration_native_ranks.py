"""OverFast ranks reach a registration only in a discipline whose module declares a native layer (D87; scan F4)."""

from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))


rank_sources = importlib.import_module("src.services.registration.rank_sources")
rank_autofill = importlib.import_module("src.services.registration.rank_autofill")

from shared.division_grid import DEFAULT_GRID  # noqa: E402

_FETCH = "shared.services.rank_snapshots.fetch_latest_ow_ranks_by_account"


def _dual_identity_registration() -> SimpleNamespace:
    """A registrant who linked both a BattleTag and a Riot ID."""
    handles = {"battlenet": ["Main#1234"], "riot": ["Faker#KR1"]}
    return SimpleNamespace(
        id=42,
        workspace_member=SimpleNamespace(player_id=7),
        handles=lambda provider: handles.get(provider, []),
    )


def _ranks(discipline_code: str, fetch: AsyncMock) -> dict[int, dict[str, int]]:
    with patch(_FETCH, new=fetch):
        return asyncio.run(
            rank_sources.native_ranks_by_registration(
                None, [_dual_identity_registration()], discipline_code=discipline_code, grid=DEFAULT_GRID
            )
        )


def test_a_lol_registration_never_reads_overfast_ranks() -> None:
    fetch = AsyncMock(return_value={7: {"Main#1234": {"support": 3550}}})
    assert _ranks("lol", fetch) == {}
    fetch.assert_not_awaited()


def test_an_overwatch_registration_reads_its_main_accounts_on_the_grid() -> None:
    fetch = AsyncMock(return_value={7: {"Main#1234": {"support": 3550}}})
    # DEFAULT_GRID carries no native ranges, so 3550 lands by containment on Master 5 (3500..3599).
    assert _ranks("overwatch", fetch) == {42: {"support": 3500}}
    assert fetch.await_args.args[1] == [7]


def test_autofill_drops_the_ow_stage_for_a_game_without_a_native_layer() -> None:
    sources = {"ow", "division_history", "analytics"}
    assert rank_autofill.autofill_sources(sources, "lol") == {"division_history", "analytics"}
    assert rank_autofill.autofill_sources(sources, "overwatch") == sources
    assert rank_autofill.autofill_sources(sources, None) == {"division_history", "analytics"}
