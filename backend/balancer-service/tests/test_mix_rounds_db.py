"""One recorded mix round on the encounter layer, and the reads every mix screen makes of it (D74-D76)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
for candidate in (str(REPO_BACKEND_ROOT), str(REPO_BACKEND_ROOT / "balancer-service")):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import sqlalchemy as sa  # noqa: E402

from shared import models  # noqa: E402
from shared.repository import MixRoundRepository  # noqa: E402
from shared.repository.mix_round import winner_slot  # noqa: E402
from shared.tests.encounter_writer_case import EncounterWriterCase  # noqa: E402
from src.services.mix_rounds import MixRoundDraft, MixRoundSeat, record_mix_round  # noqa: E402


class MixRoundStoreTests(EncounterWriterCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            mix = await self.mix_encounter(s)  # brings the custom game and its rule
            self.cg = await s.get_one(models.CustomGame, mix.custom_game_id)
            await s.execute(sa.delete(models.Encounter).where(models.Encounter.id == mix.id))
            await s.commit()
        self.rounds = MixRoundRepository()

    def _draft(self, *, lobby=0, winner=1, busy=frozenset(), deltas=(None, None), points=25) -> MixRoundDraft:
        m0, m1, m2, m3 = (self.ids[f"m{i}"] for i in range(4))
        return MixRoundDraft(
            custom_game_id=self.cg.id,
            workspace_id=self.ids["ws"],
            discipline="overwatch",
            scoring_rule_id=self.cg.scoring_rule_id,
            lobby_index=lobby,
            map_id=None,
            names=("Wolves", "Team 2"),
            seats=(
                (MixRoundSeat(m0, "Alpha", "tank", 3200, deltas[0]), MixRoundSeat(m1, "Bravo", None, 2900)),
                (MixRoundSeat(m2, "Charlie", "tank", 2600, deltas[1]),),
            ),
            winner_slot=winner,
            points_per_win_applied=points,
            busy=busy,
            recorder_player_id=self.users[0],
        )

    async def _record(self, draft: MixRoundDraft) -> int:
        async with self.Session() as s:
            encounter = await record_mix_round(s, draft)
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

    async def test_seats_keep_their_role_rank_and_frozen_delta(self) -> None:
        encounter_id = await self._record(self._draft(deltas=(31, -28), points=None))
        seats = await self._rows(
            "SELECT tm.workspace_member_id, tm.display_name_snapshot, tm.rank, r.role, rm.busy, rm.rank_delta_applied"
            " FROM encounter.team_member tm LEFT JOIN encounter.team_member_role r ON r.team_member_id = tm.id"
            " JOIN balancer.mix_round_member rm ON rm.encounter_id = tm.encounter_id"
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

    async def test_a_busy_member_who_is_seated_counts_as_seated(self) -> None:
        encounter_id = await self._record(self._draft(busy=frozenset({self.ids["m3"], self.ids["m1"]})))
        self.assertEqual(
            [(self.ids["m0"], False), (self.ids["m1"], False), (self.ids["m2"], False), (self.ids["m3"], True)],
            [
                tuple(r)
                for r in await self._rows(
                    "SELECT workspace_member_id, busy FROM balancer.mix_round_member WHERE encounter_id = :id"
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
            ("balancer.mix_round", "encounter_id"),
            ("balancer.mix_round_member", "encounter_id"),
        ):
            [(count,)] = await self._rows(f"SELECT count(*) FROM {table} WHERE {column} = :id", id=encounter_id)
            self.assertEqual(0, count, table)
