"""``DiscordCommandEvent``: a command names one ``discord_message`` row and nothing else.

The row carries the destination and what the bot renders from, so the only
actions are sending that row's message and deleting it.
"""

from __future__ import annotations

from unittest import TestCase

from pydantic import ValidationError

from shared.schemas.events import DiscordCommandEvent


class DiscordCommandEventTests(TestCase):
    def test_send_and_delete_name_their_row(self) -> None:
        for action in ("send", "delete"):
            event = DiscordCommandEvent(action=action, message_ref=3)
            self.assertEqual((event.action, event.message_ref), (action, 3))

            with self.assertRaises(ValidationError, msg=action):
                DiscordCommandEvent(action=action)

    def test_no_other_action_exists(self) -> None:
        for action in ("edit", "post_message", "send_dm", "edit_message", "delete_message", "process_all"):
            with self.assertRaises(ValidationError, msg=action):
                DiscordCommandEvent(action=action, message_ref=3)
