"""A mix match's ban room (spec §8): opened from the preset Start froze over the game's active heroes, played by its
captains and hosts, timed like any room, watched by anyone, talked in by its players and hosts only."""

from __future__ import annotations

import itertools
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import sqlalchemy as sa

from shared import models
from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.models.platform.realtime import WorkspaceEvent
from shared.schemas.events import PickBanRoomOpenRequestedEvent
from shared.services.chat import ChatRoom
from shared.services.encounter.participants import MemberSnapshot, place_team
from shared.services.realtime import INVALIDATION_EVENT_TYPE, Resource
from shared.tests.encounter_writer_case import EncounterWriterCase
from src.rpc import _helpers as rpc_helpers
from src.rpc import pick_ban_admin, public_rpc
from src.services.encounter import room_open_events
from src.services.encounter.chat_access import encounter_chat_service
from src.services.encounter.pick_ban_action import pick_ban_action_service
from src.services.encounter.pick_ban_session import pick_ban_session_service
from tests._rpc_fakes import CapturingBroker, make_identity

_TAG = itertools.count()
_LOG = SimpleNamespace(exception=lambda *a, **k: None)
_PEOPLE = ("p0", "p1", "p2", "p3", "host", "cohost", "member")


class MixBanRoomCase(EncounterWriterCase):
    """A Deadlock mix match as Start leaves it: slot 1 = m0 (captain) + m1, slot 2 = m2 (captain) + m3, both ready,
    the position-1 game awaiting its result and the lobby holding the preset Start froze."""

    ban_preset: str | None = "deadlock_hero_bans"

    async def asyncSetUp(self) -> None:
        # The post-commit healer runs on a background task in production; every pass here is driven explicitly.
        stage = patch("src.services.encounter.room_reconcile._stage", lambda *a, **k: None)
        stage.start()
        self.addCleanup(stage.stop)
        await super().asyncSetUp()
        tag = f"mixban-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            await s.execute(
                sa.text(
                    "INSERT INTO catalog.discipline (code, name) VALUES ('deadlock', 'Deadlock') ON CONFLICT DO NOTHING"
                )
            )
            # Four active heroes -- enough for the preset's four bans -- and one retired.
            heroes = [
                models.CatalogEntity(
                    discipline="deadlock", kind="character", slug=f"{tag}-{i}", name=f"{tag} {i}", active=i < 4
                )
                for i in range(5)
            ]
            accounts = [
                models.AuthUser(email=f"{who}-{tag}@example.test", username=f"{who}-{tag}", is_active=True)
                for who in _PEOPLE
            ]
            s.add_all([*heroes, *accounts])
            await s.flush()
            self.hero_rows = [hero.id for hero in heroes]
            self.heroes, self.retired = self.hero_rows[:4], self.hero_rows[4]
            self.auth = {who: account.id for who, account in zip(_PEOPLE, accounts, strict=True)}
            self.names = {who: account.username for who, account in zip(_PEOPLE, accounts, strict=True)}
            for index in range(4):
                (await s.get_one(models.User, self.users[index])).auth_user_id = self.auth[f"p{index}"]
            mix = models.CustomGame(
                workspace_id=self.ids["ws"],
                name=tag,
                scoring_rule_id=self.ids["rule"],
                discipline="deadlock",
                host_user_id=self.auth["host"],
                hero_ban_preset=self.ban_preset,
            )
            s.add(mix)
            await s.flush()
            self.mix_id = mix.id
            s.add(models.CustomGameCoHost(custom_game_id=mix.id, user_id=self.auth["cohost"]))
            encounter = models.Encounter(
                workspace_id=self.ids["ws"],
                discipline="deadlock",
                custom_game_id=mix.id,
                scoring_rule_id=self.ids["rule"],
                name="T1 vs T2",
                slot_count=2,
                best_of=1,
                status=enums.EncounterStatus.OPEN,
            )
            s.add(encounter)
            await s.flush()
            self.encounter_id = encounter.id
            self.seats: list[int] = []
            for slot, (captain, player) in enumerate(((0, 1), (2, 3)), start=1):
                seat = await place_team(
                    s,
                    encounter,
                    slot=slot,
                    team_id=None,
                    name=f"T{slot}",
                    seed=None,
                    members=[
                        MemberSnapshot(self.ids[f"m{captain}"], f"P{captain}", 3000, False, (), is_captain=True),
                        MemberSnapshot(self.ids[f"m{player}"], f"P{player}", 2000, False, (), is_captain=False),
                    ],
                )
                s.add(models.EncounterReadiness(encounter_id=encounter.id, encounter_team_id=seat.id))
                self.seats.append(seat.id)
            s.add(
                models.EncounterGame(
                    encounter_id=encounter.id, position=1, state=enums.EncounterGameState.AWAITING_RESULT
                )
            )
            s.add(
                models.CustomGameLobby(
                    custom_game_id=mix.id,
                    lobby_index=0,
                    live_encounter_id=encounter.id,
                    live_ban_preset=self.ban_preset,
                )
            )
            await s.commit()

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.CatalogEntity).where(models.CatalogEntity.id.in_(self.hero_rows)))
            await s.execute(sa.delete(models.AuthUser).where(models.AuthUser.id.in_(self.auth.values())))
            await s.execute(sa.delete(WorkspaceEvent).where(WorkspaceEvent.workspace_id == self.ids["ws"]))
            await s.commit()
        await super().asyncTearDown()

    # -- helpers -----------------------------------------------------------
    async def open_room(self) -> bool:
        """What Start's outbox event does once tournament-service consumes it."""
        event = PickBanRoomOpenRequestedEvent(encounter_id=self.encounter_id, source_service="test")
        with patch.object(room_open_events.db, "async_session_maker", self.Session):
            return await room_open_events.process_room_open(event.model_dump(mode="json"))

    async def rpc(self, register, subject: str, data: dict) -> dict:
        broker = CapturingBroker()
        register(broker, _LOG)
        with patch.object(rpc_helpers.db, "async_session_maker", self.Session):
            return await broker.handlers[subject](data, None)

    async def host_room_call(self, subject: str, payload: dict) -> dict:
        """One of the organizer's room controls, called by the mix's host."""
        return await self.rpc(
            pick_ban_admin.register,
            subject,
            {"identity": make_identity(user_id=self.auth["host"]), "id": self.encounter_id, "payload": payload},
        )

    async def captain_ban(self, who: str, item_id: int) -> dict:
        return await self.rpc(
            public_rpc.register,
            "rpc.tournament.captain_pick_ban_act",
            {
                "identity": make_identity(user_id=self.auth[who]),
                "id": self.encounter_id,
                "kind": "hero",
                "payload": {"action": "ban", "item_id": item_id},
            },
        )

    async def hero_session(self) -> models.PickBanSession | None:
        async with self.Session() as s:
            return await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)

    async def state(self) -> dict:
        async with self.Session() as s:
            return await pick_ban_action_service.get_pick_ban_state(s, self.encounter_id, enums.PickBanKind.HERO)

    async def banned(self) -> list[tuple[int, int]]:
        return [
            (entry["item_id"], entry["picked_by_team_id"])
            for entry in (await self.state())["pool"]
            if entry["status"] == "banned"
        ]

    async def pickup_mix_invalidations(self) -> int:
        """The stored workspace invalidations naming the pickup mix -- what the mix overview refetches on."""
        async with self.Session() as s:
            payloads = (
                await s.scalars(
                    sa.select(WorkspaceEvent.payload).where(
                        WorkspaceEvent.workspace_id == self.ids["ws"],
                        WorkspaceEvent.event_type == INVALIDATION_EVENT_TYPE,
                    )
                )
            ).all()
        return sum(Resource.WORKSPACE_PICKUP_MIX.value in payload["resources"] for payload in payloads)

    def account(self, who: str) -> models.AuthUser:
        user = models.AuthUser()
        user.id = self.auth[who]
        user.username = self.names[who]
        user.is_superuser = False
        user.is_active = True
        return user


