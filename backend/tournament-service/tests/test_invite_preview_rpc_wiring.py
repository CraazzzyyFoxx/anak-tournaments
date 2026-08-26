"""Pins the request-shape contract ``regteam_invite_preview`` must honor.

The gateway always nests a POST body under ``data["payload"]`` -- see
``RouteSpec.Body`` in the Go gateway and ``public_rpc``'s own module
docstring ("the JSON body as ``data["payload"]``") -- never flattens it onto
top-level ``data`` keys. A real regression read ``data.get("token")``
directly, which is always ``None`` on a live request, so every preview
request hashed an empty string and 404'd with ``invite_not_found`` no matter
how correct the actual token was, for every invite, unconditionally.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"

public_rpc = importlib.import_module("src.rpc.public_rpc")
helpers = importlib.import_module("src.rpc._helpers")


class _CapturingBroker:
    """Records the handler behind each subject instead of binding a queue."""

    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def subscriber(self, subject, *args, **kwargs):
        def register(fn):
            self.handlers[subject] = fn
            return fn

        return register


class _FakeSessionMaker:
    """Stands in for ``db.async_session_maker`` -- the service call itself is
    stubbed, so the session only has to exist."""

    def __call__(self):
        return self

    async def __aenter__(self):
        return SimpleNamespace()

    async def __aexit__(self, *exc):
        return False


class InvitePreviewRequestShapeTests(IsolatedAsyncioTestCase):
    async def _invoke(self, data: dict) -> AsyncMock:
        broker = _CapturingBroker()
        public_rpc.register(broker, SimpleNamespace(exception=lambda *a, **k: None))
        self.assertIn("rpc.tournament.regteam_invite_preview", broker.handlers)

        preview = AsyncMock(return_value=SimpleNamespace())
        with (
            patch.object(helpers.db, "async_session_maker", _FakeSessionMaker()),
            patch.object(public_rpc, "_dump", lambda obj: obj),
            patch.object(public_rpc.team_service.teams_service, "preview_invite", preview),
        ):
            await broker.handlers["rpc.tournament.regteam_invite_preview"](data, None)
        return preview

    async def test_the_token_is_read_from_the_json_payload_not_top_level_data(self) -> None:
        # Gateway-shaped request: the body rides under "payload", never
        # flattened onto `data` itself.
        preview = await self._invoke({"payload": {"token": "the-real-token"}})

        preview.assert_awaited_once()
        self.assertEqual("the-real-token", preview.await_args.kwargs["token"])

    async def test_a_token_placed_at_top_level_is_not_what_the_gateway_sends(self) -> None:
        """The exact shape of the regression: a token sitting at `data["token"]`
        (never what the gateway actually produces) must NOT be picked up --
        proving the handler no longer reads that key."""
        preview = await self._invoke({"token": "not-where-the-gateway-puts-it"})

        preview.assert_awaited_once()
        self.assertEqual("", preview.await_args.kwargs["token"])

    async def test_a_missing_payload_degrades_to_an_empty_token(self) -> None:
        """No body at all must not raise -- it degrades to the same empty
        token every malformed request hashes, which the service reports as
        `invite_not_found` rather than a 500."""
        preview = await self._invoke({})

        preview.assert_awaited_once()
        self.assertEqual("", preview.await_args.kwargs["token"])
