"""Hero picks in a mix room (spec §11, §11.6): every member picks their own hero, a hero taken is gone for everyone
at once, the clock picks for whoever has not, and Fearless keeps a player off the heroes they were recorded on
earlier in the mix -- until that round is undone."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from shared import models
from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.services.encounter.participants import MemberSnapshot, place_team
from src.services.encounter.pick_ban_action import pick_ban_action_service
from src.services.encounter.pick_ban_session import pick_ban_session_service
from tests.test_mix_pick_ban_room import MixBanRoomCase

HERO = enums.PickBanKind.HERO
#: Who sits where in ``MixBanRoomCase``: slot 1 (``self.seats[0]``) m0 + m1, slot 2 m2 + m3.
_SIDE = {"m0": 0, "m1": 0, "m2": 1, "m3": 1}


class MixPickRoomCase(MixBanRoomCase):
    """The ban room's Deadlock match on ``deadlock_bans_pick``: the four bans, then one open pick for every member."""

    ban_preset = "deadlock_bans_pick"

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            # Six more active heroes: the four bans take the fixture's four.
            extra = [
                models.CatalogEntity(
                    discipline="deadlock",
                    kind="character",
                    slug=f"pick-{self.encounter_id}-{i}",
                    name=f"pick {i}",
                    active=True,
                )
                for i in range(6)
            ]
            s.add_all(extra)
            await s.flush()
            self.picks = [hero.id for hero in extra]
            self.hero_rows.extend(self.picks)
            await s.commit()

    async def member_seats(self) -> dict[str, int]:
        """``{"m0": encounter.team_member id, ...}`` of the current match."""
        async with self.Session() as s:
            rows = await s.execute(
                sa.select(models.EncounterTeamMember.workspace_member_id, models.EncounterTeamMember.id).where(
                    models.EncounterTeamMember.encounter_id == self.encounter_id
                )
            )
            by_member = dict(rows.all())
        return {who: by_member[self.ids[who]] for who in _SIDE}

    async def ban_through(self) -> None:
        await self.open_room()
        for who, hero in zip(("p0", "p2", "p0", "p2"), self.heroes, strict=True):
            self.assertTrue((await self.captain_ban(who, hero))["ok"])

    async def pick(self, who: str, seat: int, hero: int) -> dict:
        async with self.Session() as s:
            return await pick_ban_action_service.perform_pick_ban_action(
                s, self.encounter_id, HERO, self.seats[_SIDE[who]], item_id=hero, action="pick", member_id=seat
            )

    async def picked_for(self) -> dict[int, int]:
        """``{hero: the seat it is for}`` of the room's picks."""
        return {
            entry["item_id"]: entry["picked_for_member_id"]
            for entry in (await self.state())["pool"]
            if entry["status"] == "picked"
        }

    async def everyone_picks(self) -> dict[str, int]:
        await self.ban_through()
        seat = await self.member_seats()
        for index, who in enumerate(_SIDE):
            await self.pick(who, seat[who], self.picks[index])
        return seat

    async def run_out_the_clock(self) -> None:
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, HERO, for_update=True)
            pick_ban.current_step_started_at = datetime.now(UTC) - timedelta(minutes=5)
            await s.commit()
        async with self.Session() as s:
            self.assertTrue(await pick_ban_action_service.reconcile_room(s, self.encounter_id, skip_locked=False))


class MixPickRoomTests(MixPickRoomCase):
    async def test_every_member_picks_their_own_hero_and_the_room_records_whose_it_is(self) -> None:
        seat = await self.everyone_picks()

        self.assertEqual({self.picks[i]: seat[who] for i, who in enumerate(_SIDE)}, await self.picked_for())
        self.assertEqual(enums.MapVetoSessionStatus.COMPLETED, (await self.hero_session()).status)

    async def test_a_hero_one_member_took_is_gone_for_everyone_at_once(self) -> None:
        await self.ban_through()
        seat = await self.member_seats()
        await self.pick("m2", seat["m2"], self.picks[0])

        with self.assertRaises(BaseAPIException) as refused:
            await self.pick("m0", seat["m0"], self.picks[0])

        self.assertEqual((400, "item_not_available"), (refused.exception.status_code, refused.exception.detail))

    async def test_two_members_racing_for_one_hero_the_first_lock_wins(self) -> None:
        await self.ban_through()
        seat = await self.member_seats()
        async with self.Session() as blocker:
            # Both requests are in flight together: each waits on the room lock this session holds.
            await blocker.execute(
                sa.select(models.Encounter.id).where(models.Encounter.id == self.encounter_id).with_for_update()
            )
            racing = [asyncio.create_task(self.pick(who, seat[who], self.picks[0])) for who in ("m0", "m2")]
            await asyncio.sleep(0.2)
            self.assertFalse(any(task.done() for task in racing))
            await blocker.commit()
        results = await asyncio.gather(*racing, return_exceptions=True)

        refused = [result for result in results if isinstance(result, BaseAPIException)]
        self.assertEqual([(400, "item_not_available")], [(error.status_code, error.detail) for error in refused])
        winner = "m0" if not isinstance(results[0], BaseException) else "m2"
        self.assertEqual({self.picks[0]: seat[winner]}, await self.picked_for())

    async def test_the_clock_picks_for_every_member_who_has_not(self) -> None:
        await self.ban_through()
        seat = await self.member_seats()
        await self.pick("m0", seat["m0"], self.picks[0])

        await self.run_out_the_clock()

        picked = await self.picked_for()
        self.assertEqual(sorted(seat.values()), sorted(picked.values()))
        self.assertEqual(seat["m0"], picked[self.picks[0]])
        self.assertEqual(enums.MapVetoSessionStatus.COMPLETED, (await self.hero_session()).status)


