"""The bot's guarded writes against real Postgres: ``discord_message`` and the rescan cursor.

Two processes move one ``discord_message`` row (the publisher marks it
``deleting`` while the bot may be mid-send), so every transition is an
``UPDATE ... WHERE status IN``; these pin which moves apply. A channel's rescan
cursor is guarded the same way, so a slow history walk never drags it back.
Each test runs in one never-committed transaction, so nothing outlives it.
Needs the test Postgres.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from shared import models
from shared.repository.discord_message import DiscordMessageRepository
from shared.repository.support import DiscordChannelRepository
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()
STATUSES = ("pending", "posted", "failed", "deleting", "deleted")


class DiscordMessageRepositoryTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.repo = DiscordMessageRepository()
        # No foreign keys on the table: a negative workspace id cannot collide with a real one.
        self.workspace_id = -(os.getpid() * 1000 + next(_TAG))
        self.subject = f"mix:{self.workspace_id}"

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()

    async def _claim(self, s: AsyncSession, **overrides) -> int | None:
        values = {
            "channel": "discord_channel",
            "target": "555",
            "subject": self.subject,
            "slot": "signup",
            "kind": "mix.signup",
            "workspace_id": self.workspace_id,
        }
        values.update(overrides)
        return await self.repo.claim(s, **values)

    async def _in_status(self, s: AsyncSession, status: str, **overrides) -> int:
        row_id = await self._claim(s, **overrides)
        assert row_id is not None
        moves = {
            "posted": lambda: self.repo.mark_posted(s, row_id, discord_channel_id=1, discord_message_id=2),
            "failed": lambda: self.repo.mark_failed(s, row_id, error="refused"),
            "deleting": lambda: self.repo.mark_deleting(s, row_id),
            "deleted": lambda: self.repo.mark_deleted(s, row_id),
        }
        if status != "pending":
            assert await moves[status]()
        return row_id

    async def _row(self, s: AsyncSession, row_id: int) -> models.DiscordMessage:
        return await s.scalar(
            sa.select(models.DiscordMessage)
            .where(models.DiscordMessage.id == row_id)
            .execution_options(populate_existing=True)
        )

    async def test_a_dedupe_key_is_claimed_once_per_destination(self) -> None:
        async with self.Session() as s:
            first = await self._claim(s, dedupe_key="n:1", payload_json={"tournament_id": 3})
            again = await self._claim(s, dedupe_key="n:1")
            elsewhere = await self._claim(s, dedupe_key="n:1", target="777")

            self.assertIsInstance(first, int)
            self.assertIsNone(again)
            self.assertIsInstance(elsewhere, int)
            row = await self._row(s, first)
            self.assertEqual((row.status, row.payload_json, row.card_json), ("pending", {"tournament_id": 3}, None))

    async def test_without_a_dedupe_key_every_claim_is_a_new_message(self) -> None:
        async with self.Session() as s:
            first, second = await self._claim(s), await self._claim(s)
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertNotEqual(first, second)

    async def test_mark_posted_applies_only_from_pending(self) -> None:
        async with self.Session() as s:
            posted = await self._in_status(s, "pending")
            self.assertTrue(await self.repo.mark_posted(s, posted, discord_channel_id=10, discord_message_id=20))
            row = await self._row(s, posted)
            self.assertEqual((row.status, row.discord_channel_id, row.message_id), ("posted", 10, 20))
            self.assertFalse(await self.repo.mark_posted(s, posted, discord_channel_id=11, discord_message_id=21))
            self.assertEqual((await self._row(s, posted)).message_id, 20)

            # A delete reached the row while the bot was inside ``channel.send``.
            raced = await self._in_status(s, "deleting")
            self.assertFalse(await self.repo.mark_posted(s, raced, discord_channel_id=10, discord_message_id=20))
            self.assertEqual((await self._row(s, raced)).status, "deleting")

    async def test_mark_failed_never_overwrites_a_later_state(self) -> None:
        async with self.Session() as s:
            pending = await self._in_status(s, "pending")
            self.assertTrue(await self.repo.mark_failed(s, pending, error="x" * 600))
            row = await self._row(s, pending)
            self.assertEqual((row.status, len(row.error)), ("failed", 500))

            for status in ("posted", "deleting", "deleted"):
                row_id = await self._in_status(s, status)
                self.assertFalse(await self.repo.mark_failed(s, row_id, error="late"), status)
                self.assertEqual((await self._row(s, row_id)).status, status)

    async def test_mark_deleting_applies_only_to_live_rows(self) -> None:
        async with self.Session() as s:
            for status in STATUSES:
                row_id = await self._in_status(s, status)
                live = status in ("pending", "posted")
                self.assertEqual(await self.repo.mark_deleting(s, row_id), live, status)
                self.assertEqual((await self._row(s, row_id)).status, "deleting" if live else status)

    async def test_mark_deleted_closes_everything_but_a_deleted_row(self) -> None:
        async with self.Session() as s:
            for status in STATUSES:
                row_id = await self._in_status(s, status)
                self.assertEqual(await self.repo.mark_deleted(s, row_id), status != "deleted", status)
                self.assertEqual((await self._row(s, row_id)).status, "deleted")

    async def test_set_card_only_on_live_rows(self) -> None:
        card = {"text": "### Mix"}
        async with self.Session() as s:
            for status in STATUSES:
                row_id = await self._in_status(s, status)
                live = status in ("pending", "posted")
                self.assertEqual(await self.repo.set_card(s, row_id, card), live, status)
                row = await self._row(s, row_id)
                self.assertEqual((row.status, row.card_json), (status, card if live else None))

    async def test_subject_reads_are_oldest_first_and_filtered(self) -> None:
        async with self.Session() as s:
            signup = await self._in_status(s, "posted")
            lineup = await self._in_status(s, "pending", slot="lineup:0:1")
            gone = await self._in_status(s, "deleted")
            later = await self._in_status(s, "pending")
            other_mix = await self._in_status(s, "pending", subject=f"{self.subject}0")
            await self._in_status(s, "pending", subject=f"notification:{self.workspace_id}")
            elsewhere = self.workspace_id - 1
            await self._in_status(s, "pending", workspace_id=elsewhere, subject=f"mix:{elsewhere}")

            def ids(rows):
                return [row.id for row in rows]

            self.assertEqual(ids(await self.repo.for_subject(s, self.subject)), [signup, lineup, gone, later])
            self.assertEqual(ids(await self.repo.for_subject(s, self.subject, slot="signup")), [signup, gone, later])
            self.assertEqual(
                ids(await self.repo.for_subject(s, self.subject, statuses=("pending", "posted"))),
                [signup, lineup, later],
            )
            self.assertEqual(
                ids(await self.repo.live_for_workspace(s, self.workspace_id, subject_prefix="mix:", slot="signup")),
                [signup, later, other_mix],
            )

    async def test_the_channel_rescan_cursor_only_moves_forward(self) -> None:
        channels = DiscordChannelRepository()
        tag = f"dmr{self.workspace_id}"
        async with self.Session() as s:
            workspace = models.Workspace(slug=tag, name=tag)
            s.add(workspace)
            await s.flush()
            tournament = models.Tournament(workspace_id=workspace.id, name=tag, slug=tag)
            s.add(tournament)
            await s.flush()
            channel_id = self.workspace_id  # negative: cannot collide with a real snowflake
            s.add(models.TournamentDiscordChannel(tournament_id=tournament.id, channel_id=channel_id))
            await s.flush()

            def cursor():
                return s.scalar(
                    sa.select(models.TournamentDiscordChannel.last_scanned_message_id).where(
                        models.TournamentDiscordChannel.channel_id == channel_id
                    )
                )

            self.assertTrue(await channels.set_last_scanned(s, channel_id, 100))
            self.assertFalse(await channels.set_last_scanned(s, channel_id, 50))
            self.assertFalse(await channels.set_last_scanned(s, channel_id, 100))
            self.assertEqual(await cursor(), 100)
            self.assertTrue(await channels.set_last_scanned(s, channel_id, 200))
            self.assertEqual(await cursor(), 200)
            self.assertFalse(await channels.set_last_scanned(s, channel_id - 1, 300))
