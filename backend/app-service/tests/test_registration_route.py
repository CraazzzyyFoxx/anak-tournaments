from __future__ import annotations

import importlib
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")

registration_route = importlib.import_module("src.routes.registration")
registration_service = importlib.import_module("src.services.registration.service")
division_grid_schemas = importlib.import_module("src.schemas.division_grid")
registration_schemas = importlib.import_module("src.schemas.registration")


class RegistrationRouteTests(IsolatedAsyncioTestCase):
    async def test_tournament_history_returns_source_tournament_grid(self) -> None:
        source_grid = division_grid_schemas.DivisionGridVersionRead(
            id=77,
            grid_id=12,
            version=1,
            label="Source tournament grid",
            status="published",
            created_from_version_id=None,
            published_at=None,
            tiers=[
                division_grid_schemas.DivisionGridTierRead(
                    id=701,
                    version_id=77,
                    slug="source-high",
                    number=1,
                    name="Source High",
                    sort_order=1,
                    rank_min=200,
                    rank_max=None,
                    icon_url="/source-high.png",
                ),
                division_grid_schemas.DivisionGridTierRead(
                    id=702,
                    version_id=77,
                    slug="source-low",
                    number=9,
                    name="Source Low",
                    sort_order=2,
                    rank_min=0,
                    rank_max=199,
                    icon_url="/source-low.png",
                ),
            ],
        )
        session = SimpleNamespace(
            execute=AsyncMock(
                return_value=[
                    (
                        SimpleNamespace(
                            tournament_id=42,
                            user_id=10,
                            role=SimpleNamespace(value="tank"),
                            rank=150,
                        ),
                        "Source Cup",
                    )
                ]
            )
        )
        registration = SimpleNamespace(id=5, user_id=10, auth_user_id=None)

        with (
            patch.object(
                registration_route,
                "get_division_grid_version",
                AsyncMock(return_value=source_grid),
            ),
        ):
            history_map = await registration_route._build_tournament_history(
                session,
                [registration],
                current_tournament_id=99,
                workspace_id=3,
            )

        entry = history_map[registration.id][0]
        self.assertEqual(9, entry.division)
        self.assertEqual(77, entry.division_grid_version.id)
        self.assertEqual("/source-low.png", entry.division_grid_version.tiers[1].icon_url)

    async def test_register_rejects_new_submission_for_withdrawn_registration(self) -> None:
        session = SimpleNamespace()
        user = SimpleNamespace(id=42)
        form = SimpleNamespace(is_open=True, workspace_id=7, auto_approve=False)
        withdrawn_registration = SimpleNamespace(status="withdrawn")

        with (
            patch.object(
                registration_route.reg_service,
                "get_registration_form",
                AsyncMock(return_value=form),
            ),
            patch.object(registration_route, "validate_registration_input"),
            patch.object(
                registration_route.reg_service,
                "get_registration",
                AsyncMock(return_value=withdrawn_registration),
            ),
            patch.object(
                registration_route.reg_service,
                "create_registration",
                AsyncMock(),
            ) as create_registration_mock,
        ):
            with self.assertRaises(HTTPException) as exc_info:
                await registration_route.register(
                    workspace_id=7,
                    tournament_id=99,
                    data=registration_schemas.RegistrationCreate(),
                    session=session,
                    user=user,
                )

        self.assertEqual(409, exc_info.exception.status_code)
        self.assertEqual(
            "Withdrawn registrations cannot be submitted again",
            exc_info.exception.detail,
        )
        create_registration_mock.assert_not_awaited()

    async def test_check_in_registration_rejects_inactive_window(self) -> None:
        now = datetime.now(UTC)
        session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())
        registration = SimpleNamespace(
            status="approved",
            tournament=SimpleNamespace(
                status="check_in",
                check_in_opens_at=now + timedelta(minutes=5),
                check_in_closes_at=now + timedelta(minutes=10),
            ),
        )

        with self.assertRaises(HTTPException) as exc_info:
            await registration_service.check_in_registration(
                session,
                registration,
                checked_in_by=42,
            )

        self.assertEqual(409, exc_info.exception.status_code)
        self.assertEqual("Check-in is not active for this tournament", exc_info.exception.detail)
        session.commit.assert_not_awaited()

    async def test_check_in_registration_sets_fields_when_window_active(self) -> None:
        now = datetime.now(UTC)
        session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())
        registration = SimpleNamespace(
            status="approved",
            checked_in=False,
            checked_in_at=None,
            checked_in_by=None,
            tournament=SimpleNamespace(
                status="check_in",
                check_in_opens_at=now - timedelta(minutes=5),
                check_in_closes_at=now + timedelta(minutes=5),
            ),
        )

        result = await registration_service.check_in_registration(
            session,
            registration,
            checked_in_by=42,
        )

        self.assertTrue(result.checked_in)
        self.assertIsNotNone(result.checked_in_at)
        self.assertEqual(42, result.checked_in_by)
        session.commit.assert_awaited_once()
        session.refresh.assert_awaited_once_with(registration)