class MixBanRoomTests(MixBanRoomCase):
    async def test_a_started_match_opens_the_preset_room_over_the_active_heroes(self) -> None:
        self.assertTrue(await self.open_room())

        state = await self.state()
        pool = {entry["item_id"] for entry in state["pool"]}
        self.assertLessEqual(set(self.heroes), pool)
        self.assertNotIn(self.retired, pool)
        # Seat order is the ban order (spec §5.1): slot 1 bans first.
        self.assertEqual(("ban", [self.seats[0]]), (state["expected_action"], state["acting_team_ids"]))

    async def test_a_preset_edit_after_start_keeps_the_started_preset(self) -> None:
        async with self.Session() as s:
            (await s.get_one(models.CustomGame, self.mix_id)).hero_ban_preset = None
            await s.commit()

        await self.open_room()

        self.assertEqual("ban", (await self.state())["expected_action"])

    async def test_the_captain_bans_and_a_teammate_is_refused(self) -> None:
        await self.open_room()

        refused = await self.captain_ban("p1", self.heroes[0])
        done = await self.captain_ban("p0", self.heroes[0])

        self.assertEqual("forbidden", refused["error"]["code"])
        self.assertTrue(done["ok"], done)
        self.assertEqual([(self.heroes[0], self.seats[0])], await self.banned())

    async def test_a_host_acts_for_a_team_and_a_plain_member_is_refused(self) -> None:
        await self.open_room()

        async def act(who: str) -> dict:
            return await self.rpc(
                pick_ban_admin.register,
                "rpc.tournament.admin_pick_ban_act",
                {
                    "identity": make_identity(user_id=self.auth[who]),
                    "id": self.encounter_id,
                    "payload": {
                        "kind": "hero",
                        "encounter_team_id": self.seats[0],
                        "action": "ban",
                        "item_id": self.heroes[1],
                    },
                },
            )

        self.assertEqual("forbidden", (await act("member"))["error"]["code"])
        self.assertTrue((await act("cohost"))["ok"])
        self.assertEqual([(self.heroes[1], self.seats[0])], await self.banned())

    async def test_a_timed_out_step_is_filled_at_random(self) -> None:
        await self.open_room()
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(
                s, self.encounter_id, enums.PickBanKind.HERO, for_update=True
            )
            pick_ban.current_step_started_at = datetime.now(UTC) - timedelta(minutes=5)
            await s.commit()

        async with self.Session() as s:
            self.assertTrue(await pick_ban_action_service.reconcile_room(s, self.encounter_id, skip_locked=False))

        self.assertEqual([self.seats[0]], [team for _item, team in await self.banned()])

    async def test_a_signed_out_spectator_watches_the_room(self) -> None:
        await self.open_room()

        read = await self.rpc(
            public_rpc.register, "rpc.tournament.captain_pick_ban_state", {"id": self.encounter_id, "kind": "hero"}
        )

        self.assertTrue(read["ok"], read)
        self.assertIsNotNone(read["data"]["session"])
        self.assertIsNone(read["data"]["viewer_team_id"])

    async def test_seated_players_and_hosts_chat_and_nobody_else_reads(self) -> None:
        room = ChatRoom.encounter(self.encounter_id)
        sent = []
        for who in ("p1", "p0", "host"):
            async with self.Session() as s:
                message = await encounter_chat_service.post(s, self.account(who), room, f"hi from {who}")
            sent.append((message.author_role, message.author_name))

        self.assertEqual([("player", "P1"), ("captain", "P0"), ("staff", self.names["host"])], sent)
        for viewer in (self.account("member"), None):
            async with self.Session() as s:
                with self.assertRaises(BaseAPIException) as refused:
                    await encounter_chat_service.envelope(s, viewer, room, after_id=None, limit=50)
            self.assertEqual(403, refused.exception.status_code)

    async def test_the_finished_room_tells_the_mix_overview(self) -> None:
        await self.open_room()
        self.assertEqual(0, await self.pickup_mix_invalidations())

        for who, hero in zip(("p0", "p2", "p0", "p2"), self.heroes, strict=True):
            self.assertTrue((await self.captain_ban(who, hero))["ok"])

        self.assertEqual(enums.MapVetoSessionStatus.COMPLETED, (await self.hero_session()).status)
        self.assertEqual(1, await self.pickup_mix_invalidations())

    async def test_a_finished_room_a_host_reopens_tells_the_mix_overview_again(self) -> None:
        await self.open_room()
        for who, hero in zip(("p0", "p2", "p0", "p2"), self.heroes, strict=True):
            await self.captain_ban(who, hero)

        reopened = await self.host_room_call("rpc.tournament.admin_pick_ban_reopen", {"kind": "hero"})

        self.assertTrue(reopened["ok"], reopened)
        self.assertEqual(enums.MapVetoSessionStatus.ACTIVE, (await self.hero_session()).status)
        # Live -> Pre-game is a change of the overview too, not only Pre-game -> Live.
        self.assertEqual(2, await self.pickup_mix_invalidations())

    async def test_a_host_cancelling_the_room_tells_the_mix_overview(self) -> None:
        await self.open_room()

        cancelled = await self.host_room_call(
            "rpc.tournament.admin_pick_ban_cancel", {"kind": "hero", "reason": "playing without bans"}
        )

        self.assertTrue(cancelled["ok"], cancelled)
        self.assertEqual(1, await self.pickup_mix_invalidations())

    async def test_a_cancelled_room_a_host_resets_tells_the_mix_overview_again(self) -> None:
        await self.open_room()
        await self.host_room_call("rpc.tournament.admin_pick_ban_cancel", {"kind": "hero", "reason": "oops"})

        reset = await self.host_room_call("rpc.tournament.admin_pick_ban_session_reset", {"kind": "hero"})

        self.assertTrue(reset["ok"], reset)
        self.assertEqual(enums.MapVetoSessionStatus.ACTIVE, (await self.hero_session()).status)
        self.assertEqual(2, await self.pickup_mix_invalidations())


class MixWithoutBansTests(MixBanRoomCase):
    ban_preset = None

    async def test_a_match_without_a_preset_opens_no_room(self) -> None:
        await self.open_room()

        self.assertIsNone(await self.hero_session())
        self.assertEqual("not_configured", (await self.state())["reason"])
