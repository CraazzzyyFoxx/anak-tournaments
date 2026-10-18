"""Native game binding and encounter-only substitute snapshots.

Confirmed history survives replacement; unmatched logs stay unlinked.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import sqlalchemy as sa

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))
os.environ["DEBUG"] = "true"

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.repository.stats import IngestJobRepository
from shared.services.encounter import participants
from shared.tests.encounter_writer_case import EncounterWriterCase

models = importlib.import_module("src.models")
encounter_flows = importlib.import_module("src.services.encounter.flows")
match_logs_flows = importlib.import_module("src.services.match_logs.flows")
match_logs_service = importlib.import_module("src.services.match_logs.service")
roster = importlib.import_module("src.services.match_logs.roster")
admin_reads = importlib.import_module("src.services.match_logs.admin_reads")


class ParticipationCase(EncounterWriterCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.Session() as session:
            map_ = models.CatalogEntity(
                discipline="overwatch",
                kind="map",
                slug=f"participation-{self.ids['ws']}",
                name=f"Participation map {self.ids['ws']}",
                attrs={},
                aliases=[],
            )
            session.add(map_)
            await session.flush()
            self.ids["map"] = map_.id
            await session.commit()

    async def asyncTearDown(self):
        try:
            async with self.Session() as session:
                # Map deletion is RESTRICTed until its games are removed.
                await session.execute(sa.delete(models.Encounter).where(models.Encounter.id == self.ids["e"]))
                await session.execute(sa.delete(models.CatalogEntity).where(models.CatalogEntity.id == self.ids["map"]))
                await session.commit()
        finally:
            await super().asyncTearDown()

    async def seat(self, session, slot, team_key, *member_keys):
        return await participants.place_team(
            session,
            await self.encounter(session),
            slot=slot,
            team_id=self.ids[team_key],
            name=team_key.upper(),
            seed=None,
            members=[
                participants.MemberSnapshot(
                    workspace_member_id=self.ids[key],
                    display_name=key,
                    rank=3000,
                    is_substitute=False,
                    roles=(("player_role", "damage"),),
                )
                for key in member_keys
            ],
        )

    async def game(self, session, seats, position=1, *, state=enums.EncounterGameState.PLANNED):
        game = models.EncounterGame(
            encounter_id=self.ids["e"],
            position=position,
            map_id=self.ids["map"],
            state=state,
            result_source=(
                enums.EncounterGameResultSource.ADMIN if state == enums.EncounterGameState.CONFIRMED else None
            ),
            confirmed_at=sa.func.now() if state == enums.EncounterGameState.CONFIRMED else None,
        )
        session.add(game)
        await session.flush()
        session.add_all(
            models.EncounterGameTeam(game_id=game.id, encounter_id=self.ids["e"], encounter_team_id=seat.id)
            for seat in seats
        )
        await session.flush()
        return game

    async def job(self, session):
        job, _ = await IngestJobRepository().create_or_get(
            session,
            workspace_id=self.ids["ws"],
            discipline="overwatch",
            source_kind="manual",
            external_id=None,
            content_hash="a" * 64,
            filename="participant.log",
            raw_ref=f"test/{self.ids['ws']}",
            document_ref=None,
            uploader_user_id=None,
            api_key_id=None,
            hint_tournament_id=self.ids["t"],
            hint_encounter_id=None,
            hint_encounter_game_id=None,
        )
        return job


class ResolutionThroughParticipationsTests(ParticipationCase):
    async def test_a_historical_game_keeps_its_replaced_occupant_not_the_current_slot(self):
        async with self.Session() as session:
            home, away = await self.seat(session, 1, "team0"), await self.seat(session, 2, "team1")
            old = await self.game(session, [home, away], state=enums.EncounterGameState.CONFIRMED)
            job = await self.job(session)
            await participants.vacate_slot(session, await self.encounter(session), slot=2)
            replacement = await self.seat(session, 2, "team2")
            await session.commit()
            resolved = await encounter_flows.resolve_for_log(
                session, (self.ids["team0"], self.ids["team1"]), job=job, map_id=old.map_id, map_pools=[]
            )
            self.assertIsNotNone(resolved)
            self.assertEqual(old.id, resolved[1].id)
            self.assertEqual({home.id, away.id}, {seat.id for seat in resolved[2]})
            self.assertEqual(enums.EncounterGameState.CONFIRMED, resolved[1].state)
            self.assertFalse(away.active)
            self.assertIsNone(
                await encounter_flows.resolve_for_log(
                    session, (self.ids["team0"], self.ids["team2"]), job=job, map_id=old.map_id, map_pools=[]
                )
            )
            self.assertEqual(models.IngestJobStatus.PENDING, job.status)
            self.assertIsNone(job.hint_encounter_game_id)
            self.assertIsNone(
                await session.scalar(sa.select(models.StatsMatch.id).where(models.StatsMatch.ingest_job_id == job.id))
            )
            current = await self.game(session, [home, replacement], position=2)
            await session.commit()
            resolved = await encounter_flows.resolve_for_log(
                session, (self.ids["team2"], self.ids["team0"]), job=job, map_id=old.map_id, map_pools=[]
            )
            self.assertIsNotNone(resolved)
            self.assertEqual(current.id, resolved[1].id)
            self.assertEqual({home.id, replacement.id}, {seat.id for seat in resolved[2]})
            self.assertEqual(enums.EncounterGameState.PLANNED, resolved[1].state)

    async def test_lobbies_and_games_with_three_participants_are_not_duels(self):
        async with self.Session() as session:
            home, away = await self.seat(session, 1, "team0"), await self.seat(session, 2, "team1")
            game = await self.game(session, [home, away])
            job = await self.job(session)
            encounter = await self.encounter(session)
            encounter.slot_count = 4
            await self.seat(session, 3, "team2")
            await self.seat(session, 4, "team3")
            await session.commit()
            self.assertIsNone(
                await encounter_flows.resolve_for_log(
                    session, (self.ids["team0"], self.ids["team1"]), job=job, map_id=game.map_id, map_pools=[]
                )
            )
            self.assertEqual(enums.EncounterGameState.PLANNED, game.state)
            self.assertEqual(models.IngestJobStatus.PENDING, job.status)
            self.assertIsNone(
                await session.scalar(sa.select(models.StatsMatch.id).where(models.StatsMatch.ingest_job_id == job.id))
            )
            job.hint_encounter_id = encounter.id
            await session.flush()
            with self.assertRaises(encounter_flows.errors.ApiHTTPException) as raised:
                await encounter_flows.resolve_for_log(
                    session, (self.ids["team0"], self.ids["team1"]), job=job, map_id=game.map_id, map_pools=[]
                )
            self.assertEqual(422, raised.exception.status_code)
            await session.rollback()

    async def test_three_game_participants_are_not_a_duel_even_with_two_live_slots(self):
        async with self.Session() as session:
            home, away = await self.seat(session, 1, "team0"), await self.seat(session, 2, "team1")
            await participants.vacate_slot(session, await self.encounter(session), slot=2)
            replacement = await self.seat(session, 2, "team2")
            game = await self.game(session, [home, away, replacement])
            job = await self.job(session)
            await session.commit()
            self.assertIsNone(
                await encounter_flows.resolve_for_log(
                    session, (self.ids["team0"], self.ids["team2"]), job=job, map_id=game.map_id, map_pools=[]
                )
            )
            self.assertEqual(enums.EncounterGameState.PLANNED, game.state)
            self.assertEqual(models.IngestJobStatus.PENDING, job.status)
            self.assertIsNone(
                await session.scalar(sa.select(models.StatsMatch.id).where(models.StatsMatch.ingest_job_id == job.id))
            )
            job.hint_encounter_game_id = game.id
            await session.flush()
            with self.assertRaises(encounter_flows.errors.ApiHTTPException) as raised:
                await encounter_flows.resolve_for_log(
                    session, (self.ids["team0"], self.ids["team2"]), job=job, map_id=game.map_id, map_pools=[]
                )
            self.assertEqual(422, raised.exception.status_code)
            await session.rollback()

    async def test_upload_and_resolution_refuse_a_mix_round(self):
        async with self.Session() as session:
            mix_id = (await self.mix_encounter(session)).id
            job = await self.job(session)
            await session.commit()
            with self.assertRaises(BaseAPIException):
                await admin_reads._validate_attached_encounter(
                    session, tournament_id=self.ids["t"], encounter_id=mix_id
                )
            job.hint_encounter_id = mix_id
            with self.assertRaises(encounter_flows.errors.ApiHTTPException):
                await encounter_flows.resolve_for_log(
                    session, (self.ids["team0"], self.ids["team1"]), job=job, map_id=self.ids["map"], map_pools=[]
                )
            await session.rollback()


class SubstituteTests(ParticipationCase):
    def _processor(self):
        processor = match_logs_flows.MatchLogProcessor.__new__(match_logs_flows.MatchLogProcessor)
        processor.tournament = SimpleNamespace(workspace_id=self.ids["ws"], discipline="overwatch")
        processor.job = SimpleNamespace(workspace_id=self.ids["ws"])
        return processor

    async def test_a_substitute_is_snapshotted_once_without_a_tournament_roster_write(self):
        async with self.Session() as session:
            damage = await session.scalar(
                sa.select(models.CatalogRole)
                .join(models.RoleDimension)
                .where(
                    models.RoleDimension.discipline == "overwatch",
                    models.RoleDimension.rated.is_(True),
                    models.CatalogRole.code == "damage",
                    models.CatalogRole.workspace_id.is_(None),
                )
            )
            session.add(
                models.CatalogRole(
                    dimension_id=damage.dimension_id,
                    workspace_id=self.ids["ws"],
                    parent_role_id=damage.id,
                    code="damage_hitscan",
                    name="Hitscan",
                )
            )
            seat = await self.seat(session, 1, "team0", "m0", "m1")
            await self.seat(session, 2, "team1", "m3")
            await session.commit()
            team_id, seat_id = seat.team_id, seat.id
        present = roster.LogPlayer(user_id=self.users[0], team_id=team_id, name="u0", role="damage", rank=3000)
        missing = roster.LogPlayer(
            user_id=self.users[1], team_id=team_id, name="u1", role="damage", sub_role="damage_hitscan", rank=2800
        )
        roster_rows = [
            SimpleNamespace(
                is_substitution=False,
                workspace_member=SimpleNamespace(player_id=p.user_id),
                team_id=p.team_id,
                name=p.name,
                role=p.role,
                sub_role=p.sub_role,
                rank=p.rank,
            )
            for p in (present, missing)
        ]
        for _ in range(2):
            async with self.Session() as session:
                seat = await session.get(models.EncounterTeam, seat_id)
                sub = await session.get(models.User, self.users[2])
                _, players = await self._processor().fix_team_players_collision(
                    session,
                    SimpleNamespace(id=team_id, name="T0", players=roster_rows),
                    seat,
                    {"u0": present},
                    [("u0", await session.get(models.User, self.users[0])), ("u2", sub)],
                )
                await session.commit()
                self.assertEqual({"u0", "u2"}, set(players))
                self.assertEqual(
                    (self.users[2], team_id, "damage_hitscan", 2800),
                    (players["u2"].user_id, players["u2"].team_id, players["u2"].sub_role, players["u2"].rank),
                )
        async with self.Session() as session:
            rows = list(
                await session.scalars(
                    sa.select(models.EncounterTeamMember).where(
                        models.EncounterTeamMember.encounter_team_id == seat_id,
                        models.EncounterTeamMember.is_substitute.is_(True),
                    )
                )
            )
            self.assertEqual([self.ids["m2"]], [row.workspace_member_id for row in rows])
            self.assertEqual(2800, rows[0].rank)
            roles = list(
                await session.scalars(
                    sa.select(models.EncounterTeamMemberRole.role).where(
                        models.EncounterTeamMemberRole.team_member_id == rows[0].id
                    )
                )
            )
            self.assertEqual(["damage_hitscan"], roles)
            self.assertEqual(
                0,
                await session.scalar(
                    sa.select(sa.func.count())
                    .select_from(models.Player)
                    .where(models.Player.tournament_id == self.ids["t"])
                ),
            )
            self.assertIsNotNone(await match_logs_service.get_substitute(session, seat_id, self.users[2]))
            self.assertIsNone(await match_logs_service.get_substitute(session, seat_id, self.users[0]))
