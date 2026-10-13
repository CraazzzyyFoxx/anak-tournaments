"""A player merge must not strand ``encounter.team_member`` snapshots (D66).

The source player is deleted and its ``workspace_member`` rows cascade away; the
roster FK has no cascade, so the merge first hands the source's members (and the
seats on them) to the survivor. Real PostgreSQL; the case rolls back.
"""

import asyncio
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import enums
from shared.models.custom_game import CustomGame, MixRound, MixRoundMember
from shared.models.encounter import Encounter, EncounterTeam, EncounterTeamMember, ScoringRule
from shared.testing.db import create_test_async_engine, ensure_test_postgres
from src import schemas
from src.services.admin.user_merge import UserMergeService

_WINS_END = "games >= best_of or max_wins * 2 > best_of"


class UserMergeRosterTests(IsolatedAsyncioTestCase):
    loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self):
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.connection = await self.engine.connect()
        self.transaction = await self.connection.begin()
        self.session = AsyncSession(
            bind=self.connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        self.merges = UserMergeService()
        tag = uuid4().hex
        self.source = models.User(name=f"source-{tag}")
        self.target = models.User(name=f"target-{tag}")
        self.workspace = models.Workspace(name="Merge roster", slug=f"merge-roster-{tag}")
        self.session.add_all([self.source, self.target, self.workspace])
        await self.session.flush()
        tournament = models.Tournament(
            workspace_id=self.workspace.id,
            discipline="overwatch",
            name=tag,
            slug=tag,
            status=enums.TournamentStatus.LIVE,
        )
        rule = ScoringRule(workspace_id=self.workspace.id, preset="wins", game_formula="win", end_formula=_WINS_END)
        self.session.add_all([tournament, rule])
        await self.session.flush()
        self.tournament_id, self.rule_id = tournament.id, rule.id

    async def asyncTearDown(self):
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    async def _seat(self, encounter_id, slot, member_id) -> EncounterTeamMember:
        team = EncounterTeam(encounter_id=encounter_id, tournament_id=self.tournament_id, slot=slot, name=f"T{slot}")
        self.session.add(team)
        await self.session.flush()
        seat = EncounterTeamMember(
            encounter_id=encounter_id,
            encounter_team_id=team.id,
            active=True,
            workspace_member_id=member_id,
            display_name_snapshot=f"m{member_id}",
        )
        self.session.add(seat)
        await self.session.flush()
        return seat

    async def _encounter(self, name) -> int:
        encounter = Encounter(
            workspace_id=self.workspace.id,
            discipline="overwatch",
            tournament_id=self.tournament_id,
            scoring_rule_id=self.rule_id,
            name=name,
            slot_count=2,
            status=enums.EncounterStatus.OPEN,
        )
        self.session.add(encounter)
        await self.session.flush()
        return encounter.id

    async def _merge(self) -> None:
        preview = await self.merges.preview_merge(
            self.session,
            schemas.UserMergePreviewRequest(source_user_id=self.source.id, target_user_id=self.target.id),
        )
        await self.merges.execute_merge(
            self.session,
            schemas.UserMergeExecuteRequest(
                source_user_id=self.source.id,
                target_user_id=self.target.id,
                preview_fingerprint=preview.preview_fingerprint,
                field_policy={},
                identity_selection={},
            ),
            operator_auth_user_id=None,
        )
        # The roster FK is DEFERRED: fire it now, as the outer commit would in production.
        await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))

    async def _owners(self) -> dict[str, int]:
        rows = await self.session.execute(
            sa.select(EncounterTeamMember.display_name_snapshot, models.WorkspaceMember.player_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == EncounterTeamMember.workspace_member_id)
            .where(EncounterTeamMember.encounter_id.in_(self._encounters))
        )
        return dict(rows.all())

    async def test_merging_a_rostered_player_without_a_survivor_member_repoints_the_member_row(self):
        source_member = models.WorkspaceMember(workspace_id=self.workspace.id, player_id=self.source.id)
        self.session.add(source_member)
        await self.session.flush()
        self._encounters = [await self._encounter("E1")]
        await self._seat(self._encounters[0], 1, source_member.id)

        await self._merge()

        self.assertEqual({f"m{source_member.id}": self.target.id}, await self._owners())
        self.assertEqual(
            self.target.id,
            await self.session.scalar(
                sa.select(models.WorkspaceMember.player_id).where(models.WorkspaceMember.id == source_member.id)
            ),
        )

    async def test_merging_onto_a_survivor_member_moves_seats_and_drops_a_duplicate_seat(self):
        source_member = models.WorkspaceMember(workspace_id=self.workspace.id, player_id=self.source.id)
        target_member = models.WorkspaceMember(workspace_id=self.workspace.id, player_id=self.target.id)
        self.session.add_all([source_member, target_member])
        await self.session.flush()
        shared_encounter = await self._encounter("shared")
        own_encounter = await self._encounter("own")
        self._encounters = [shared_encounter, own_encounter]
        # Both sat in ``shared``: the source seat duplicates the survivor's and goes.
        await self._seat(shared_encounter, 1, source_member.id)
        survivor_seat = await self._seat(shared_encounter, 2, target_member.id)
        moved_seat = await self._seat(own_encounter, 1, source_member.id)

        await self._merge()

        seats = (
            await self.session.execute(
                sa.select(EncounterTeamMember.id, EncounterTeamMember.workspace_member_id).where(
                    EncounterTeamMember.encounter_id.in_(self._encounters)
                )
            )
        ).all()
        self.assertEqual(
            {(survivor_seat.id, target_member.id), (moved_seat.id, target_member.id)},
            set(seats),
        )
        self.assertIsNone(
            await self.session.scalar(
                sa.select(models.WorkspaceMember.id).where(models.WorkspaceMember.id == source_member.id)
            )
        )

    async def test_merging_onto_a_survivor_member_moves_mix_round_rows_and_drops_a_duplicate(self):
        source_member = models.WorkspaceMember(workspace_id=self.workspace.id, player_id=self.source.id)
        target_member = models.WorkspaceMember(workspace_id=self.workspace.id, player_id=self.target.id)
        mix_rule = ScoringRule(workspace_id=self.workspace.id, preset="wins", game_formula="win", end_formula=_WINS_END)
        self.session.add_all([source_member, target_member, mix_rule])
        await self.session.flush()
        mix = CustomGame(workspace_id=self.workspace.id, name="Mix", scoring_rule_id=mix_rule.id)
        self.session.add(mix)
        await self.session.flush()
        rounds = []
        for name in ("shared", "own"):
            encounter = Encounter(
                workspace_id=self.workspace.id,
                discipline="overwatch",
                custom_game_id=mix.id,
                scoring_rule_id=mix_rule.id,
                name=name,
                slot_count=2,
                best_of=1,
                status=enums.EncounterStatus.OPEN,
            )
            self.session.add(encounter)
            await self.session.flush()
            self.session.add(MixRound(encounter_id=encounter.id, lobby_index=0))
            rounds.append(encounter.id)
        await self.session.flush()
        shared_round, own_round = rounds
        self.session.add_all(
            [
                MixRoundMember(encounter_id=shared_round, workspace_member_id=source_member.id, busy=True),
                MixRoundMember(
                    encounter_id=shared_round, workspace_member_id=target_member.id, busy=False, rank_delta_applied=4
                ),
                MixRoundMember(
                    encounter_id=own_round, workspace_member_id=source_member.id, busy=False, rank_delta_applied=-3
                ),
            ]
        )
        await self.session.flush()

        await self._merge()

        rows = (
            await self.session.execute(
                sa.select(
                    MixRoundMember.encounter_id, MixRoundMember.workspace_member_id, MixRoundMember.rank_delta_applied
                ).where(MixRoundMember.encounter_id.in_(rounds))
            )
        ).all()
        self.assertEqual({(shared_round, target_member.id, 4), (own_round, target_member.id, -3)}, set(rows))
