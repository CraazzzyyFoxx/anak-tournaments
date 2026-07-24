from __future__ import annotations

import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

models = importlib.import_module("src.models")
schemas = importlib.import_module("src.schemas")
division_service = importlib.import_module("src.services.division_grid.service")


def _write_tier(tier_id, slug, rank_min, rank_max, *, name=None, number=1, sort_order=0,
                icon_url="/i.png", ow_min=None, ow_max=None):
    return schemas.DivisionGridTierWrite(
        id=tier_id,
        slug=slug,
        number=number,
        name=name or slug,
        sort_order=sort_order,
        rank_min=rank_min,
        rank_max=rank_max,
        icon_url=icon_url,
        ow_rank_min=ow_min,
        ow_rank_max=ow_max,
    )


def _active_tier(tier_id, slug, rank_min, rank_max, *, name=None, number=1, sort_order=0):
    return SimpleNamespace(
        id=tier_id, slug=slug, name=name or slug, number=number, sort_order=sort_order,
        rank_min=rank_min, rank_max=rank_max, icon_url="/i.png", ow_rank_min=None, ow_rank_max=None,
    )


# ── classification ────────────────────────────────────────────────────────────

def test_classify_cosmetic_when_only_labels_change() -> None:
    active = [_active_tier(1, "bronze", 1000, 1099, name="Bronze")]
    payload = [_write_tier(1, "bronze", 1000, 1099, name="Bronze Renamed")]
    assert division_service._classify_tier_change(active, payload) == "cosmetic"


def test_classify_structural_when_rank_changes() -> None:
    active = [_active_tier(1, "bronze", 1000, 1099)]
    payload = [_write_tier(1, "bronze", 1000, 1150)]
    assert division_service._classify_tier_change(active, payload) == "structural"


def test_classify_structural_when_tier_added() -> None:
    active = [_active_tier(1, "bronze", 1000, 1099)]
    payload = [_write_tier(1, "bronze", 1000, 1099), _write_tier(None, "silver", 1100, 1199)]
    assert division_service._classify_tier_change(active, payload) == "structural"


def test_classify_structural_when_tier_removed() -> None:
    active = [_active_tier(1, "bronze", 1000, 1099), _active_tier(2, "silver", 1100, 1199)]
    payload = [_write_tier(1, "bronze", 1000, 1099)]
    assert division_service._classify_tier_change(active, payload) == "structural"


def test_classify_cosmetic_ignores_slug_and_order_changes() -> None:
    active = [_active_tier(1, "bronze", 1000, 1099, sort_order=0)]
    payload = [_write_tier(1, "bronze-renamed", 1000, 1099, sort_order=3)]
    assert division_service._classify_tier_change(active, payload) == "cosmetic"

# ── save orchestration ────────────────────────────────────────────────────────

def _grid_with_active():
    active = SimpleNamespace(
        id=100, version=1, label="v1", status="published",
        tiers=[_active_tier(1, "bronze", 1000, 1099)],
    )
    grid = SimpleNamespace(id=1, name="Ladder", versions=[active])
    return grid, active


def _readiness(is_ready):
    return schemas.DivisionGridActivationReadiness(
        target_version_id=200, is_ready=is_ready,
        used_source_version_ids=[100, 200],
        missing_mapping_version_ids=[] if is_ready else [100],
    )


def test_save_cosmetic_updates_in_place_without_new_version() -> None:
    async def run():
        grid, active = _grid_with_active()
        workspace = SimpleNamespace(id=4, default_division_grid_version_id=100)
        session = SimpleNamespace(flush=AsyncMock())
        data = schemas.DivisionGridSaveRequest(
            name="Ladder", tiers=[_write_tier(1, "bronze", 1000, 1099, name="Bronze!")]
        )
        with (
            patch.object(division_service, "_resolve_workspace_grid", AsyncMock(return_value=grid)),
            patch.object(division_service, "_apply_cosmetic", AsyncMock()) as apply_cosmetic,
            patch.object(division_service, "create_version", AsyncMock()) as create_version,
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
            patch.object(division_service, "get_activation_readiness", AsyncMock(return_value=_readiness(True))),
        ):
            outcome = await division_service.save_workspace_grid(session, workspace=workspace, data=data)
        assert outcome.mode == "in_place"
        assert outcome.saved_version_id == 100
        apply_cosmetic.assert_awaited_once()
        create_version.assert_not_called()

    asyncio.run(run())


