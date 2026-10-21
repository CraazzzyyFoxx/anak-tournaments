"""``ChannelRegistry``: which channels are watched, and how far each was already read."""

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.services.channel_registry import ChannelRegistry  # noqa: E402
from tests.gateway_fakes import session_maker  # noqa: E402


def _registry(*rows: tuple[SimpleNamespace, SimpleNamespace]) -> tuple[ChannelRegistry, MagicMock, MagicMock]:
    channels = MagicMock(
        list_active_with_tournament=AsyncMock(return_value=list(rows)), set_last_scanned=AsyncMock(return_value=True)
    )
    maker = session_maker()
    return ChannelRegistry(session_maker=maker, channels=channels), channels, maker


def _bound(channel_id: int, tournament_id: int, cursor: int | None) -> tuple[SimpleNamespace, SimpleNamespace]:
    return (
        SimpleNamespace(channel_id=channel_id, last_scanned_message_id=cursor),
        SimpleNamespace(id=tournament_id, name=f"T{tournament_id}"),
    )


class ChannelRegistryTests(IsolatedAsyncioTestCase):
    async def test_a_reload_replaces_the_watched_set_and_its_cursors(self) -> None:
        registry, channels, _ = _registry(_bound(10, 1, 500), _bound(20, 2, None))

        await registry.reload()

        self.assertEqual(registry.channel_ids(), {10: 1, 20: 2})
        self.assertEqual((registry.cursor_for(10), registry.cursor_for(20)), (500, None))
        self.assertEqual(registry.tournament_id_for(20), 2)

        channels.list_active_with_tournament.return_value = [_bound(20, 2, 700)]
        await registry.reload()

        self.assertEqual(registry.channel_ids(), {20: 2})
        self.assertIsNone(registry.tournament_id_for(10))
        self.assertIsNone(registry.cursor_for(10))
        self.assertEqual(registry.cursor_for(20), 700)

    async def test_advance_only_ever_moves_the_cursor_forward(self) -> None:
        registry, channels, maker = _registry(_bound(10, 1, 500))
        await registry.reload()

        await registry.advance(10, 600)

        self.assertEqual(registry.cursor_for(10), 600)
        channels.set_last_scanned.assert_awaited_once_with(maker.session, 10, 600)
        maker.session.commit.assert_awaited_once()

        await registry.advance(10, 550)

        self.assertEqual(registry.cursor_for(10), 600)
        channels.set_last_scanned.assert_awaited_once()

    async def test_a_channel_never_scanned_gets_its_first_cursor(self) -> None:
        registry, channels, maker = _registry(_bound(10, 1, None))
        await registry.reload()

        await registry.advance(10, 1)

        self.assertEqual(registry.cursor_for(10), 1)
        channels.set_last_scanned.assert_awaited_once_with(maker.session, 10, 1)
