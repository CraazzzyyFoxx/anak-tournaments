from __future__ import annotations

import importlib
import os
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
registration_schemas = importlib.import_module("src.schemas.registration")


class RegistrationRouteTests(IsolatedAsyncioTestCase):
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
