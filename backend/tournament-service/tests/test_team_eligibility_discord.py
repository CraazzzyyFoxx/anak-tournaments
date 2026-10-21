"""A discord-service that cannot answer fails team guild membership closed, in one round trip."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from shared.services.discord_errors import DiscordUnavailable  # noqa: E402
from src.services.registration.team_eligibility import _discord_signals  # noqa: E402


def test_an_unanswered_prefetch_marks_linked_members_unreachable_without_asking_again():
    discord = SimpleNamespace(prefetch=AsyncMock(side_effect=DiscordUnavailable("down")), member_roles=AsyncMock())
    members = [SimpleNamespace(id=1), SimpleNamespace(id=2)]

    signals = asyncio.run(_discord_signals(members, {1: ["111"]}, guild_id="g", discord=discord))  # type: ignore[arg-type]

    assert signals == {1: "unreachable", 2: "not_linked"}
    discord.member_roles.assert_not_awaited()
