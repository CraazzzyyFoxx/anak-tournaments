"""The lifecycle rules every publisher of Discord messages shares."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

from shared.services import discord_messages

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)


def _row(status: str, **overrides):
    values = {
        "id": 7,
        "status": status,
        "channel": "discord_channel",
        "discord_channel_id": 555,
        "message_id": 999,
        "created_at": NOW,
        "subject": "mix:42",
        "workspace_id": 3,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class StatusTests(TestCase):
    def test_a_pending_message_the_broker_dropped_reads_lost(self) -> None:
        self.assertEqual(discord_messages.effective_status(_row("pending"), now=NOW + timedelta(minutes=1)), "pending")
        self.assertEqual(discord_messages.effective_status(_row("pending"), now=NOW + timedelta(minutes=6)), "lost")
        self.assertEqual(discord_messages.effective_status(_row("posted"), now=NOW + timedelta(days=1)), "posted")
        naive = _row("pending", created_at=NOW.replace(tzinfo=None))
        self.assertEqual(discord_messages.effective_status(naive, now=NOW + timedelta(minutes=6)), "lost")

    def test_a_jump_link_exists_only_for_a_posted_message(self) -> None:
        self.assertEqual(
            discord_messages.jump_url(_row("posted"), guild_id=1), "https://discord.com/channels/1/555/999"
        )
        self.assertEqual(
            discord_messages.jump_url(_row("posted", channel="discord_dm"), guild_id=None),
            "https://discord.com/channels/@me/555/999",
        )
        self.assertIsNone(discord_messages.jump_url(_row("posted"), guild_id=None))
        self.assertIsNone(discord_messages.jump_url(_row("posted", message_id=None), guild_id=1))
        self.assertIsNone(discord_messages.jump_url(_row("deleted"), guild_id=1))


class SubjectTests(TestCase):
    def test_a_mix_subject_round_trips(self) -> None:
        self.assertEqual(discord_messages.mix_subject(42), "mix:42")
        self.assertEqual(discord_messages.mix_id(discord_messages.mix_subject(42)), 42)
        for other in ("notification:42", "mix:", "mix:abc", "mixer:42"):
            self.assertIsNone(discord_messages.mix_id(other), other)

    def test_slots_and_notification_subjects(self) -> None:
        self.assertEqual(discord_messages.SIGNUP_SLOT, "signup")
        self.assertEqual(discord_messages.lineup_slot(0, 3), "lineup:0:3")
        self.assertEqual(discord_messages.notification_subject(7), "notification:7")


class SendTests(IsolatedAsyncioTestCase):
    async def test_a_message_has_exactly_one_destination(self) -> None:
        claim = AsyncMock(return_value=7)
        with patch.object(discord_messages.repository, "claim", claim):
            for destinations in ({}, {"channel_id": 1, "discord_user_id": 2}):
                with self.assertRaises(ValueError, msg=destinations):
                    await discord_messages.send_command(
                        object(), subject="mix:1", slot="signup", kind="mix.signup", workspace_id=1, **destinations
                    )
        claim.assert_not_awaited()

    async def test_a_channel_post_claims_its_row_and_returns_a_send(self) -> None:
        claim = AsyncMock(return_value=7)
        with patch.object(discord_messages.repository, "claim", claim):
            command = await discord_messages.send_command(
                object(), subject="mix:1", slot="signup", kind="mix.signup", workspace_id=1, channel_id=555
            )

        self.assertEqual((command.action, command.message_ref), ("send", 7))
        self.assertEqual(
            claim.await_args.kwargs,
            {
                "channel": "discord_channel",
                "target": "555",
                "subject": "mix:1",
                "slot": "signup",
                "kind": "mix.signup",
                "payload_json": None,
                "dedupe_key": None,
                "notification_id": None,
                "workspace_id": 1,
            },
        )

    async def test_a_dm_carries_the_payload_the_bot_renders_from(self) -> None:
        claim = AsyncMock(return_value=8)
        payload = {"tournament_id": 3}
        with patch.object(discord_messages.repository, "claim", claim):
            command = await discord_messages.send_command(
                object(),
                subject="notification:5",
                slot="dm",
                kind="registration.approved",
                workspace_id=1,
                discord_user_id=42,
                dedupe_key="n:5",
                notification_id=5,
                payload=payload,
            )

        self.assertEqual((command.action, command.message_ref), ("send", 8))
        kwargs = claim.await_args.kwargs
        self.assertEqual((kwargs["channel"], kwargs["target"]), ("discord_dm", "42"))
        self.assertEqual((kwargs["dedupe_key"], kwargs["notification_id"]), ("n:5", 5))
        self.assertEqual(kwargs["payload_json"], payload)
        self.assertIsNot(kwargs["payload_json"], payload)

    async def test_a_taken_dedupe_key_sends_nothing(self) -> None:
        with patch.object(discord_messages.repository, "claim", AsyncMock(return_value=None)):
            command = await discord_messages.send_command(
                object(), subject="n", slot="dm", kind="k", workspace_id=1, discord_user_id=42, dedupe_key="n:5"
            )
        self.assertIsNone(command)


class DeleteTests(IsolatedAsyncioTestCase):
    async def test_delete_sends_commands_only_for_messages_that_may_exist(self) -> None:
        rows = [
            _row("posted", id=1),
            _row("pending", id=2),
            _row("failed", id=3),
            _row("deleting", id=4),
            _row("deleted", id=5),
        ]
        statuses = {row.id: row.status for row in rows}
        # The guarded UPDATE applies only to a live row.
        deleting = AsyncMock(side_effect=lambda _session, row_id: statuses[row_id] in ("pending", "posted"))
        deleted = AsyncMock(return_value=True)
        with (
            patch.object(discord_messages.repository, "mark_deleting", deleting),
            patch.object(discord_messages.repository, "mark_deleted", deleted),
        ):
            commands = await discord_messages.delete_commands(object(), rows)

        self.assertEqual(
            [(command.action, command.message_ref) for command in commands], [("delete", 1), ("delete", 2)]
        )
        # Refused by Discord, so nothing to delete there: closed without a command.
        self.assertEqual([call.args[1] for call in deleted.await_args_list], [3])
