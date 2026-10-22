"""One mix match on the encounter layer -- started, then recorded or thrown away -- and the reads every mix screen
makes of it (D74-D76)."""

from __future__ import annotations

import asyncio
import sys
from dataclasses import replace
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
for candidate in (str(REPO_BACKEND_ROOT), str(REPO_BACKEND_ROOT / "balancer-service")):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import sqlalchemy as sa  # noqa: E402

from shared import models  # noqa: E402
from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from shared.disciplines import DISCIPLINES  # noqa: E402
from shared.domain.custom_game_round import winner_slot  # noqa: E402
from shared.repository import CatalogRoleRepository, CustomGamePlayerRepository, CustomGameRoundRepository  # noqa: E402
from shared.tests.encounter_writer_case import EncounterWriterCase  # noqa: E402
from src.domain.balancer.result_serializer import lobby_document  # noqa: E402
from src.services.custom_game import CustomGameService  # noqa: E402
from src.services.mix_ranker import mix_ranker_service  # noqa: E402
from src.services.mix_rounds import (  # noqa: E402
    MixMatchDraft,
    MixMatchSeat,
    MixResultDraft,
    record_mix_result,
    start_mix_match,
)


class CustomGameRoundStoreTests(EncounterWriterCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            mix = await self.mix_encounter(s)  # brings the custom game and its rule
            self.cg = await s.get_one(models.CustomGame, mix.custom_game_id)
            await s.execute(sa.delete(models.Encounter).where(models.Encounter.id == mix.id))
            await s.commit()
        self.rounds = CustomGameRoundRepository()

    def _draft(self, *, lobby=0, winner=1, busy=frozenset(), deltas=(None, None), points=25, map_id=None):
        """One match of this mix as Start and Record are handed it: ``(MixMatchDraft, the result's fields)``."""
        m0, m1, m2 = (self.ids[f"m{i}"] for i in range(3))
        match = MixMatchDraft(
            custom_game_id=self.cg.id,
            workspace_id=self.ids["ws"],
            discipline="overwatch",
            scoring_rule_id=self.cg.scoring_rule_id,
            map_id=map_id,
            names=("Wolves", "Team 2"),
            seats=(
                (MixMatchSeat(m0, "Alpha", "tank", 3200, is_captain=True), MixMatchSeat(m1, "Bravo", None, 2900)),
                (MixMatchSeat(m2, "Charlie", "tank", 2600, is_captain=True),),
            ),
        )
        result = {
            "lobby_index": lobby,
            "names": ("Wolves", "Team 2"),
            "winner_slot": winner,
            "points_per_win_applied": points,
            "rank_deltas": {member: delta for member, delta in ((m0, deltas[0]), (m2, deltas[1])) if delta is not None},
            "busy": busy,
            "recorder_player_id": self.users[0],
        }
        return match, result

    async def _record(self, draft) -> int:
        """Start, then Record: what one played match of a lobby writes."""
        match, result = draft
        async with self.Session() as s:
            encounter = await start_mix_match(s, match)
            await record_mix_result(s, MixResultDraft(encounter_id=encounter.id, **result))
            await s.commit()
            return encounter.id

    async def _rows(self, sql: str, **params):
        async with self.Session() as s:
            return (await s.execute(sa.text(sql), params)).all()

    async def test_a_round_is_a_completed_host_encounter_of_its_mix(self) -> None:
        encounter_id = await self._record(self._draft())
        [row] = await self._rows(
            "SELECT tournament_id, custom_game_id, slot_count, best_of, name, status::text, result_status::text,"
            " result_source, result_version FROM encounter.encounter WHERE id = :id",
            id=encounter_id,
        )
        self.assertEqual((None, self.cg.id, 2, 1, "Wolves vs Team 2", "COMPLETED", "confirmed", "host", 1), tuple(row))
        self.assertEqual(
            [(1, "Wolves", 1.0, 1), (2, "Team 2", 0.0, 2)],
            [
                tuple(r)
                for r in await self._rows(
                    "SELECT slot, name, score, placement FROM encounter.team WHERE encounter_id = :id ORDER BY slot",
                    id=encounter_id,
                )
            ],
        )
        self.assertEqual(
            [("confirmed", "host", 1, 1, 0)],
            [
                tuple(r)
                for r in await self._rows(
                    "SELECT g.state::text, g.result_source::text, g.position, max(gt.score), min(gt.score)"
                    " FROM encounter.game g JOIN encounter.game_team gt ON gt.game_id = g.id WHERE g.encounter_id = :id"
                    " GROUP BY g.id",
                    id=encounter_id,
                )
            ],
        )
        self.assertEqual(
            [(1, self.users[0], "confirm", "host")],
            [
                tuple(r)
                for r in await self._rows(
                    "SELECT result_version, actor_user_id, action::text, source FROM encounter.result_audit"
                    " WHERE encounter_id = :id",
                    id=encounter_id,
                )
            ],
        )

    async def test_a_started_match_is_open_captained_and_invisible_to_every_round_read(self) -> None:
        match, _result = self._draft()
        async with self.Session() as s:
            encounter = await start_mix_match(s, match)
            await s.commit()

        [row] = await self._rows(
            "SELECT status::text, result_status::text, started_at IS NOT NULL FROM encounter.encounter WHERE id = :id",
            id=encounter.id,
        )
        self.assertEqual(("OPEN", "none", True), tuple(row))
        self.assertEqual(
            [("awaiting_result",)],
            [
                tuple(r)
                for r in await self._rows(
                    "SELECT state::text FROM encounter.game WHERE encounter_id = :id", id=encounter.id
                )
            ],
        )
        self.assertEqual(
            [(self.ids["m0"], True), (self.ids["m1"], False), (self.ids["m2"], True)],
            [
                tuple(r)
                for r in await self._rows(
                    "SELECT workspace_member_id, is_captain FROM encounter.team_member WHERE encounter_id = :id"
                    " ORDER BY workspace_member_id",
                    id=encounter.id,
                )
            ],
        )
        async with self.Session() as s:
            self.assertEqual([], list(await self.rounds.list_for_custom_game(s, self.cg.id)))
            self.assertEqual([], list(await self.rounds.seats(s, workspace_id=self.ids["ws"])))
            self.assertIsNone(await self.rounds.newest_id_for_lobby(s, self.cg.id, 0))

    async def test_seats_keep_their_role_rank_and_frozen_delta(self) -> None:
        encounter_id = await self._record(self._draft(deltas=(31, -28), points=None))
        seats = await self._rows(
            "SELECT tm.workspace_member_id, tm.display_name_snapshot, tm.rank, cr.code, rm.busy, rm.rank_delta_applied"
            " FROM encounter.team_member tm LEFT JOIN encounter.team_member_role r ON r.team_member_id = tm.id"
            " LEFT JOIN catalog.role cr ON cr.id = r.role_id"
            " JOIN mix.round_member rm ON rm.encounter_id = tm.encounter_id"
            " AND rm.workspace_member_id = tm.workspace_member_id WHERE tm.encounter_id = :id"
            " ORDER BY tm.workspace_member_id",
            id=encounter_id,
        )
        self.assertEqual(
            [
                (self.ids["m0"], "Alpha", 3200, "tank", False, 31),
                (self.ids["m1"], "Bravo", 2900, None, False, None),
                (self.ids["m2"], "Charlie", 2600, "tank", False, -28),
            ],
            [tuple(r) for r in seats],
        )

    async def test_seat_reads_use_the_encounters_rated_dimension_without_fanning_out(self) -> None:
        async with self.Session() as s:
            catalog = CatalogRoleRepository()
            await catalog.project_module(s, DISCIPLINES["lol"])
            mix = await s.get_one(models.CustomGame, self.cg.id)
            mix.discipline = "lol"
            # Persist the setup first: unit-of-work order between unrelated mappers is not a contract.
            await s.flush()
            match, result = self._draft()
            match = replace(
                match,
                discipline="lol",
                seats=(
                    (
                        MixMatchSeat(self.ids["m0"], "Alpha", "support", 3200),
                        MixMatchSeat(self.ids["m1"], "Bravo", "flex", 2900),
                    ),
                    (MixMatchSeat(self.ids["m2"], "Charlie", None, 2600),),
                ),
            )
            encounter = await start_mix_match(s, match)
            await record_mix_result(s, MixResultDraft(encounter_id=encounter.id, **result))
            trait = models.RoleDimension(discipline="lol", code="trait", name="Trait", selection_mode="single")
            s.add(trait)
            await s.flush()
            role = models.CatalogRole(dimension_id=trait.id, code="caller", name="Caller")
            s.add(role)
            await s.flush()
            ow = await catalog.resolve(s, discipline="overwatch", workspace_id=None, dimension=None, code="tank")
            members = (
                await s.scalars(
                    sa.select(models.EncounterTeamMember).where(models.EncounterTeamMember.encounter_id == encounter.id)
                )
            ).all()
            for member in members:
                s.add(models.EncounterTeamMemberRole(team_member_id=member.id, dimension_id=trait.id, role_id=role.id))
                s.add(
                    models.EncounterTeamMemberRole(
                        team_member_id=member.id, dimension_id=ow.dimension_id, role_id=ow.id
                    )
                )
            await s.flush()
            rows = await self.rounds.seats(s, workspace_id=self.ids["ws"], encounter_id=encounter.id)
            assert [(row.workspace_member_id, row.role) for row in rows] == [
                (self.ids["m0"], "support"),
                (self.ids["m1"], None),
                (self.ids["m2"], None),
            ]

    async def test_a_busy_member_who_is_seated_counts_as_seated(self) -> None:
        encounter_id = await self._record(self._draft(busy=frozenset({self.ids["m3"], self.ids["m1"]})))
        self.assertEqual(
            [(self.ids["m0"], False), (self.ids["m1"], False), (self.ids["m2"], False), (self.ids["m3"], True)],
            [
                tuple(r)
                for r in await self._rows(
                    "SELECT workspace_member_id, busy FROM mix.round_member WHERE encounter_id = :id"
                    " ORDER BY workspace_member_id",
                    id=encounter_id,
                )
            ],
        )

    async def test_a_draw_is_nil_nil_and_both_teams_share_first_place(self) -> None:
        encounter_id = await self._record(self._draft(winner=None, points=None))
        self.assertEqual(
            [(0.0, 1), (0.0, 1)],
            [
                tuple(r)
                for r in await self._rows(
                    "SELECT score, placement FROM encounter.team WHERE encounter_id = :id ORDER BY slot",
                    id=encounter_id,
                )
            ],
        )

    async def test_lobby_reads_go_newest_first_and_count_per_lobby(self) -> None:
        first = await self._record(self._draft(lobby=0))
        second = await self._record(self._draft(lobby=0))
        other = await self._record(self._draft(lobby=1))
        async with self.Session() as s:
            listed = await self.rounds.list_for_custom_game(s, self.cg.id)
            self.assertEqual([other, second, first], [r.encounter_id for r in listed])
            self.assertEqual(["Wolves", "Team 2"], [team.name for team in listed[0].encounter.teams])
            self.assertEqual(self.users[0], listed[0].encounter.result_audit[0].actor_user_id)
            self.assertEqual(second, await self.rounds.newest_id_for_lobby(s, self.cg.id, 0))
            self.assertEqual(
                {0: 2, 1: 1}, {k: v[0] for k, v in (await self.rounds.activity_for_lobbies(s, self.cg.id)).items()}
            )
            self.assertEqual(3, (await self.rounds.activity_for_games(s, [self.cg.id]))[self.cg.id][0])
            self.assertIsNone(await self.rounds.get_for_game(s, self.cg.id + 1000, first))
            self.assertEqual(first, (await self.rounds.get_for_game(s, self.cg.id, first)).encounter_id)

    async def test_the_list_reads_group_lobbies_seats_maps_and_roster_per_mix(self) -> None:
        tag = f"cgr-{self.ids['ws']}"
        async with self.Session() as s:
            oasis, ilios = (
                models.CatalogEntity(
                    discipline="overwatch",
                    kind="map",
                    slug=f"{tag}-{name}",
                    name=f"{tag} {name}",
                    image_path=f"{name}.png",
                )
                for name in ("oasis", "ilios")
            )
            s.add_all([oasis, ilios])
            s.add_all(
                [
                    models.CustomGamePlayer(custom_game_id=self.cg.id, workspace_member_id=self.ids[f"m{i}"])
                    for i in range(4)
                ]
            )
            await s.commit()
        # The game rows hold the maps (RESTRICT): they go with the workspace in asyncTearDown, the maps after it.
        self.addAsyncCleanup(self._drop_maps, [oasis.id, ilios.id])

        await self._record(self._draft(lobby=0, map_id=oasis.id))
        await self._record(self._draft(lobby=0, busy=frozenset({self.ids["m3"]}), map_id=ilios.id))
        await self._record(self._draft(lobby=1, map_id=oasis.id))
        await self._record(self._draft(lobby=1))  # no map rolled
        async with self.Session() as s:
            lobbies = await self.rounds.lobby_activity_for_games(s, [self.cg.id, self.cg.id + 1000])
            self.assertEqual(
                {self.cg.id: {0: 2, 1: 2}}, {g: {k: v[0] for k, v in by.items()} for g, by in lobbies.items()}
            )
            # m0, m1, m2 sat; m3 was only ever busy next door.
            self.assertEqual({self.cg.id: 3}, await self.rounds.player_counts_for_games(s, [self.cg.id]))
            # Distinct maps, the most recently played first -- not first-played, not alphabetical.
            self.assertEqual(
                {self.cg.id: [(oasis.name, "oasis.png"), (ilios.name, "ilios.png")]},
                await self.rounds.maps_for_games(s, [self.cg.id]),
            )
            self.assertEqual({self.cg.id: 4}, await CustomGamePlayerRepository().counts_for_games(s, [self.cg.id]))
            for read in (
                self.rounds.lobby_activity_for_games,
                self.rounds.player_counts_for_games,
                self.rounds.maps_for_games,
            ):
                self.assertEqual({}, await read(s, []))

    async def _drop_maps(self, map_ids: list[int]) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.CatalogEntity).where(models.CatalogEntity.id.in_(map_ids)))
            await s.commit()
        await self.engine.dispose()

    async def test_seat_rows_carry_both_sides_of_the_result(self) -> None:
        encounter_id = await self._record(self._draft(deltas=(5, None)))
        async with self.Session() as s:
            rows = await self.rounds.seats(s, workspace_id=self.ids["ws"], encounter_id=encounter_id)
        self.assertEqual(
            [
                (1, self.ids["m0"], "tank", 3200, 5, 1.0, 0.0),
                (1, self.ids["m1"], None, 2900, None, 1.0, 0.0),
                (2, self.ids["m2"], "tank", 2600, None, 0.0, 1.0),
            ],
            [
                (r.slot, r.workspace_member_id, r.role, r.rank, r.rank_delta_applied, r.own_score, r.other_score)
                for r in rows
            ],
        )

    async def test_the_winner_slot_is_read_off_the_seat_scores(self) -> None:
        for winner in (1, 2, None):
            encounter_id = await self._record(self._draft(winner=winner, points=None))
            async with self.Session() as s:
                rows = await self.rounds.seats(s, workspace_id=self.ids["ws"], encounter_id=encounter_id)
            self.assertEqual({winner}, {winner_slot(r.slot, r.own_score, r.other_score) for r in rows})

    async def test_deleting_a_round_removes_everything_it_wrote(self) -> None:
        encounter_id = await self._record(self._draft(busy=frozenset({self.ids["m3"]})))
        async with self.Session() as s:
            await self.rounds.delete_round(s, encounter_id)
            await s.commit()
        for table, column in (
            ("encounter.encounter", "id"),
            ("encounter.team_member", "encounter_id"),
            ("encounter.game", "encounter_id"),
            ("encounter.result_audit", "encounter_id"),
            ("mix.round", "encounter_id"),
            ("mix.round_member", "encounter_id"),
        ):
            [(count,)] = await self._rows(f"SELECT count(*) FROM {table} WHERE {column} = :id", id=encounter_id)
            self.assertEqual(0, count, table)

    async def _new_mix(self) -> int:
        """Another mix of this workspace, on this mix's rule."""
        async with self.Session() as s:
            mix = models.CustomGame(
                workspace_id=self.ids["ws"], name="Next door", scoring_rule_id=self.cg.scoring_rule_id
            )
            s.add(mix)
            await s.commit()
            return mix.id

    async def _lobbies(self, *pairings: tuple[str, str], game_id: int | None = None) -> None:
        """Give a mix -- this one unless ``game_id`` names another -- one lobby per pairing: lobby ``i`` shows a 1v1
        of its two members (``"m0"``..``"m3"``)."""
        game_id = self.cg.id if game_id is None else game_id
        async with self.Session() as s:
            mix = await s.get_one(models.CustomGame, game_id)
            mix.lobby_count = len(pairings)
            for index, pairing in enumerate(pairings):
                teams = [
                    {"roster": {"tank": [{"uuid": str(self.ids[member]), "assigned_rating": 2500}]}}
                    for member in pairing
                ]
                s.add(
                    models.CustomGameLobby(
                        custom_game_id=game_id,
                        lobby_index=index,
                        balance_result_json=lobby_document([{"teams": teams}]),
                    )
                )
            await s.commit()

    def _host(self, lobby_index: int | None = None, *, game_id: int | None = None) -> dict[str, object]:
        """A write of a mix (this one unless ``game_id`` names another) by a superuser -- no co-host grant to seed --
        on one lobby when ``lobby_index`` is given."""
        args: dict[str, object] = {
            "workspace_id": self.ids["ws"],
            "custom_game_id": self.cg.id if game_id is None else game_id,
            "actor_user_id": 0,
            "actor_is_superuser": True,
        }
        return args if lobby_index is None else {**args, "lobby_index": lobby_index}

    async def _write(self, write, lobby_index: int, *, game_id: int | None = None, **extra: object) -> None:
        """One host write of a lobby in its own committed transaction, the way an RPC runs it."""
        async with self.Session() as s:
            await write(s, **self._host(lobby_index, game_id=game_id), **extra)
            await s.commit()

    async def _live_ids(self, game_id: int | None = None) -> list[int | None]:
        rows = await self._rows(
            "SELECT live_encounter_id FROM mix.lobby WHERE custom_game_id = :id ORDER BY lobby_index",
            id=self.cg.id if game_id is None else game_id,
        )
        return [live for (live,) in rows]

    async def _hidden_book(self) -> list[tuple]:
        rows = await self._rows(
            "SELECT workspace_member_id, role_id, mu, sigma FROM balancer.member_hidden_rating"
            " WHERE workspace_id = :ws ORDER BY workspace_member_id, role_id",
            ws=self.ids["ws"],
        )
        return [tuple(row) for row in rows]

    async def test_rounds_read_in_the_order_they_were_recorded_not_started(self) -> None:
        await self._lobbies(("m0", "m1"), ("m2", "m3"))
        service = CustomGameService()
        await self._write(service.start_match, 0)
        await self._write(service.start_match, 1)
        a, b = await self._live_ids()
        await self._write(service.record_outcome, 1, winner=1)
        await self._write(service.record_outcome, 0, winner=1)

        self.assertLess(a, b)  # A started first ...
        async with self.Session() as s:
            # ... and was recorded last: the history (and the rotation reading it) has it as the newest round,
            history = await self.rounds.list_for_custom_game(s, self.cg.id)
            self.assertEqual([a, b], [round_.encounter_id for round_ in history])
            # and the replay, the leaderboard and undo read B before it.
            seats = await self.rounds.seats(s, workspace_id=self.ids["ws"])
            self.assertEqual([b, a], list(dict.fromkeys(row.encounter_id for row in seats)))

    async def test_a_rebuild_replays_rounds_in_the_order_they_were_recorded(self) -> None:
        # m0 is on the floor of two mixes at once: A here (against m1), B next door (against m2). B is recorded first.
        other = await self._new_mix()
        await self._lobbies(("m0", "m1"))
        await self._lobbies(("m0", "m2"), game_id=other)
        service = CustomGameService()
        await self._write(service.start_match, 0)
        await self._write(service.start_match, 0, game_id=other)
        [a], [b] = await self._live_ids(), await self._live_ids(other)
        await self._write(service.record_outcome, 0, game_id=other, winner=2)  # m2 beats m0 ...
        await self._write(service.record_outcome, 0, winner=1)  # ... then m0 beats m1
        incremental = await self._hidden_book()

        async with self.Session() as s:
            await mix_ranker_service.rebuild(s, self.ids["ws"])
            await s.commit()

        self.assertLess(a, b)
        self.assertEqual(3, len(incremental))
        self.assertEqual(incremental, await self._hidden_book())
        async with self.Session() as s:
            stats = await service.mix_stats(s, workspace_id=self.ids["ws"], discipline="overwatch", since=None)
        [m0] = [row for row in stats["members"] if row["workspace_member_id"] == self.ids["m0"]]
        # A, recorded last, is m0's newest result: a win on top of B's loss.
        self.assertEqual(([a, b], 1), ([entry["match_id"] for entry in m0["form"]], m0["streak"]))

    async def test_a_second_start_of_a_live_lobby_waits_for_the_first_and_is_refused(self) -> None:
        await self._lobbies(("m0", "m1"))
        service = CustomGameService()
        async with self.Session() as first, self.Session() as second:
            await service.start_match(first, **self._host(0))
            racing = asyncio.create_task(service.start_match(second, **self._host(0)))
            await asyncio.sleep(0.2)
            # The mix row is the first Start's until it commits: the second one waits, it does not race past.
            self.assertFalse(racing.done())
            await first.commit()
            with self.assertRaises(HTTPException) as ctx:
                await racing
            await second.rollback()

        self.assertEqual((409, "match_live"), (ctx.exception.status_code, ctx.exception.detail))
        [(count,)] = await self._rows(
            "SELECT count(*) FROM encounter.encounter WHERE custom_game_id = :id", id=self.cg.id
        )
        self.assertEqual(1, count)
        [live] = await self._live_ids()
        self.assertIsNotNone(live)

    async def test_a_reshape_racing_a_start_waits_for_it_and_is_refused(self) -> None:
        await self._lobbies(("m0", "m1"))
        service = CustomGameService()
        m0, m1 = str(self.ids["m0"]), str(self.ids["m1"])
        reshapes = {
            "swap": (service.swap_seats, {"variant_index": 0, "first_uuid": m0, "second_uuid": m1}),
            "page": (service.set_variant_index, {"variant_index": 0}),
            "balance": (service.balance, {}),
        }
        lineup = "SELECT balance_result_json, selected_variant_index FROM mix.lobby WHERE custom_game_id = :id"
        before = await self._rows(lineup, id=self.cg.id)
        for name, (write, extra) in reshapes.items():
            with self.subTest(name):
                async with self.Session() as first, self.Session() as second:
                    await service.start_match(first, **self._host(0))
                    racing = asyncio.create_task(write(second, **self._host(0), **extra))
                    await asyncio.sleep(0.2)
                    # Start holds the mix row until it commits: the reshape waits, then reads the lobby live.
                    self.assertFalse(racing.done())
                    await first.commit()
                    with self.assertRaises(HTTPException) as ctx:
                        await racing
                    await second.rollback()

                self.assertEqual((409, "match_live"), (ctx.exception.status_code, ctx.exception.detail))
                self.assertEqual(before, await self._rows(lineup, id=self.cg.id))
                await self._write(service.cancel_match, 0)

    async def test_cancel_and_close_leave_no_live_match_and_no_encounter_behind(self) -> None:
        await self._lobbies(("m0", "m1"), ("m2", "m3"))
        service = CustomGameService()
        for lobby_index in (0, 1):
            await self._write(service.start_match, lobby_index)
        started = await self._live_ids()
        self.assertTrue(all(started), started)

        await self._write(service.cancel_match, 0)
        self.assertEqual([None, started[1]], await self._live_ids())
        async with self.Session() as s:
            await service.close(s, **self._host())
            await s.commit()

        self.assertEqual([None, None], await self._live_ids())
        [(status,)] = await self._rows("SELECT status FROM mix.custom_game WHERE id = :id", id=self.cg.id)
        self.assertEqual("completed", status)
        for table, column in (
            ("encounter.encounter", "id"),
            ("encounter.team", "encounter_id"),
            ("encounter.team_member", "encounter_id"),
            ("encounter.game", "encounter_id"),
        ):
            [(count,)] = await self._rows(f"SELECT count(*) FROM {table} WHERE {column} = ANY(:ids)", ids=list(started))
            self.assertEqual(0, count, table)
