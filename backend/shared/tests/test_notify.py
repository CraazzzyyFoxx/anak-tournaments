"""Behavioural pins for the single write path of the notification inbox.

``notify()`` is the only thing in the project allowed to append a
``notification`` row, so everything a caller can get wrong has to fail here
rather than at the database: an unknown ``kind`` (the frontend has no message
for it), a payload missing a field the rendered message interpolates, an
audience that disagrees with the recipient columns the CHECK constraints
enforce, or an announcement published to the whole platform in one language.

The session is a spy rather than a real engine on purpose: the invariant under
test is *that the caller's transaction still owns the commit*, which a real
session cannot show -- committing would look identical to not committing once
the fixture tears down.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

from pydantic import ValidationError

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))

from shared.services import realtime_topics  # noqa: E402
from shared.services.notifications import notify, publish_notification_created  # noqa: E402

_INVITE = {
    "team_id": 12,
    "team_name": "Anak",
    "tournament_id": 3,
    "tournament_name": "OWT Season 5",
    "slot_code": "dps1",
    "is_substitute": False,
    "invite_id": 99,
}


class _Session:
    """Records the three session methods the helper could reach for.

    ``commit``/``flush`` exist only so that calling them would be *visible*;
    the tests assert they stay untouched.
    """

    def __init__(self) -> None:
        self.added: list[object] = []
        self.committed = 0
        self.flushed = 0

    def add(self, row: object) -> None:
        self.added.append(row)

    async def commit(self) -> None:
        self.committed += 1

    async def flush(self) -> None:
        self.flushed += 1


class _Redis:
    def __init__(self, fail: bool = False) -> None:
        self.published: list[tuple[str, str]] = []
        self.fail = fail

    async def publish(self, channel: str, payload: str) -> None:
        if self.fail:
            raise ConnectionError("redis is down")
        self.published.append((channel, payload))


class NotifyTests(IsolatedAsyncioTestCase):
    async def test_notify_does_not_commit(self) -> None:
        session = _Session()

        row = await notify(
            session,
            kind="team_invite.received",
            payload=dict(_INVITE),
            audience="user",
            recipient_auth_user_id=7,
        )

        self.assertEqual([row], session.added)
        self.assertEqual("team_invite.received", row.kind)
        self.assertEqual(7, row.recipient_auth_user_id)
        self.assertEqual(12, row.payload_json["team_id"])
        self.assertEqual(0, session.committed)
        self.assertEqual(0, session.flushed)

    async def test_unknown_kind_is_rejected(self) -> None:
        session = _Session()

        with self.assertRaises(ValueError) as caught:
            await notify(
                session,
                kind="nope.nope",
                payload={},
                audience="user",
                recipient_auth_user_id=7,
            )

        self.assertIn("nope.nope", str(caught.exception))
        self.assertEqual([], session.added)

    async def test_payload_is_validated_against_kind_schema(self) -> None:
        session = _Session()
        without_team = {k: v for k, v in _INVITE.items() if k != "team_id"}

        with self.assertRaises(ValidationError) as caught:
            await notify(
                session,
                kind="team_invite.received",
                payload=without_team,
                audience="user",
                recipient_auth_user_id=7,
            )

        self.assertIn("team_id", str(caught.exception))
        self.assertEqual([], session.added)

    async def test_global_announcement_requires_every_locale(self) -> None:
        session = _Session()
        ru_only = {"locales": {"ru": {"title": "Обновление"}}, "default_locale": "ru"}

        with self.assertRaises(ValidationError) as caught:
            await notify(session, kind="announcement.published", payload=ru_only, audience="global")

        self.assertIn("en", str(caught.exception))
        self.assertEqual([], session.added)

        row = await notify(
            session,
            kind="announcement.published",
            payload={
                "locales": {"ru": {"title": "Обновление"}, "en": {"title": "Update"}},
                "default_locale": "ru",
            },
            audience="global",
        )

        self.assertEqual("global", row.audience)
        self.assertEqual({"ru", "en"}, set(row.payload_json["locales"]))

    async def test_workspace_announcement_accepts_one_locale(self) -> None:
        session = _Session()

        row = await notify(
            session,
            kind="announcement.published",
            payload={"locales": {"ru": {"title": "Сбор"}}, "default_locale": "ru"},
            audience="workspace",
            workspace_id=4,
        )

        self.assertEqual("workspace", row.audience)
        self.assertEqual(4, row.workspace_id)
        self.assertEqual(["ru"], list(row.payload_json["locales"]))

    async def test_default_locale_must_be_present(self) -> None:
        session = _Session()

        with self.assertRaises(ValidationError) as caught:
            await notify(
                session,
                kind="announcement.published",
                payload={"locales": {"ru": {"title": "Сбор"}}, "default_locale": "en"},
                audience="workspace",
                workspace_id=4,
            )

        self.assertIn("default_locale", str(caught.exception))
        self.assertEqual([], session.added)

    async def test_user_audience_requires_recipient(self) -> None:
        session = _Session()

        with self.assertRaises(ValueError):
            await notify(
                session,
                kind="team_invite.received",
                payload=dict(_INVITE),
                audience="user",
            )

        self.assertEqual([], session.added)


class PublishNotificationCreatedTests(IsolatedAsyncioTestCase):
    async def test_signal_reaches_only_the_recipients_own_topic(self) -> None:
        redis = _Redis()

        await publish_notification_created(redis, recipient_auth_user_id=7)

        (channel, raw), = redis.published
        self.assertEqual(realtime_topics.realtime_channel("user:7:notifications"), channel)
        frame = json.loads(raw)
        self.assertEqual("user:7:notifications", frame["topic"])
        self.assertEqual("notification.created", frame["event"]["event_type"])
        # Non-durable: no replay cursor, so a reconnecting client never asks the
        # durable event log for a signal that was never written to it.
        self.assertEqual(0, frame["event"]["event_id"])

    async def test_a_broken_redis_does_not_undo_a_committed_notification(self) -> None:
        await publish_notification_created(_Redis(fail=True), recipient_auth_user_id=7)
