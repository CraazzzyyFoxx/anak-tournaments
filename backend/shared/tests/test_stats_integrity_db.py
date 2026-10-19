"""Native stats integrity against PostgreSQL, including invariants independent FKs cannot express."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.core import enums
from shared.disciplines import DimensionSpec, DisciplineSpec, EventTypeSpec, RoleSpec, StatDefSpec
from shared.repository import CatalogRoleRepository
from shared.repository.stats import EventTypeRepository, IngestJobRepository, StatDefRepository, StatsMatchRepository
from shared.repository.stats_queries import match_context, player_facts, team_scores
from shared.repository.stats_reads import get_match_reads
from shared.services.stats_evidence import EvidenceError, capture_stats_evidence, owner_scopes, stage_stats_evidence
from shared.services.stats_owner_delete import capture_owner_delete, stage_owner_delete
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


async def seed_native_stats(session, tag: str, *, spec: DisciplineSpec | None = None) -> dict:
    """Small native graph; no legacy fixture, copied migration SQL or external objects."""
    spec = spec or DisciplineSpec(
        tag,
        tag,
        dimensions=(DimensionSpec("role", "Role", "single", True, (RoleSpec("player", "Player"),)),),
        stat_defs=(StatDefSpec("points", "Points"), StatDefSpec("score", "Score", group="team")),
        event_types=(EventTypeSpec("kill", "Kill"),),
    )
    await CatalogRoleRepository().project_module(session, spec)
    await StatDefRepository().project_module(session, spec)
    await EventTypeRepository().project_module(session, spec)
    ws = models.Workspace(slug=tag, name=tag)
    users = [models.User(name=f"{tag}-{i}") for i in range(2)]
    session.add_all([ws, *users])
    await session.flush()
    members = [models.WorkspaceMember(workspace_id=ws.id, player_id=user.id) for user in users]
    catalog = [
        models.CatalogEntity(discipline=spec.code, kind=kind, slug=tag, name=tag) for kind in ("map", "character")
    ]
    tournament = models.Tournament(
        workspace_id=ws.id, discipline=spec.code, name=tag, slug=tag, status=enums.TournamentStatus.LIVE
    )
    rule = models.ScoringRule(
        workspace_id=ws.id, preset="wins", game_formula="win", end_formula="games >= best_of or max_wins * 2 > best_of"
    )
    session.add_all([*members, *catalog, tournament, rule])
    await session.flush()
    encounter = models.Encounter(
        workspace_id=ws.id,
        discipline=spec.code,
        tournament_id=tournament.id,
        scoring_rule_id=rule.id,
        name=tag,
        slot_count=2,
        status=enums.EncounterStatus.OPEN,
    )
    teams = [models.Team(tournament_id=tournament.id, name=f"T{i}", balancer_name=f"T{i}") for i in range(2)]
    session.add_all([encounter, *teams])
    await session.flush()
    participants = [
        models.EncounterTeam(
            encounter_id=encounter.id, tournament_id=tournament.id, slot=i + 1, team_id=team.id, name=team.name
        )
        for i, team in enumerate(teams)
    ]
    game = models.EncounterGame(encounter_id=encounter.id, position=1, map_id=catalog[0].id)
    session.add_all([*participants, game])
    await session.flush()
    session.add_all(
        [
            models.EncounterGameTeam(game_id=game.id, encounter_id=encounter.id, encounter_team_id=team.id)
            for team in participants
        ]
    )
    match = models.StatsMatch(
        workspace_id=ws.id,
        discipline=spec.code,
        encounter_id=encounter.id,
        encounter_game_id=game.id,
        map_entity_id=catalog[0].id,
    )
    session.add(match)
    await session.flush()
    stat_ids = await StatDefRepository().ids(session, discipline=spec.code)
    event_ids = await EventTypeRepository().ids(session, discipline=spec.code)
    role = await CatalogRoleRepository().resolve(
        session, discipline=spec.code, workspace_id=None, dimension=None, code="player"
    )
    observations = {
        "teams": [
            {"match_id": match.id, "encounter_id": encounter.id, "encounter_team_id": team.id, "source_position": i + 1}
            for i, team in enumerate(participants)
        ],
        "players": [
            {
                "match_id": match.id,
                "encounter_team_id": team.id,
                "workspace_member_id": member.id,
                "handle_snapshot": f"{tag}#{i}",
                "observed_role_id": role.id,
            }
            for i, (team, member) in enumerate(zip(participants, members, strict=True))
        ],
        "segments": [{"match_id": match.id, "segment": 1, "kind": "round", "attrs": {"label": "First"}}],
        "facts": [
            {
                "match_id": match.id,
                "segment": 0,
                "encounter_team_id": participants[0].id,
                "workspace_member_id": members[0].id,
                "entity_id": None,
                "stat_id": stat_ids["points"],
                "value": 17.5,
            }
        ],
        "events": [
            {
                "match_id": match.id,
                "segment": 1,
                "t": 2.5,
                "type_id": event_ids["kill"],
                "actor_member_id": members[0].id,
                "actor_team_id": participants[0].id,
                "target_member_id": members[1].id,
                "target_team_id": participants[1].id,
                "entity_id": catalog[1].id,
                "related_entity_id": None,
                "data": {"fight": 1},
            }
        ],
    }
    await StatsMatchRepository().replace_observations(session, match=match, **observations)
    await session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    await session.execute(sa.text("SET CONSTRAINTS ALL DEFERRED"))
    return {
        "spec": spec,
        "workspace": ws,
        "users": users,
        "members": members,
        "catalog": catalog,
        "tournament": tournament,
        "encounter": encounter,
        "participants": participants,
        "game": game,
        "match": match,
        "role": role,
        "stat_ids": stat_ids,
        "event_ids": event_ids,
        "observations": observations,
    }


class StatsIntegrityTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.session = self.Session()
        tag = f"stats-{os.getpid()}-{next(_TAG)}"
        self.mine = await seed_native_stats(self.session, tag)
        self.foreign = await seed_native_stats(self.session, f"{tag}-f")
        self.repo = StatsMatchRepository()

    async def asyncTearDown(self) -> None:
        await self.session.rollback()
        await self.session.close()
        await self.engine.dispose()

    async def _snapshot(self) -> dict:
        mid = self.mine["match"].id
        result = {}
        for model in (
            models.StatsMatchTeam,
            models.StatsMatchPlayer,
            models.StatsSegment,
            models.StatsFact,
            models.StatsEvent,
        ):
            table = model.__table__
            result[table.name] = [
                dict(row)
                for row in (await self.session.execute(sa.select(table).where(table.c.match_id == mid))).mappings()
            ]
        return result

    async def test_database_rejects_duplicate_null_equal_facts_and_invalid_references(self) -> None:
        fact = self.mine["observations"]["facts"][0]
        cases = [
            (models.StatsFact, fact),
            (models.StatsFact, {**fact, "workspace_member_id": self.foreign["members"][0].id}),
            (models.StatsFact, {**fact, "encounter_team_id": self.foreign["participants"][0].id}),
            (models.StatsFact, {**fact, "entity_id": self.mine["catalog"][0].id}),
            (models.StatsSegment, {"match_id": fact["match_id"], "segment": 0, "kind": "round"}),
            (
                models.StatsMatch,
                {
                    "workspace_id": self.mine["workspace"].id,
                    "discipline": self.mine["spec"].code,
                    "encounter_id": self.mine["encounter"].id,
                    "encounter_game_id": self.mine["game"].id,
                    "map_entity_id": self.mine["catalog"][0].id,
                },
            ),
        ]
        for model, row in cases:
            with self.subTest(table=model.__tablename__, row=row):
                with self.assertRaises(IntegrityError):
                    async with self.session.begin_nested():
                        await self.session.execute(sa.insert(model.__table__), [row])
                        await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
        team = models.StatsMatchTeam.__table__
        for position in (0, 1):
            with self.assertRaises(IntegrityError):
                async with self.session.begin_nested():
                    await self.session.execute(
                        sa.update(team)
                        .where(team.c.match_id == fact["match_id"], team.c.source_position == 2)
                        .values(source_position=position)
                    )

    async def test_repository_rejects_foreign_owners_before_removing_prior_observations(self) -> None:
        before = await self._snapshot()
        foreign = self.foreign
        changes = [
            ("teams", "encounter_id", foreign["encounter"].id),
            ("teams", "encounter_team_id", foreign["participants"][0].id),
            ("teams", "source_position", 2),
            ("players", "workspace_member_id", foreign["members"][0].id),
            ("players", "observed_role_id", foreign["role"].id),
            ("facts", "stat_id", foreign["stat_ids"]["points"]),
            ("facts", "entity_id", foreign["catalog"][1].id),
            ("facts", "encounter_team_id", self.mine["participants"][1].id),
            ("facts", "segment", 2),
            ("events", "type_id", foreign["event_ids"]["kill"]),
            ("events", "related_entity_id", foreign["catalog"][1].id),
            ("events", "actor_team_id", self.mine["participants"][1].id),
            ("events", "target_team_id", None),
            ("events", "actor_member_id", foreign["members"][0].id),
        ]
        for relation, column, value in changes:
            with self.subTest(relation=relation, column=column):
                observations = copy.deepcopy(self.mine["observations"])
                observations[relation][0][column] = value
                with self.assertRaises(ValueError):
                    await self.repo.replace_observations(self.session, match=self.mine["match"], **observations)
                self.assertEqual(before, await self._snapshot())
        for field, value in (
            ("workspace_id", foreign["workspace"].id),
            ("discipline", foreign["spec"].code),
            ("encounter_id", foreign["encounter"].id),
            ("encounter_game_id", foreign["game"].id),
            ("map_entity_id", foreign["catalog"][0].id),
        ):
            match = self.mine["match"]
            original = getattr(match, field)
            setattr(match, field, value)
            with self.assertRaises(ValueError):
                await self.repo.replace_observations(self.session, match=match, **self.mine["observations"])
            setattr(match, field, original)
            self.assertEqual(before, await self._snapshot())

    async def test_replacements_preserve_input_array_order_not_keys_or_encounter_slots(self) -> None:
        original = self.mine["observations"]
        match = self.mine["match"]
        revision = match.revision
        for keys in (("away", "home"), ("beta", "alpha"), ("alpha", "beta")):
            observations = copy.deepcopy(original)
            canonical = [{"key": keys[0], "team": original["teams"][1]}, {"key": keys[1], "team": original["teams"][0]}]
            observations["teams"] = [{**item["team"], "source_position": i + 1} for i, item in enumerate(canonical)]
            await self.repo.replace_observations(self.session, match=match, **observations)
            rows = (
                (
                    await self.session.execute(
                        sa.select(models.StatsMatchTeam.encounter_team_id)
                        .where(models.StatsMatchTeam.match_id == match.id)
                        .order_by(models.StatsMatchTeam.source_position)
                    )
                )
                .scalars()
                .all()
            )
            self.assertEqual([self.mine["participants"][1].id, self.mine["participants"][0].id], rows)
            self.assertEqual(revision, match.revision)  # the service owns successful revision increments
            match.revision += 1
            revision += 1
            await self.session.flush()
            await self.repo.replace_observations(self.session, match=match, **original)
            match.revision += 1
            revision += 1
            await self.session.flush()
        bad = copy.deepcopy(original)
        bad["teams"].reverse()  # positions no longer agree with the incoming array
        with self.assertRaises(ValueError):
            await self.repo.replace_observations(self.session, match=match, **bad)

    async def test_code_replacement_preserves_characters_and_rejects_them_before_delete(self) -> None:
        match = self.mine["match"]
        fact = self.mine["observations"]["facts"][0]
        character = {**fact, "entity_id": self.mine["catalog"][1].id, "value": 31}
        round_fact = {**fact, "segment": 1, "value": 9}
        other_code = {**fact, "stat_id": self.mine["stat_ids"]["score"], "workspace_member_id": None, "value": 2}
        await self.session.execute(sa.insert(models.StatsFact.__table__), [character, round_fact, other_code])
        before = await self._snapshot()
        with self.assertRaises(ValueError):
            await self.repo.replace_fact_codes(
                self.session,
                match_id=match.id,
                discipline=match.discipline,
                stat_codes=["points"],
                rows=[character],
            )
        self.assertEqual(before, await self._snapshot())
        await self.repo.replace_fact_codes(
            self.session,
            match_id=match.id,
            discipline=match.discipline,
            stat_codes=["points"],
            rows=[{**round_fact, "value": 42}],
        )
        rows = (
            await self.session.execute(
                sa.select(
                    models.StatsFact.segment,
                    models.StatsFact.entity_id,
                    models.StatsFact.value,
                ).where(models.StatsFact.match_id == match.id)
            )
        ).all()
        self.assertCountEqual([(0, character["entity_id"], 31), (1, None, 42), (0, None, 2)], rows)

    async def test_member_history_rejects_overlap_and_cross_workspace_before_writes(self) -> None:
        before = await self._snapshot()
        for target in (self.mine["members"][1], self.foreign["members"][0]):
            with self.assertRaises(ValueError):
                await self.repo.merge_member_history(
                    self.session,
                    source_member_id=self.mine["members"][0].id,
                    target_member_id=target.id,
                )
            self.assertEqual(before, await self._snapshot())

    async def test_member_history_preserves_fact_event_and_observed_identity(self) -> None:
        user = models.User(name=f"{self.mine['spec'].code}-survivor")
        self.session.add(user)
        await self.session.flush()
        member = models.WorkspaceMember(workspace_id=self.mine["workspace"].id, player_id=user.id)
        self.session.add(member)
        await self.session.flush()
        source = self.mine["members"][0].id
        count = await self.repo.merge_member_history(
            self.session,
            source_member_id=source,
            target_member_id=member.id,
        )
        self.assertEqual(1, count)
        snapshot = await self._snapshot()
        self.assertEqual(member.id, snapshot["fact"][0]["workspace_member_id"])
        self.assertEqual(17.5, snapshot["fact"][0]["value"])
        self.assertEqual(member.id, snapshot["event"][0]["actor_member_id"])
        self.assertEqual(self.mine["members"][1].id, snapshot["event"][0]["target_member_id"])
        moved = next(row for row in snapshot["match_player"] if row["workspace_member_id"] == member.id)
        self.assertEqual(self.mine["observations"]["players"][0]["handle_snapshot"], moved["handle_snapshot"])
        await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))

    async def test_scoped_lookup_and_targeted_writes_preserve_other_observations(self) -> None:
        match = self.mine["match"]
        self.assertIs(
            match,
            await self.repo.get_for_game(
                self.session,
                encounter_game_id=match.encounter_game_id,
                workspace_id=match.workspace_id,
                discipline=match.discipline,
                for_update=True,
            ),
        )
        self.assertIsNone(
            await self.repo.get_for_game(
                self.session,
                encounter_game_id=match.encounter_game_id,
                workspace_id=self.foreign["workspace"].id,
                discipline=match.discipline,
            )
        )
        self.assertIsNone(
            await self.repo.get_for_game(
                self.session,
                encounter_game_id=match.encounter_game_id,
                workspace_id=match.workspace_id,
                discipline=self.foreign["spec"].code,
            )
        )
        before = await self._snapshot()
        fact = {**self.mine["observations"]["facts"][0], "value": 23.25}
        await self.repo.replace_fact_codes(
            self.session, match_id=match.id, discipline=match.discipline, stat_codes=["points"], rows=[fact]
        )
        await self.repo.set_team_scores(
            self.session,
            match_id=match.id,
            discipline=match.discipline,
            scores={team.id: value for team, value in zip(self.mine["participants"], (3.0, 1.0), strict=True)},
        )
        after = await self._snapshot()
        for name in ("match_team", "match_player", "segment", "event"):
            self.assertEqual(before[name], after[name])
        self.assertEqual([1.0, 3.0, 23.25], sorted(row["value"] for row in after["fact"]))
        with self.assertRaises(ValueError):
            await self.repo.replace_fact_codes(
                self.session, match_id=match.id, discipline=match.discipline, stat_codes=["score"], rows=[fact]
            )
        with self.assertRaises(ValueError):
            await self.repo.set_team_scores(
                self.session,
                match_id=match.id,
                discipline=match.discipline,
                scores={self.foreign["participants"][0].id: 4.0},
            )
        with self.assertRaises(ValueError):
            await self.repo.replace_fact_codes(
                self.session, match_id=match.id, discipline=self.foreign["spec"].code, stat_codes=["points"], rows=[]
            )
        self.assertEqual(after, await self._snapshot())

    async def test_member_delete_is_refused_but_match_encounter_workspace_cascades_are_complete(self) -> None:
        match_id = self.mine["match"].id
        with self.assertRaises(IntegrityError):
            async with self.session.begin_nested():
                table = models.WorkspaceMember.__table__
                await self.session.execute(sa.delete(table).where(table.c.id == self.mine["members"][0].id))
                await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
        for model, owner in (
            (models.StatsMatch, self.mine["match"]),
            (models.Encounter, self.mine["encounter"]),
            (models.Workspace, self.mine["workspace"]),
        ):
            nested = await self.session.begin_nested()
            try:
                table = model.__table__
                await self.session.execute(sa.delete(table).where(table.c.id == owner.id))
                await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
                for child in (
                    models.StatsMatchTeam,
                    models.StatsMatchPlayer,
                    models.StatsSegment,
                    models.StatsFact,
                    models.StatsEvent,
                ):
                    self.assertEqual(
                        0,
                        await self.session.scalar(
                            sa.select(sa.func.count()).select_from(child).where(child.match_id == match_id)
                        ),
                    )
            finally:
                await nested.rollback()
        self.assertEqual(17.5, (await self._snapshot())["fact"][0]["value"])

    async def test_optional_columns_and_duplicate_events_survive_bulk_replacement(self) -> None:
        observations = copy.deepcopy(self.mine["observations"])
        observations["facts"].append(
            {
                **observations["facts"][0],
                "entity_id": self.mine["catalog"][1].id,
                "value": 9.25,
                "entity_kind": "character",
            }
        )
        event = observations["events"][0]
        observations["events"] = [
            {**event, "actor_member_id": None, "actor_team_id": None, "data": None},
            {**event, "entity_kind": "character"},
            dict(event),
        ]
        await self.repo.replace_observations(self.session, match=self.mine["match"], **observations)
        persisted = await self._snapshot()
        self.assertEqual([9.25, 17.5], sorted(row["value"] for row in persisted["fact"]))
        self.assertEqual(3, len(persisted["event"]))
        self.assertEqual(2, sum(row["data"] == {"fight": 1} for row in persisted["event"]))
        absent_actor = next(row for row in persisted["event"] if row["actor_member_id"] is None)
        self.assertIsNone(absent_actor["actor_team_id"])
        self.assertIsNone(absent_actor["data"])

    async def test_invalid_numbers_and_duplicate_rows_do_not_delete_existing_data(self) -> None:
        before = await self._snapshot()
        changes = [
            ("teams", "source_position", True),
            ("teams", "source_position", 0),
            ("facts", "value", float("nan")),
            ("facts", "value", float("inf")),
            ("facts", "workspace_member_id", True),
            ("facts", "segment", -1),
            ("events", "t", float("-inf")),
            ("events", "segment", 32768),
            ("segments", "segment", 0),
            ("players", "handle_snapshot", " "),
        ]
        for relation, column, value in changes:
            with self.subTest(relation=relation, column=column, value=value):
                observations = copy.deepcopy(self.mine["observations"])
                observations[relation][0][column] = value
                with self.assertRaises(ValueError):
                    await self.repo.replace_observations(self.session, match=self.mine["match"], **observations)
                self.assertEqual(before, await self._snapshot())
        for relation in ("teams", "players", "segments", "facts"):
            observations = copy.deepcopy(self.mine["observations"])
            observations[relation].append(dict(observations[relation][0]))
            with self.assertRaises(ValueError):
                await self.repo.replace_observations(self.session, match=self.mine["match"], **observations)
            self.assertEqual(before, await self._snapshot())

    async def test_foreign_workspace_role_and_job_are_refused(self) -> None:
        parent = self.mine["role"]
        role = models.CatalogRole(
            dimension_id=parent.dimension_id,
            workspace_id=self.foreign["workspace"].id,
            parent_role_id=parent.id,
            code="foreign-child",
            name="Foreign",
        )
        job = models.IngestJob(
            workspace_id=self.foreign["workspace"].id,
            discipline=self.foreign["spec"].code,
            source_kind="test",
            content_hash="a" * 64,
            raw_ref="test/foreign",
            status=models.IngestJobStatus.DONE,
        )
        self.session.add_all([role, job])
        await self.session.flush()
        before = await self._snapshot()
        observations = copy.deepcopy(self.mine["observations"])
        observations["players"][0]["observed_role_id"] = role.id
        with self.assertRaises(ValueError):
            await self.repo.replace_observations(self.session, match=self.mine["match"], **observations)
        self.mine["match"].ingest_job_id = job.id
        with self.assertRaises(ValueError):
            await self.repo.replace_observations(self.session, match=self.mine["match"], **self.mine["observations"])
        self.mine["match"].ingest_job_id = None
        self.assertEqual(before, await self._snapshot())

    async def test_team_score_key_is_null_equal_and_partial_edits_preserve_other_team(self) -> None:
        match = self.mine["match"]
        first, second = [team.id for team in self.mine["participants"]]
        await self.repo.set_team_scores(
            self.session, match_id=match.id, discipline=match.discipline, scores={first: 3.0, second: 1.0}
        )
        await self.repo.set_team_scores(
            self.session, match_id=match.id, discipline=match.discipline, scores={first: 4.0}
        )
        scores = [row for row in (await self._snapshot())["fact"] if row["stat_id"] == self.mine["stat_ids"]["score"]]
        self.assertEqual({first: 4.0, second: 1.0}, {row["encounter_team_id"]: row["value"] for row in scores})
        with self.assertRaises(IntegrityError):
            async with self.session.begin_nested():
                await self.session.execute(sa.insert(models.StatsFact.__table__), [scores[0]])

    async def test_channel_uses_native_storage_uniqueness_and_tournament_cascade(self) -> None:
        channel = models.TournamentDiscordChannel(
            tournament_id=self.mine["tournament"].id, channel_id=8_000_000 + self.mine["match"].id
        )
        self.session.add(channel)
        await self.session.flush()
        with self.assertRaises(IntegrityError):
            async with self.session.begin_nested():
                self.session.add(
                    models.TournamentDiscordChannel(
                        tournament_id=self.foreign["tournament"].id, channel_id=channel.channel_id
                    )
                )
                await self.session.flush()
        await self.session.execute(
            sa.delete(models.Tournament).where(models.Tournament.id == self.mine["tournament"].id)
        )
        await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
        self.assertEqual(
            0,
            await self.session.scalar(
                sa.select(sa.func.count())
                .select_from(models.TournamentDiscordChannel)
                .where(models.TournamentDiscordChannel.id == channel.id)
            ),
        )

    async def test_native_repository_leaves_commit_to_caller(self) -> None:
        match = self.mine["match"]
        await self.repo.set_team_scores(
            self.session, match_id=match.id, discipline=match.discipline, scores={self.mine["participants"][0].id: 2.0}
        )
        async with self.Session() as other:
            self.assertIsNone(
                await other.scalar(sa.select(models.StatsMatch.id).where(models.StatsMatch.id == match.id))
            )

    async def test_absent_event_payload_is_sql_null_not_json_null(self) -> None:
        observations = copy.deepcopy(self.mine["observations"])
        observations["events"][0]["data"] = None
        await self.repo.replace_observations(self.session, match=self.mine["match"], **observations)
        event = models.StatsEvent.__table__
        self.assertTrue(
            await self.session.scalar(
                sa.select(event.c.data.is_(None)).where(event.c.match_id == self.mine["match"].id)
            )
        )

    async def test_game_deletion_preserves_unbound_reads_and_owner_deletion_captures_them(self) -> None:
        match = self.mine["match"]
        first, second = [team.id for team in self.mine["participants"]]
        await self.repo.set_team_scores(
            self.session, match_id=match.id, discipline=match.discipline, scores={first: 3.0, second: 1.0}
        )
        match.source_map_index = 19
        await self.session.execute(
            sa.update(models.EncounterTeam)
            .where(models.EncounterTeam.encounter_id == match.encounter_id)
            .values(active=False)
        )
        await self.session.flush()
        before = await self._snapshot()
        captures = await capture_owner_delete(self.session, game_id=match.encounter_game_id)
        game_id = match.encounter_game_id
        await self.session.execute(sa.delete(models.EncounterGame).where(models.EncounterGame.id == game_id))
        audits = await stage_owner_delete(
            self.session, captures, workspace_id=match.workspace_id, entity_type="encounter_game", entity_id=game_id
        )
        self.assertTrue(audits)
        await self.session.refresh(match)
        self.assertIsNone(match.encounter_game_id)
        self.assertEqual(before, await self._snapshot())
        context = match_context(discipline=match.discipline)
        header = (await self.session.execute(sa.select(context).where(context.c.id == match.id))).mappings().one()
        self.assertEqual(
            (match.encounter_id, None, 19), (header["encounter_id"], header["position"], header["source_map_index"])
        )
        facts = player_facts(discipline=match.discipline)
        self.assertEqual(
            [(match.encounter_id, 17.5)],
            (
                await self.session.execute(
                    sa.select(facts.c.encounter_id, facts.c.value).where(facts.c.match_id == match.id)
                )
            ).all(),
        )
        scores = team_scores(discipline=match.discipline, stat_code="score")
        self.assertEqual(
            {first: 3.0, second: 1.0},
            dict(
                (
                    await self.session.execute(
                        sa.select(scores.c.encounter_team_id, scores.c.value).where(scores.c.match_id == match.id)
                    )
                ).all()
            ),
        )
        read = (await get_match_reads(self.session, match_ids=[match.id]))[match.id]
        self.assertIsNone(read.game)
        self.assertEqual(match.encounter_id, read.encounter.id)
        self.assertEqual({first: 3.0, second: 1.0}, {p.seat.id: p.team_facts["score"] for p in read.participants})
        self.assertEqual([None, None], [p.result for p in read.participants])
        with self.assertRaises(ValueError):
            await self.repo.replace_observations(self.session, match=match, **self.mine["observations"])
        self.assertEqual(before, await self._snapshot())
        await self.repo.set_team_scores(
            self.session, match_id=match.id, discipline=match.discipline, scores={first: 4.5}
        )
        # No duel-score requirement: a non-integral observed value is a fact like any other.
        read = (await get_match_reads(self.session, match_ids=[match.id]))[match.id]
        self.assertEqual({first: 4.5, second: 1.0}, {p.seat.id: p.team_facts["score"] for p in read.participants})
        for model, root, root_id in (
            (models.Encounter, "encounter_id", match.encounter_id),
            (models.Tournament, "tournament_id", self.mine["tournament"].id),
        ):
            nested = await self.session.begin_nested()
            try:
                captures = await capture_owner_delete(self.session, **{root: root_id})
                self.assertTrue(
                    any(
                        state["owner_kind"] == "match" and state["owner_key"] == [match.id]
                        for capture in captures
                        for state in capture
                    )
                )
                await self.session.execute(sa.delete(model).where(model.id == root_id))
                self.assertTrue(
                    await stage_owner_delete(
                        self.session, captures, workspace_id=match.workspace_id, entity_type=root, entity_id=root_id
                    )
                )
                self.assertIsNone(
                    await self.session.scalar(sa.select(models.StatsMatch.id).where(models.StatsMatch.id == match.id))
                )
                self.assertTrue(all(not rows for rows in (await self._snapshot()).values()))
            finally:
                await nested.rollback()

    async def test_raw_verification_preserves_known_hash_and_rejects_unaudited_metadata_changes(self) -> None:
        digest = hashlib.sha256(b"actually inspected fixture bytes").hexdigest()
        job = models.IngestJob(
            workspace_id=self.mine["workspace"].id,
            discipline=self.mine["spec"].code,
            source_kind="historical_reference",
            external_id=f"legacy:matches.match:{self.mine['match'].id}",
            raw_ref="fixture/history",
            content_hash=None,
            raw_status=models.RawSourceStatus.UNVERIFIED,
            status=models.IngestJobStatus.DONE,
        )
        self.session.add(job)
        await self.session.flush()
        repo = IngestJobRepository()
        scopes = owner_scopes("job", (job.id,))
        for status, inspected in (
            (models.RawSourceStatus.AVAILABLE, None),
            (models.RawSourceStatus.MISSING, digest),
            (models.RawSourceStatus.CONFLICT, digest),
        ):
            with self.assertRaises(ValueError):
                await repo.verify_raw_source(
                    self.session,
                    job_id=job.id,
                    workspace_id=job.workspace_id,
                    raw_status=status,
                    inspected_sha256=inspected,
                )
        self.assertFalse(job.raw_available)
        with self.assertRaises(ValueError):
            await repo.verify_raw_source(
                self.session,
                job_id=job.id,
                workspace_id=self.foreign["workspace"].id,
                raw_status=models.RawSourceStatus.AVAILABLE,
                inspected_sha256=digest,
            )
        before = await capture_stats_evidence(self.session, scopes=scopes)
        original = dict(
            (await self.session.execute(sa.select(models.IngestJob.__table__).where(models.IngestJob.id == job.id)))
            .mappings()
            .one()
        )
        await repo.verify_raw_source(
            self.session,
            job_id=job.id,
            workspace_id=job.workspace_id,
            raw_status=models.RawSourceStatus.AVAILABLE,
            inspected_sha256=digest,
        )
        self.assertTrue(job.raw_available)
        self.assertEqual(digest, job.content_hash)
        after = await capture_stats_evidence(self.session, scopes=scopes)
        with self.assertRaises(EvidenceError):
            await stage_stats_evidence(
                self.session,
                operation="stats.raw_verification",
                before=before,
                after=after,
                workspace_id=job.workspace_id,
                entity_type="ingest_job",
                entity_id=job.id,
            )
        evidence = [{"job_id": job.id, "raw_ref": job.raw_ref, "inspected_sha256": digest}]
        audit = await stage_stats_evidence(
            self.session,
            operation="stats.raw_verification",
            before=before,
            after=after,
            workspace_id=job.workspace_id,
            entity_type="ingest_job",
            entity_id=job.id,
            raw_verification=evidence,
        )
        self.assertEqual(evidence, audit.after_json["stats_evidence"]["raw_verification"])
        persisted = dict(
            (await self.session.execute(sa.select(models.IngestJob.__table__).where(models.IngestJob.id == job.id)))
            .mappings()
            .one()
        )
        self.assertEqual(
            {k: v for k, v in original.items() if k not in {"content_hash", "raw_status"}},
            {k: v for k, v in persisted.items() if k not in {"content_hash", "raw_status"}},
        )
        before = after
        await repo.verify_raw_source(
            self.session,
            job_id=job.id,
            workspace_id=job.workspace_id,
            raw_status=models.RawSourceStatus.AVAILABLE,
            inspected_sha256=digest,
        )
        self.assertEqual(before, await capture_stats_evidence(self.session, scopes=scopes))
        conflicting = hashlib.sha256(b"different inspected bytes").hexdigest()
        with self.assertRaises(ValueError):
            await repo.verify_raw_source(
                self.session,
                job_id=job.id,
                workspace_id=job.workspace_id,
                raw_status=models.RawSourceStatus.AVAILABLE,
                inspected_sha256=conflicting,
            )
        for status, inspected in (
            (models.RawSourceStatus.CONFLICT, conflicting),
            (models.RawSourceStatus.MISSING, None),
            (models.RawSourceStatus.UNVERIFIED, digest),
        ):
            await repo.verify_raw_source(
                self.session,
                job_id=job.id,
                workspace_id=job.workspace_id,
                raw_status=status,
                inspected_sha256=inspected,
            )
            self.assertFalse(job.raw_available)
            self.assertEqual(digest, job.content_hash)
            after = await capture_stats_evidence(self.session, scopes=scopes)
            await stage_stats_evidence(
                self.session,
                operation="stats.raw_verification",
                before=before,
                after=after,
                workspace_id=job.workspace_id,
                entity_type="ingest_job",
                entity_id=job.id,
                raw_verification=[{"job_id": job.id, "raw_ref": job.raw_ref, "inspected_sha256": inspected}],
            )
            before = after
        await self.session.execute(
            sa.update(models.IngestJob)
            .where(models.IngestJob.id == job.id)
            .values(filename="unauthorized.txt", updated_at=job.updated_at)
        )
        after = await capture_stats_evidence(self.session, scopes=scopes)
        with self.assertRaises(EvidenceError):
            await stage_stats_evidence(
                self.session,
                operation="stats.raw_verification",
                before=before,
                after=after,
                workspace_id=job.workspace_id,
                entity_type="ingest_job",
                entity_id=job.id,
                raw_verification=evidence,
            )

    async def test_raw_verification_preserves_hash_case_and_refuses_shared_source_availability(self) -> None:
        digest = hashlib.sha256(b"inspected shared fixture").hexdigest()
        jobs = [
            models.IngestJob(
                workspace_id=self.mine["workspace"].id,
                discipline=self.mine["spec"].code,
                source_kind="historical_reference",
                external_id=f"fixture:{i}",
                raw_ref="fixture/shared",
                content_hash=digest.upper() if i == 0 else None,
                raw_status=models.RawSourceStatus.UNVERIFIED,
                status=models.IngestJobStatus.DONE,
            )
            for i in range(2)
        ]
        self.session.add_all(jobs)
        await self.session.flush()
        repo = IngestJobRepository()
        before = await capture_stats_evidence(self.session, scopes=owner_scopes("job", (jobs[0].id,)))
        await repo.verify_raw_source(
            self.session,
            job_id=jobs[0].id,
            workspace_id=jobs[0].workspace_id,
            raw_status=models.RawSourceStatus.AVAILABLE,
            inspected_sha256=digest,
        )
        after = await capture_stats_evidence(self.session, scopes=owner_scopes("job", (jobs[0].id,)))
        await stage_stats_evidence(
            self.session,
            operation="stats.raw_verification",
            before=before,
            after=after,
            workspace_id=jobs[0].workspace_id,
            entity_type="ingest_job",
            entity_id=jobs[0].id,
            raw_verification=[{"job_id": jobs[0].id, "raw_ref": jobs[0].raw_ref, "inspected_sha256": digest}],
        )
        self.assertEqual(digest.upper(), jobs[0].content_hash)
        self.mine["match"].ingest_job_id = jobs[0].id
        self.session.add(
            models.StatsMatch(
                workspace_id=self.mine["workspace"].id,
                discipline=self.mine["spec"].code,
                encounter_id=self.mine["encounter"].id,
                map_entity_id=self.mine["catalog"][0].id,
                ingest_job_id=jobs[1].id,
            )
        )
        await self.session.flush()
        for job in jobs:
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                await repo.verify_raw_source(
                    self.session,
                    job_id=job.id,
                    workspace_id=job.workspace_id,
                    raw_status=models.RawSourceStatus.AVAILABLE,
                    inspected_sha256=digest,
                )
            await repo.verify_raw_source(
                self.session,
                job_id=job.id,
                workspace_id=job.workspace_id,
                raw_status=models.RawSourceStatus.UNVERIFIED,
                inspected_sha256=digest,
            )
            self.assertFalse(job.raw_available)
        self.assertEqual(digest.upper(), jobs[0].content_hash)
        self.assertIsNone(jobs[1].content_hash)