def test_save_structural_clean_creates_version_and_activates() -> None:
    async def run():
        grid, active = _grid_with_active()
        new_version = SimpleNamespace(id=200, version=2, label="v2", tiers=[_active_tier(11, "bronze", 1000, 1099)])
        source_version = SimpleNamespace(id=100, label="v1", tiers=active.tiers)
        workspace = SimpleNamespace(id=4, default_division_grid_version_id=100)
        session = SimpleNamespace(flush=AsyncMock())
        gen = SimpleNamespace(rules=[], conflicts=[], is_complete=True)
        data = schemas.DivisionGridSaveRequest(
            tiers=[_write_tier(1, "bronze", 1000, 1099), _write_tier(None, "silver", 1100, 1199)]
        )
        with (
            patch.object(division_service, "_resolve_workspace_grid", AsyncMock(return_value=grid)),
            patch.object(division_service, "create_version", AsyncMock(return_value=new_version)),
            patch.object(division_service, "publish_version", AsyncMock()),
            patch.object(division_service, "get_workspace_source_version_ids", AsyncMock(return_value={100})),
            patch.object(division_service, "get_version", AsyncMock(return_value=source_version)),
            patch.object(division_service.automap, "generate_mapping_rules", Mock(return_value=gen)),
            patch.object(division_service, "_persist_mapping", AsyncMock()) as persist,
            patch.object(division_service, "get_activation_readiness", AsyncMock(return_value=_readiness(True))),
            patch.object(division_service, "activate_version", AsyncMock()) as activate,
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
        ):
            outcome = await division_service.save_workspace_grid(session, workspace=workspace, data=data)
        assert outcome.mode == "new_version_activated"
        assert outcome.saved_version_id == 200
        activate.assert_awaited_once()
        persist.assert_awaited()

    asyncio.run(run())


def test_save_structural_with_conflicts_stays_pending() -> None:
    async def run():
        grid, active = _grid_with_active()
        new_version = SimpleNamespace(id=200, version=2, label="v2", tiers=[_active_tier(11, "bronze", 1000, 1099)])
        source_version = SimpleNamespace(id=100, label="v1", tiers=active.tiers)
        workspace = SimpleNamespace(id=4, default_division_grid_version_id=100)
        session = SimpleNamespace(flush=AsyncMock())
        gen = SimpleNamespace(rules=[], conflicts=[SimpleNamespace(source_tier_id=1)], is_complete=False)
        data = schemas.DivisionGridSaveRequest(
            tiers=[_write_tier(None, "silver", 5000, 5099)]
        )
        with (
            patch.object(division_service, "_resolve_workspace_grid", AsyncMock(return_value=grid)),
            patch.object(division_service, "create_version", AsyncMock(return_value=new_version)),
            patch.object(division_service, "publish_version", AsyncMock()),
            patch.object(division_service, "get_workspace_source_version_ids", AsyncMock(return_value={100})),
            patch.object(division_service, "get_version", AsyncMock(return_value=source_version)),
            patch.object(division_service.automap, "generate_mapping_rules", Mock(return_value=gen)),
            patch.object(division_service, "_persist_mapping", AsyncMock()),
            patch.object(division_service, "get_activation_readiness", AsyncMock(return_value=_readiness(False))),
            patch.object(division_service, "activate_version", AsyncMock()) as activate,
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
        ):
            outcome = await division_service.save_workspace_grid(session, workspace=workspace, data=data)
        assert outcome.mode == "new_version_pending"
        activate.assert_not_called()

    asyncio.run(run())

# ── delete_grid ───────────────────────────────────────────────────────────────

def _grid_for_delete(workspace_id=4, version_ids=(100,)):
    versions = [SimpleNamespace(id=vid) for vid in version_ids]
    return SimpleNamespace(id=7, workspace_id=workspace_id, versions=versions)


def test_delete_grid_removes_unused_grid() -> None:
    async def run():
        grid = _grid_for_delete()
        session = SimpleNamespace(
            delete=AsyncMock(),
            flush=AsyncMock(),
            scalar=AsyncMock(side_effect=[999, 0]),  # default version id (not in grid), tournament count
        )
        with (
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
            patch.object(division_service.division_grid_cache, "invalidate_grid_version", AsyncMock()),
        ):
            await division_service.delete_grid(session, 7)
        session.delete.assert_awaited_once_with(grid)

    asyncio.run(run())


