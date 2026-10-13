"""DB guarantees of mix rounds on the encounter layer (D71-D74, D79). Needs the test Postgres; skips otherwise."""

from __future__ import annotations

import os

import sqlalchemy as sa
from sqlalchemy.exc import DBAPIError

from shared.models.custom_game import CustomGame, MixRound, MixRoundMember
from shared.models.encounter import ScoringRule
from shared.models.tenancy.workspace import Workspace
from shared.tests.encounter_writer_case import WINS_END, EncounterWriterCase


class MixRoundConstraintTests(EncounterWriterCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            mix = await self.mix_encounter(s)
            s.add(MixRound(encounter_id=mix.id, lobby_index=0, points_per_win_applied=None))
            await s.commit()
            self.ids["mix"] = mix.id
            self.ids["cg"] = mix.custom_game_id

    async def _rejected(self, sql: str, constraint: str, **params: int) -> None:
        async with self.Session() as s:
            with self.assertRaises(DBAPIError) as ctx:  # IntegrityError is a DBAPIError
                await s.execute(sa.text(sql), {**self.ids, **params})
                await s.commit()  # deferred FKs fire at commit
            self.assertIn(constraint, str(ctx.exception))

    async def _scalar(self, sql: str, **params: int):
        async with self.Session() as s:
            return (await s.execute(sa.text(sql), {**self.ids, **params})).scalar_one()

    async def _foreign_workspace(self) -> tuple[int, int]:
        """A second workspace with its own rule and mix: ``(rule_id, custom_game_id)``."""
        async with self.Session() as s:
            other = Workspace(slug=f"mixc-{os.getpid()}-{self.ids['ws']}", name="other")
            s.add(other)
            await s.flush()
            self.workspaces.append(other.id)
            rule = ScoringRule(workspace_id=other.id, preset="wins", game_formula="win", end_formula=WINS_END)
            s.add(rule)
            await s.flush()
            foreign = CustomGame(workspace_id=other.id, name="Other", scoring_rule_id=rule.id)
            s.add(foreign)
            await s.commit()
            return rule.id, foreign.id

    async def test_an_encounter_cannot_have_two_owners(self) -> None:
        await self._rejected("UPDATE encounter.encounter SET custom_game_id = :cg WHERE id = :e", "ck_encounter_owner")

    async def test_an_encounter_cannot_have_no_owner(self) -> None:
        await self._rejected(
            "UPDATE encounter.encounter SET custom_game_id = NULL WHERE id = :mix", "ck_encounter_owner"
        )

    async def test_a_mix_owner_must_share_the_encounters_workspace(self) -> None:
        _rule, foreign = await self._foreign_workspace()
        await self._rejected(
            "UPDATE encounter.encounter SET custom_game_id = :foreign WHERE id = :mix",
            "fk_encounter_custom_game",
            foreign=foreign,
        )

    async def test_a_mix_participation_has_no_tournament_and_no_source_team(self) -> None:
        self.assertEqual(
            2,
            await self._scalar(
                "SELECT count(*) FROM encounter.team WHERE encounter_id = :mix AND tournament_id IS NULL AND team_id IS NULL"
            ),
        )

    async def test_a_busy_member_carries_no_rank_delta(self) -> None:
        await self._rejected(
            "INSERT INTO balancer.mix_round_member (encounter_id, workspace_member_id, busy, rank_delta_applied)"
            " VALUES (:mix, :m0, true, 5)",
            "ck_mix_round_member_busy",
        )

    async def test_a_round_sits_in_one_of_six_lobbies(self) -> None:
        await self._rejected(
            "UPDATE balancer.mix_round SET lobby_index = 6 WHERE encounter_id = :mix", "ck_mix_round_lobby_index"
        )

    async def test_deleting_a_mix_deletes_its_rounds(self) -> None:
        async with self.Session() as s:
            s.add(
                MixRoundMember(
                    encounter_id=self.ids["mix"], workspace_member_id=self.ids["m0"], busy=False, rank_delta_applied=3
                )
            )
            await s.commit()
        async with self.Session() as s:
            await s.execute(sa.delete(CustomGame).where(CustomGame.id == self.ids["cg"]))
            await s.commit()
        self.assertEqual(0, await self._scalar("SELECT count(*) FROM encounter.encounter WHERE id = :mix"))
        for table in ("encounter.team", "balancer.mix_round", "balancer.mix_round_member"):
            self.assertEqual(0, await self._scalar(f"SELECT count(*) FROM {table} WHERE encounter_id = :mix"))

    async def test_host_is_a_result_source_of_the_encounter_and_of_a_game(self) -> None:
        async with self.Session() as s:
            await s.execute(
                sa.text(
                    "UPDATE encounter.encounter SET status = 'COMPLETED', result_status = 'confirmed',"
                    " result_source = 'host' WHERE id = :mix"
                ),
                self.ids,
            )
            await s.execute(
                sa.text(
                    "INSERT INTO encounter.game (encounter_id, position, state, result_source, confirmed_at)"
                    " VALUES (:mix, 1, 'confirmed', 'host', now())"
                ),
                self.ids,
            )
            await s.commit()
        self.assertEqual("host", await self._scalar("SELECT result_source FROM encounter.encounter WHERE id = :mix"))
        self.assertEqual(
            "host", await self._scalar("SELECT result_source::text FROM encounter.game WHERE encounter_id = :mix")
        )

    async def test_a_mix_rule_belongs_to_the_mix_workspace(self) -> None:
        foreign_rule, _foreign = await self._foreign_workspace()
        await self._rejected(
            "UPDATE balancer.custom_game SET scoring_rule_id = :foreign_rule WHERE id = :cg",
            "fk_custom_game_scoring_rule",
            foreign_rule=foreign_rule,
        )

    async def test_six_lobbies_name_twelve_teams(self) -> None:
        async with self.Session() as s:
            await s.execute(
                sa.text(
                    "INSERT INTO balancer.custom_game_team_name (custom_game_id, team_index, name) VALUES (:cg, 11, 'L')"
                ),
                self.ids,
            )
            await s.commit()
        await self._rejected(
            "INSERT INTO balancer.custom_game_team_name (custom_game_id, team_index, name) VALUES (:cg, 12, 'M')",
            "ck_custom_game_team_name_index",
        )