class MixFearlessTests(MixPickRoomCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            (await s.get_one(models.CustomGame, self.mix_id)).hero_fearless = True
            await s.commit()

    async def record_and_start_again(self) -> int:
        """Record this match (``mix.round``) and start the next one on the same lineup; returns the recorded one."""
        recorded = self.encounter_id
        async with self.Session() as s:
            s.add(models.CustomGameRound(encounter_id=recorded, lobby_index=0))
            encounter = models.Encounter(
                workspace_id=self.ids["ws"],
                discipline="deadlock",
                custom_game_id=self.mix_id,
                scoring_rule_id=self.ids["rule"],
                name="T1 vs T2",
                slot_count=2,
                best_of=1,
                status=enums.EncounterStatus.OPEN,
            )
            s.add(encounter)
            await s.flush()
            self.seats = []
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
            (await s.get_one(models.CustomGameLobby, (self.mix_id, 0))).live_encounter_id = encounter.id
            await s.commit()
            self.encounter_id = encounter.id
        return recorded

    async def test_a_player_cannot_pick_a_hero_they_played_earlier_in_the_mix(self) -> None:
        await self.everyone_picks()
        await self.record_and_start_again()
        await self.ban_through()
        seat = await self.member_seats()

        with self.assertRaises(BaseAPIException) as refused:
            await self.pick("m0", seat["m0"], self.picks[0])
        # Teams reshuffle: the hero is only m0's to lose.
        await self.pick("m2", seat["m2"], self.picks[0])

        self.assertEqual((400, "item_not_eligible"), (refused.exception.status_code, refused.exception.detail))
        self.assertEqual(seat["m2"], (await self.picked_for())[self.picks[0]])

    async def test_an_undone_round_gives_its_heroes_back(self) -> None:
        await self.everyone_picks()
        recorded = await self.record_and_start_again()
        async with self.Session() as s:
            # What Undo does (``CustomGameRoundRepository.delete_round``): the round's encounter goes, with its picks.
            await s.execute(sa.delete(models.Encounter).where(models.Encounter.id == recorded))
            await s.commit()
        await self.ban_through()
        seat = await self.member_seats()

        await self.pick("m0", seat["m0"], self.picks[0])

        self.assertEqual(seat["m0"], (await self.picked_for())[self.picks[0]])

    async def test_the_clock_gives_every_owing_member_a_hero_they_may_play_when_one_exists(self) -> None:
        # Round 1: m0..m3 play picks 0..3, so Fearless takes each off the one they played.
        await self.everyone_picks()
        await self.record_and_start_again()
        async with self.Session() as s:
            # Round 2's pool after the bans is picks 0..3 alone.
            await s.execute(
                sa.update(models.CatalogEntity).where(models.CatalogEntity.id.in_(self.picks[4:])).values(active=False)
            )
            await s.commit()
        await self.ban_through()
        seat = await self.member_seats()
        await self.pick("m0", seat["m0"], self.picks[1])
        await self.pick("m1", seat["m1"], self.picks[2])

        # Left: picks 0 and 3. m2 may play either; m3 only pick 0 -- a stand-in giving m2 pick 0 would strand m3.
        await self.run_out_the_clock()

        self.assertEqual(
            {
                self.picks[1]: seat["m0"],
                self.picks[2]: seat["m1"],
                self.picks[3]: seat["m2"],
                self.picks[0]: seat["m3"],
            },
            await self.picked_for(),
        )