def test_delete_grid_rejects_workspace_default() -> None:
    async def run():
        grid = _grid_for_delete(version_ids=(100, 101))
        session = SimpleNamespace(
            delete=AsyncMock(),
            flush=AsyncMock(),
            scalar=AsyncMock(side_effect=[100]),  # default points at a version in this grid
        )
        with (
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
            patch.object(division_service.division_grid_cache, "invalidate_grid_version", AsyncMock()),
            pytest.raises(Exception) as caught,
        ):
            await division_service.delete_grid(session, 7)
        assert getattr(caught.value, "status_code", None) == 409
        session.delete.assert_not_called()

    asyncio.run(run())


def test_delete_grid_rejects_when_used_by_tournaments() -> None:
    async def run():
        grid = _grid_for_delete()
        session = SimpleNamespace(
            delete=AsyncMock(),
            flush=AsyncMock(),
            scalar=AsyncMock(side_effect=[None, 3]),  # no default, 3 tournaments use it
        )
        with (
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
            patch.object(division_service.division_grid_cache, "invalidate_grid_version", AsyncMock()),
            pytest.raises(Exception) as caught,
        ):
            await division_service.delete_grid(session, 7)
        assert getattr(caught.value, "status_code", None) == 409
        session.delete.assert_not_called()

    asyncio.run(run())


def test_delete_grid_rejects_system_grid() -> None:
    async def run():
        grid = _grid_for_delete(workspace_id=None)
        session = SimpleNamespace(delete=AsyncMock(), flush=AsyncMock(), scalar=AsyncMock())
        with (
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
            pytest.raises(Exception) as caught,
        ):
            await division_service.delete_grid(session, 7)
        assert getattr(caught.value, "status_code", None) == 409
        session.delete.assert_not_called()

    asyncio.run(run())

def test_delete_grid_force_bypasses_guards_and_clears_default() -> None:
    async def run():
        grid = _grid_for_delete(version_ids=(100, 101))
        session = SimpleNamespace(
            delete=AsyncMock(),
            flush=AsyncMock(),
            execute=AsyncMock(),
            scalar=AsyncMock(),
        )
        with (
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
            patch.object(division_service.division_grid_cache, "invalidate_grid_version", AsyncMock()),
            patch.object(division_service.division_grid_cache, "invalidate_workspace", AsyncMock()),
        ):
            await division_service.delete_grid(session, 7, force=True)
        session.delete.assert_awaited_once_with(grid)
        session.execute.assert_awaited()  # workspace default cleared
        session.scalar.assert_not_called()  # guards skipped

    asyncio.run(run())


def test_delete_grid_force_still_rejects_system_grid() -> None:
    async def run():
        grid = _grid_for_delete(workspace_id=None)
        session = SimpleNamespace(delete=AsyncMock(), flush=AsyncMock(), execute=AsyncMock())
        with (
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
            pytest.raises(Exception) as caught,
        ):
            await division_service.delete_grid(session, 7, force=True)
        assert getattr(caught.value, "status_code", None) == 409
        session.delete.assert_not_called()

    asyncio.run(run())

def test_save_uses_explicit_grid_id_over_workspace_resolution() -> None:
    async def run():
        active = SimpleNamespace(
            id=100, version=1, label="v1", status="published",
            tiers=[_active_tier(1, "bronze", 1000, 1099)],
        )
        grid = SimpleNamespace(id=7, name="Imported", workspace_id=4, versions=[active])
        workspace = SimpleNamespace(id=4, default_division_grid_version_id=100)
        session = SimpleNamespace(flush=AsyncMock())
        data = schemas.DivisionGridSaveRequest(
            grid_id=7, name="Imported", tiers=[_write_tier(1, "bronze", 1000, 1099, name="B!")]
        )
        with (
            patch.object(division_service, "get_grid_by_id", AsyncMock(return_value=grid)),
            patch.object(division_service, "_resolve_workspace_grid", AsyncMock()) as resolve,
            patch.object(division_service, "_apply_cosmetic", AsyncMock()),
            patch.object(division_service, "get_activation_readiness", AsyncMock(return_value=_readiness(True))),
        ):
            outcome = await division_service.save_workspace_grid(session, workspace=workspace, data=data)
        resolve.assert_not_called()
        assert outcome.mode == "in_place"
        assert outcome.saved_version_id == 100

    asyncio.run(run())
