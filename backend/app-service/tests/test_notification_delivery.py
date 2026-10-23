"""Behavioural pins for Discord delivery: what is claimed, and what is sent.

Rendering is discord-service's job (it draws the card from the claimed row);
this suite pins the decisions taken before that -- expiry, preferences, the
tournament mute, the linked account, the workspace config -- and the row the bot
renders from.

It runs against a real (in-memory) SQLite engine behind the sync-``Session``
shim the sibling notification suites established, because every assertion here
is about *rows*: the ``discord_message`` row that makes a redelivered event send
nothing and that the bot renders from, and the outbox row that is the command.
A mock session would happily agree with a flow that inserts nothing.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import MagicMock, patch

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared import models  # noqa: E402
from shared.models.identity.oauth import OAuthConnection  # noqa: E402
from shared.models.platform.discord_message import DiscordMessage  # noqa: E402
from shared.models.platform.notification import (  # noqa: E402
    Notification,
    NotificationPreference,
    NotificationWorkspaceConfig,
)
from shared.models.platform.outbox import EventOutbox  # noqa: E402
from shared.schemas.events import NotificationBroadcastEvent, NotificationCreatedEvent  # noqa: E402
from shared.testing import install_postgres_type_shims  # noqa: E402
from src.core import db  # noqa: E402
from src.services.notification_delivery import consumer  # noqa: E402
from src.services.notification_delivery.service import NotificationDeliveryService  # noqa: E402

install_postgres_type_shims()

TABLES = (
    Notification.__table__,
    DiscordMessage.__table__,
    NotificationPreference.__table__,
    NotificationWorkspaceConfig.__table__,
    EventOutbox.__table__,
    OAuthConnection.__table__,
    models.Workspace.__table__,
    models.Tournament.__table__,
)

RECIPIENT = 100
WORKSPACE = 7
DISCORD_ID = "424242424242424242"
CHANNEL_ID = 987654321098765432

DEADLINE = "2026-09-25T18:00:00+00:00"


class _AsyncSessionShim:
    """Async facade over a synchronous ``Session`` -- no async SQLite driver."""

    def __init__(self, session: Session) -> None:
        self._session = session

    async def execute(self, statement: Any) -> Any:
        return self._session.execute(statement)

    def add(self, instance: Any) -> None:
        self._session.add(instance)

    async def flush(self) -> None:
        self._session.flush()

    async def commit(self) -> None:
        self._session.commit()


class _SessionMaker:
    """Stands in for ``db.async_session_maker`` (one shared shim per test)."""

    def __init__(self, shim: _AsyncSessionShim) -> None:
        self._shim = shim

    def __call__(self) -> _SessionMaker:
        return self

    async def __aenter__(self) -> _AsyncSessionShim:
        return self._shim

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _Message:
    """The few attributes ``observe_message_processing`` reads off a message."""

    headers: dict[str, str] = {}
    message_id = None
    correlation_id = None
    raw_message = None


class DeliveryTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.engine = sa.create_engine(
            "sqlite://",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        with self.engine.begin() as conn:
            for schema in sorted({table.schema for table in TABLES if table.schema}):
                conn.exec_driver_sql(f"ATTACH DATABASE ':memory:' AS {schema}")
            for table in TABLES:
                table.create(conn)
        self.session = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)
        self.shim = _AsyncSessionShim(self.session)
        self.service = NotificationDeliveryService()

    # -- builders ---------------------------------------------------------

    def personal(self, kind: str = "check_in.opened", **values: Any) -> Notification:
        row = Notification(
            audience="user",
            recipient_auth_user_id=RECIPIENT,
            source_workspace_id=WORKSPACE,
            kind=kind,
            payload_json={"tournament_id": 3, "tournament_name": "Cup"},
            **values,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def link_discord(self, provider_user_id: str = DISCORD_ID) -> None:
        self.session.add(
            OAuthConnection(
                auth_user_id=RECIPIENT,
                provider="discord",
                provider_user_id=provider_user_id,
                username="player",
            )
        )
        self.session.flush()

    def configure_workspace(self, *, channel_id: int | None = CHANNEL_ID, kinds: list[str] | None = None) -> None:
        self.session.add(
            NotificationWorkspaceConfig(
                workspace_id=WORKSPACE,
                discord_channel_id=channel_id,
                locale="en",
                broadcast_kinds=["registration.opened"] if kinds is None else kinds,
            )
        )
        self.session.flush()

    def commands(self) -> list[dict[str, Any]]:
        rows = self.session.scalars(sa.select(EventOutbox).order_by(EventOutbox.id)).all()
        return [
            row.payload_json if isinstance(row.payload_json, dict) else json.loads(row.payload_json) for row in rows
        ]

    def messages(self) -> list[DiscordMessage]:
        return list(self.session.scalars(sa.select(DiscordMessage).order_by(DiscordMessage.id)).all())

    # -- personal ---------------------------------------------------------

    async def test_a_dm_is_one_outbox_command_and_one_discord_message_row(self) -> None:
        """The happy path, and the row the bot renders from.

        The command only names the claimed row (``message_ref``): the row
        carries the destination and the notification payload the bot draws the
        card from, and it is where the bot writes back what Discord answered.
        """
        row = self.personal()
        self.link_discord()

        status = await self.service.deliver_personal(self.shim, NotificationCreatedEvent(notification_id=row.id))

        self.assertEqual(status, "sent")
        (command,) = self.commands()
        self.assertEqual(command["action"], "send")
        self.assertNotIn("card", command)
        (entry,) = self.messages()
        self.assertEqual(command["message_ref"], entry.id)
        self.assertEqual(
            (entry.channel, entry.target, entry.dedupe_key), ("discord_dm", DISCORD_ID, f"notification:{row.id}")
        )
        self.assertEqual((entry.subject, entry.slot, entry.status), (f"notification:{row.id}", "dm", "pending"))
        self.assertEqual((entry.kind, entry.notification_id, entry.workspace_id), (row.kind, row.id, WORKSPACE))
        self.assertEqual(entry.payload_json, {"tournament_id": 3, "tournament_name": "Cup"})
        self.assertIsNone(entry.card_json)

    async def test_a_switched_off_group_sends_nothing(self) -> None:
        """The opt-out has to bite before anything is written or queued."""
        row = self.personal()
        self.link_discord()
        self.session.add(NotificationPreference(auth_user_id=RECIPIENT, discord_dm={"tournament": False}))
        self.session.flush()

        status = await self.service.deliver_personal(self.shim, NotificationCreatedEvent(notification_id=row.id))

        self.assertEqual(status, "skipped_pref_off")
        self.assertEqual(self.commands(), [])
        self.assertEqual(self.messages(), [])

    async def test_a_tournament_with_dms_muted_sends_nothing(self) -> None:
        """The organizer's switch bites at delivery, so a DM already queued stays unsent."""
        self.session.execute(
            sa.insert(models.Tournament.__table__).values(
                id=3, workspace_id=WORKSPACE, name="Cup", slug="cup", discord_dms_enabled=False
            )
        )
        row = self.personal()
        self.link_discord()

        status = await self.service.deliver_personal(self.shim, NotificationCreatedEvent(notification_id=row.id))

        self.assertEqual(status, "skipped_tournament_muted")
        self.assertEqual(self.commands(), [])
        self.assertEqual(self.messages(), [])

    def dispute_review(self) -> Notification:
        row = self.personal(kind="encounter.dispute_review")
        row.payload_json = {
            "encounter_id": 5,
            "tournament_id": 3,
            "position": 0,
            "team_names": ["A", "B"],
        }
        self.session.flush()
        return row

    async def test_a_tournament_mute_does_not_silence_the_organizers(self) -> None:
        """The mute is what the tournament tells its players; a dispute still pages staff."""
        self.session.execute(
            sa.insert(models.Tournament.__table__).values(
                id=3, workspace_id=WORKSPACE, name="Cup", slug="cup", discord_dms_enabled=False
            )
        )
        row = self.dispute_review()
        self.link_discord()

        status = await self.service.deliver_personal(self.shim, NotificationCreatedEvent(notification_id=row.id))

        self.assertEqual(status, "sent")

    async def test_a_staff_dm_needs_its_workspace_switch_too(self) -> None:
        """Muting one workspace leaves the staff group on for the others."""
        row = self.dispute_review()
        self.link_discord()
        self.session.add(
            NotificationPreference(
                auth_user_id=RECIPIENT,
                discord_dm={"staff_workspaces": {str(WORKSPACE): False, str(WORKSPACE + 1): True}},
            )
        )
        self.session.flush()

        status = await self.service.deliver_personal(self.shim, NotificationCreatedEvent(notification_id=row.id))

        self.assertEqual(status, "skipped_pref_off")
        self.assertEqual(self.commands(), [])

    async def test_another_groups_switch_does_not_silence_this_one(self) -> None:
        """Groups are independent -- and an absent key is still the default."""
        row = self.personal(kind="encounter.scheduled")
        row.payload_json = {
            "encounter_id": 5,
            "tournament_id": 3,
            "tournament_name": "Cup",
            "team_names": ["A", "B"],
            "scheduled_at": DEADLINE,
        }
        self.session.flush()
        self.link_discord()
        self.session.add(NotificationPreference(auth_user_id=RECIPIENT, discord_dm={"tournament": False}))
        self.session.flush()

        status = await self.service.deliver_personal(self.shim, NotificationCreatedEvent(notification_id=row.id))

        self.assertEqual(status, "sent")

    async def test_without_a_linked_discord_there_is_nobody_to_dm(self) -> None:
        row = self.personal()

        status = await self.service.deliver_personal(self.shim, NotificationCreatedEvent(notification_id=row.id))

        self.assertEqual(status, "skipped_no_discord")
        self.assertEqual(self.commands(), [])
        self.assertEqual(self.messages(), [])

    async def test_a_redelivered_event_sends_once(self) -> None:
        """The outbox is at-least-once; the claimed ``dedupe_key`` is what makes delivery once."""
        row = self.personal()
        self.link_discord()
        event = NotificationCreatedEvent(notification_id=row.id)

        first = await self.service.deliver_personal(self.shim, event)
        second = await self.service.deliver_personal(self.shim, event)

        self.assertEqual((first, second), ("sent", "duplicate"))
        self.assertEqual(len(self.messages()), 1)
        self.assertEqual(len(self.commands()), 1)

    async def test_a_retired_notification_is_not_delivered(self) -> None:
        """An operator retiring a row before the drain must stop the DM."""
        row = self.personal(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        self.link_discord()

        status = await self.service.deliver_personal(self.shim, NotificationCreatedEvent(notification_id=row.id))

        self.assertEqual(status, "skipped_missing")
        self.assertEqual(self.commands(), [])

    async def test_a_vanished_notification_is_not_an_error(self) -> None:
        status = await self.service.deliver_personal(self.shim, NotificationCreatedEvent(notification_id=999))

        self.assertEqual(status, "skipped_missing")

    # -- broadcast --------------------------------------------------------

    def _broadcast(self, kind: str = "registration.opened") -> NotificationBroadcastEvent:
        return NotificationBroadcastEvent(
            workspace_id=WORKSPACE,
            kind=kind,
            payload={"tournament_id": 3, "tournament_name": "Cup"},
            dedupe_key="tournament:3",
        )

    async def test_a_workspace_channel_post_claims_the_configured_channel(self) -> None:
        self.configure_workspace()

        status = await self.service.deliver_broadcast(self.shim, self._broadcast())

        self.assertEqual(status, "sent")
        (command,) = self.commands()
        self.assertEqual(command["action"], "send")
        self.assertNotIn("card", command)
        (entry,) = self.messages()
        self.assertEqual(command["message_ref"], entry.id)
        self.assertEqual(
            (entry.channel, entry.target, entry.dedupe_key),
            ("discord_channel", str(CHANNEL_ID), "registration.opened:tournament:3"),
        )
        self.assertEqual(
            (entry.subject, entry.slot, entry.status),
            ("broadcast:registration.opened:tournament:3", "channel", "pending"),
        )
        self.assertEqual(
            (entry.kind, entry.workspace_id, entry.notification_id), ("registration.opened", WORKSPACE, None)
        )
        self.assertEqual(entry.payload_json, {"tournament_id": 3, "tournament_name": "Cup"})

    async def test_a_workspace_without_a_config_posts_nothing(self) -> None:
        """No row, and a row with no channel picked, are the same answer."""
        no_row = await self.service.deliver_broadcast(self.shim, self._broadcast())
        self.configure_workspace(channel_id=None)
        no_channel = await self.service.deliver_broadcast(self.shim, self._broadcast())

        self.assertEqual((no_row, no_channel), ("skipped_no_config", "skipped_no_config"))
        self.assertEqual(self.commands(), [])

    async def test_a_kind_the_workspace_disabled_posts_nothing(self) -> None:
        """Scheduling a bracket round must not spam the channel by default."""
        self.configure_workspace(kinds=["registration.opened"])

        status = await self.service.deliver_broadcast(self.shim, self._broadcast(kind="check_in.opened"))

        self.assertEqual(status, "skipped_no_config")
        self.assertEqual(self.commands(), [])

    async def test_a_redelivered_broadcast_posts_once(self) -> None:
        self.configure_workspace()
        event = self._broadcast()

        first = await self.service.deliver_broadcast(self.shim, event)
        second = await self.service.deliver_broadcast(self.shim, event)

        self.assertEqual((first, second), ("sent", "duplicate"))
        self.assertEqual(len(self.commands()), 1)

    # -- the consumer ------------------------------------------------------

    async def test_the_consumer_routes_each_event_type_to_its_flow(self) -> None:
        """One queue carries both event types; the dispatch is the only thing
        that tells them apart, and a typo in either name is silent."""
        row = self.personal()
        self.link_discord()
        self.configure_workspace()

        handler = self._subscribe()
        await handler(NotificationCreatedEvent(notification_id=row.id).model_dump(mode="json"), _Message())
        await handler(self._broadcast().model_dump(mode="json"), _Message())

        self.assertEqual([command["action"] for command in self.commands()], ["send", "send"])
        self.assertEqual([entry.channel for entry in self.messages()], ["discord_dm", "discord_channel"])

    async def test_the_consumer_ignores_an_event_it_has_no_flow_for(self) -> None:
        """The queue binds ``notification.*``; a future key must not crash the
        consumer into the DLQ before its handler exists."""
        handler = self._subscribe()

        await handler({"event_type": "notification.something_new"}, _Message())

        self.assertEqual(self.commands(), [])

    def _subscribe(self) -> Any:
        """The registered subscriber, with the worker's session factory swapped."""
        captured: dict[str, Any] = {}

        def subscriber(*_args: Any, **_kwargs: Any):
            def decorator(fn):
                captured["fn"] = fn
                return fn

            return decorator

        broker = MagicMock()
        broker.subscriber = subscriber
        consumer.register(broker, MagicMock())
        patcher = patch.object(db, "async_session_maker", _SessionMaker(self.shim))
        patcher.start()
        self.addCleanup(patcher.stop)
        return captured["fn"]
