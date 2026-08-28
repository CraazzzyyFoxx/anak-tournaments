"""Coverage for the ``rpc.parser.discord_channel.backfill`` handler.

Manual channel-history backfill: an admin who just connected an existing
Discord channel (migration case — the channel already has match logs
posted before the platform was wired up) triggers a rescan of its recent
history via the same ``process_all`` bot command the startup rescan uses.
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"

rpc_misc = importlib.import_module("src.rpc.misc")

from tests._fakes import (
    FakeBroker as _FakeBroker,
    active_identity as _active_identity,
    session_factory as _session_factory,
)


class DiscordChannelBackfillRpcTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.broker = _FakeBroker()
        rpc_misc.register(self.broker, logging.getLogger("test"))
        self._original_sf = rpc_misc._SF

    def tearDown(self) -> None:
        rpc_misc._SF = self._original_sf

    async def test_backfill_publishes_process_all_command(self) -> None:
        session = SimpleNamespace()
        rpc_misc._SF = _session_factory(session)
        channel = SimpleNamespace(id=1, tournament_id=42, channel_id=987, channel_name="logs", is_active=True)

        with (
            patch.object(rpc_misc.auth, "_get_tournament_workspace_id", AsyncMock(return_value=5)),
            patch.object(rpc_misc, "ensure_workspace_permission"),
            patch.object(rpc_misc.discord_channel_service, "get", AsyncMock(return_value=channel)),
            patch.object(rpc_misc, "publish_message", AsyncMock()) as publish_mock,
        ):
            envelope = await self.broker.handlers["rpc.parser.discord_channel.backfill"](
                {"identity": _active_identity(), "id": 42}, msg=None
            )

        self.assertTrue(envelope["ok"], envelope)
        publish_mock.assert_awaited_once()
        args = publish_mock.await_args
        published_event, queue = args.args[1], args.args[2]
        self.assertEqual("process_all", published_event["action"])
        self.assertEqual(42, published_event["tournament_id"])
        self.assertIs(rpc_misc.DISCORD_COMMANDS_QUEUE, queue)

    async def test_backfill_without_configured_channel_returns_not_found(self) -> None:
        session = SimpleNamespace()
        rpc_misc._SF = _session_factory(session)

        with (
            patch.object(rpc_misc.auth, "_get_tournament_workspace_id", AsyncMock(return_value=5)),
            patch.object(rpc_misc, "ensure_workspace_permission"),
            patch.object(rpc_misc.discord_channel_service, "get", AsyncMock(return_value=None)),
            patch.object(rpc_misc, "publish_message", AsyncMock()) as publish_mock,
        ):
            envelope = await self.broker.handlers["rpc.parser.discord_channel.backfill"](
                {"identity": _active_identity(), "id": 42}, msg=None
            )

        self.assertFalse(envelope["ok"], envelope)
        self.assertEqual("not_found", envelope["error"]["code"])
        publish_mock.assert_not_awaited()
