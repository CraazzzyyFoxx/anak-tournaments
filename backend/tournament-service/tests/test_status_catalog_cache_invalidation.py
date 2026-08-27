"""Every status-catalog write must invalidate the cached status-metas map.

get_status_metas_map (shared.balancer_registration_statuses) is now cached per
workspace (see that module's docstring) -- so a write here that forgets to
invalidate would serve a stale status name/icon/color for up to the cache TTL
after an organizer edits it. One test per write path pins the call.

Runs under stdlib unittest -- no pytest-asyncio in this repo.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch


backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

status_catalog = importlib.import_module("src.services.registration.status_catalog")


def _fake_status_row(scope: str = "registration") -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        workspace_id=5,
        scope=scope,
        slug="checked_in",
        kind="custom",
        icon_slug=None,
        icon_color=None,
        name="Checked in",
        description=None,
    )


def test_create_custom_status_invalidates_the_workspace_cache() -> None:
    async def run() -> None:
        session = SimpleNamespace(add=Mock(), flush=AsyncMock(), commit=AsyncMock(), refresh=AsyncMock())
        with (
            patch.object(status_catalog.status_catalog_service, "ensure_workspace_exists", AsyncMock()),
            patch.object(status_catalog.status_catalog_service, "_ensure_custom_slug_available", AsyncMock()),
            patch.object(status_catalog, "invalidate_status_metas_cache", AsyncMock()) as invalidate,
        ):
            await status_catalog.status_catalog_service.create_custom_status(
                session,
                workspace_id=5,
                scope="registration",
                icon_slug=None,
                icon_color=None,
                name="Checked in",
                description=None,
            )
        invalidate.assert_awaited_once_with(5)
        session.commit.assert_awaited_once()

    asyncio.run(run())


def test_update_custom_status_invalidates_the_workspace_cache() -> None:
    async def run() -> None:
        session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())
        with (
            patch.object(status_catalog.status_catalog_service, "get_custom_status_by_id", AsyncMock(return_value=_fake_status_row())),
            patch.object(status_catalog, "invalidate_status_metas_cache", AsyncMock()) as invalidate,
        ):
            await status_catalog.status_catalog_service.update_custom_status(
                session,
                workspace_id=5,
                status_id=1,
                icon_slug=None,
                icon_color=None,
                name="Renamed",
                description=None,
            )
        invalidate.assert_awaited_once_with(5)
        session.commit.assert_awaited_once()

    asyncio.run(run())


def test_delete_custom_status_invalidates_the_workspace_cache() -> None:
    async def run() -> None:
        session = SimpleNamespace(
            scalar=AsyncMock(return_value=0), delete=AsyncMock(), flush=AsyncMock(), commit=AsyncMock()
        )
        with (
            patch.object(status_catalog.status_catalog_service, "get_custom_status_by_id", AsyncMock(return_value=_fake_status_row())),
            patch.object(status_catalog, "invalidate_status_metas_cache", AsyncMock()) as invalidate,
        ):
            await status_catalog.status_catalog_service.delete_custom_status(session, workspace_id=5, status_id=1)
        invalidate.assert_awaited_once_with(5)
        session.commit.assert_awaited_once()

    asyncio.run(run())


def test_delete_custom_status_in_use_never_invalidates() -> None:
    """A refused delete must not paper over a real 409 with a cache clear."""

    async def run() -> None:
        session = SimpleNamespace(scalar=AsyncMock(return_value=3), delete=AsyncMock(), commit=AsyncMock())
        with (
            patch.object(status_catalog.status_catalog_service, "get_custom_status_by_id", AsyncMock(return_value=_fake_status_row())),
            patch.object(status_catalog, "invalidate_status_metas_cache", AsyncMock()) as invalidate,
        ):
            try:
                await status_catalog.status_catalog_service.delete_custom_status(session, workspace_id=5, status_id=1)
            except Exception as exc:  # noqa: BLE001 - asserting the specific refusal below
                assert getattr(exc, "status_code", None) == 409
            else:
                raise AssertionError("expected the in-use conflict to raise")
        invalidate.assert_not_awaited()
        session.commit.assert_not_awaited()

    asyncio.run(run())


def test_upsert_builtin_override_invalidates_the_workspace_cache() -> None:
    async def run() -> None:
        existing = _fake_status_row()
        existing.kind = "builtin"
        execute_result = Mock(scalar_one_or_none=Mock(return_value=existing))
        session = SimpleNamespace(
            execute=AsyncMock(return_value=execute_result), commit=AsyncMock(), refresh=AsyncMock()
        )
        with (
            patch.object(status_catalog.status_catalog_service, "ensure_workspace_exists", AsyncMock()),
            patch.object(status_catalog.status_catalog_service, "get_builtin_canonical_status", AsyncMock(return_value=existing)),
            patch.object(status_catalog, "invalidate_status_metas_cache", AsyncMock()) as invalidate,
        ):
            await status_catalog.status_catalog_service.upsert_builtin_override(
                session,
                workspace_id=5,
                scope="registration",
                slug="pending",
                icon_slug=None,
                icon_color=None,
                name="Custom label",
                description=None,
            )
        invalidate.assert_awaited_once_with(5)
        session.commit.assert_awaited_once()

    asyncio.run(run())


def test_reset_builtin_override_invalidates_the_workspace_cache() -> None:
    async def run() -> None:
        existing = _fake_status_row()
        existing.kind = "builtin"
        execute_result = Mock(scalar_one_or_none=Mock(return_value=existing))
        session = SimpleNamespace(
            execute=AsyncMock(return_value=execute_result),
            delete=AsyncMock(),
            flush=AsyncMock(),
            commit=AsyncMock(),
        )
        with patch.object(status_catalog, "invalidate_status_metas_cache", AsyncMock()) as invalidate:
            await status_catalog.status_catalog_service.reset_builtin_override(session, workspace_id=5, scope="registration", slug="pending")
        invalidate.assert_awaited_once_with(5)
        session.commit.assert_awaited_once()

    asyncio.run(run())


def test_reset_builtin_override_no_row_never_invalidates() -> None:
    """Nothing to reset -- no write happened, so no cache clear either."""

    async def run() -> None:
        execute_result = Mock(scalar_one_or_none=Mock(return_value=None))
        session = SimpleNamespace(
            execute=AsyncMock(return_value=execute_result), delete=AsyncMock(), commit=AsyncMock()
        )
        with patch.object(status_catalog, "invalidate_status_metas_cache", AsyncMock()) as invalidate:
            await status_catalog.status_catalog_service.reset_builtin_override(session, workspace_id=5, scope="registration", slug="pending")
        invalidate.assert_not_awaited()
        session.commit.assert_not_awaited()

    asyncio.run(run())
