"""SMALLINT vocabulary identities survive startup, metadata edits and concurrent projections."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from dataclasses import replace
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.disciplines import EventTypeSpec, StatDefSpec
from shared.repository.stats import EventTypeRepository, StatDefRepository, StatsMatchRepository
from shared.services.ontology import project_disciplines
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres
from shared.tests.test_stats_integrity_db import seed_native_stats

_TAG = itertools.count()


class StatsVocabularyTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"vocab-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as session:
            self.graph = await seed_native_stats(session, self.tag)
            await session.commit()
        self.spec = self.graph["spec"]

    async def asyncTearDown(self) -> None:
        async with self.Session() as session:
            await session.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.graph["workspace"].id))
            await session.execute(sa.delete(models.User).where(models.User.id.in_([u.id for u in self.graph["users"]])))
            dims = sa.select(models.RoleDimension.id).where(models.RoleDimension.discipline == self.tag)
            await session.execute(sa.delete(models.CatalogRole).where(models.CatalogRole.dimension_id.in_(dims)))
            for model in (models.StatDef, models.EventType, models.RoleDimension, models.CatalogEntity):
                await session.execute(sa.delete(model).where(model.discipline == self.tag))
            await session.execute(sa.delete(models.Discipline).where(models.Discipline.code == self.tag))
            await session.commit()
        await self.engine.dispose()

    async def _project(self, spec) -> None:
        async with self.Session() as session:
            await StatDefRepository().project_module(session, spec)
            await EventTypeRepository().project_module(session, spec)
            await session.commit()

    async def _sequences(self) -> dict:
        async with self.Session() as session:
            result = {}
            for table in ("stat_def", "event_type"):
                name = await session.scalar(
                    sa.text("SELECT pg_get_serial_sequence(:table, 'id')"), {"table": f"stats.{table}"}
                )
                # Identifier is a catalog result, never user input.
                result[table] = tuple(
                    (await session.execute(sa.text(f"SELECT last_value, is_called FROM {name}"))).one()
                )
            return result

    async def _audit_ids(self) -> list[int]:
        async with self.Session() as session:
            return list(
                (
                    await session.execute(
                        sa.text(
                            "SELECT id FROM audit_log WHERE action='stats.vocabulary_project' "
                            "AND after_json->'stats_evidence'->'states' @> CAST(:owner AS jsonb) ORDER BY id"
                        ),
                        {"owner": '[{"owner_kind":"vocabulary","owner_key":["' + self.tag + '"]}]'},
                    )
                ).scalars()
            )

    async def test_existing_only_and_concurrent_projections_do_not_consume_identity_or_audit_ids(self) -> None:
        sequences, audits = await self._sequences(), await self._audit_ids()
        await self._project(self.spec)
        await asyncio.gather(*(self._project(self.spec) for _ in range(4)))
        self.assertEqual(sequences, await self._sequences())
        self.assertEqual(audits, await self._audit_ids())
        async with self.Session() as session:
            self.assertEqual(self.graph["stat_ids"], await StatDefRepository().ids(session, discipline=self.tag))
            self.assertEqual(self.graph["event_ids"], await EventTypeRepository().ids(session, discipline=self.tag))

    async def test_metadata_changes_new_keys_and_deactivation_preserve_referenced_values(self) -> None:
        renamed = replace(
            self.spec,
            stat_defs=(StatDefSpec("points", "Renamed points", "decimal", "avg", "combat"), self.spec.stat_defs[1]),
            event_types=(EventTypeSpec("kill", "Elimination"),),
        )
        sequences = await self._sequences()
        old_audits = await self._audit_ids()
        await self._project(renamed)
        self.assertEqual(sequences, await self._sequences())
        self.assertGreater(len(await self._audit_ids()), len(old_audits))
        added = replace(
            renamed,
            stat_defs=(*renamed.stat_defs, StatDefSpec("new", "New")),
            event_types=(*renamed.event_types, EventTypeSpec("new", "New event")),
        )
        await self._project(added)
        new_sequences = await self._sequences()
        for table, (last_value, _) in sequences.items():
            self.assertEqual((last_value + 1, True), new_sequences[table])
        removed = replace(added, stat_defs=added.stat_defs[1:], event_types=added.event_types[1:])
        await self._project(removed)
        async with self.Session() as session:
            stat = (
                await session.execute(
                    sa.select(models.StatDef).where(
                        models.StatDef.discipline == self.tag, models.StatDef.code == "points"
                    )
                )
            ).scalar_one()
            event = (
                await session.execute(
                    sa.select(models.EventType).where(
                        models.EventType.discipline == self.tag, models.EventType.code == "kill"
                    )
                )
            ).scalar_one()
            self.assertEqual(
                (self.graph["stat_ids"]["points"], "Renamed points", "decimal", "avg", "combat", False),
                (stat.id, stat.name, stat.value_format, stat.aggregation, stat.stat_group, stat.active),
            )
            self.assertEqual(
                (self.graph["event_ids"]["kill"], "Elimination", False), (event.id, event.name, event.active)
            )
            self.assertEqual(stat.id, (await StatDefRepository().ids(session, discipline=self.tag))["points"])
            self.assertEqual(event.id, (await EventTypeRepository().ids(session, discipline=self.tag))["kill"])
            match = await session.get(models.StatsMatch, self.graph["match"].id)
            with self.assertRaises(ValueError):
                await StatsMatchRepository().replace_observations(session, match=match, **self.graph["observations"])
            without_inactive_facts = {**self.graph["observations"], "facts": []}
            with self.assertRaises(ValueError):  # event type deactivation is independently enforced
                await StatsMatchRepository().replace_observations(session, match=match, **without_inactive_facts)
            with self.assertRaises(ValueError):
                await StatsMatchRepository().replace_fact_codes(
                    session, match_id=match.id, discipline=self.tag, stat_codes=["points"], rows=[]
                )
            fact = models.StatsFact.__table__
            self.assertEqual(17.5, await session.scalar(sa.select(fact.c.value).where(fact.c.match_id == match.id)))
            self.assertEqual(
                {"fight": 1},
                await session.scalar(sa.select(models.StatsEvent.data).where(models.StatsEvent.match_id == match.id)),
            )
        self.assertGreater(len(await self._audit_ids()), 0)

    async def test_projection_and_evidence_rollback_together(self) -> None:
        before = await self._audit_ids()
        async with self.Session() as session:
            await StatDefRepository().project_module(
                session, replace(self.spec, stat_defs=(StatDefSpec("points", "No"),))
            )
            staged = (
                await session.execute(
                    sa.select(models.AuditLog.after_json)
                    .where(models.AuditLog.action == "stats.vocabulary_project")
                    .order_by(models.AuditLog.id.desc())
                    .limit(1)
                )
            ).scalar_one()
            self.assertEqual("stats.vocabulary_project", staged["stats_evidence"]["operation"])
            self.assertIn(self.tag, staged["stats_evidence"]["states"][0]["owner_key"])
            await session.rollback()
        self.assertEqual(before, await self._audit_ids())
        async with self.Session() as session:
            self.assertEqual(
                "Points",
                await session.scalar(
                    sa.select(models.StatDef.name).where(models.StatDef.id == self.graph["stat_ids"]["points"])
                ),
            )


class DeclaredVocabularyProjectionTests(IsolatedAsyncioTestCase):
    """The real modules' declarations through app-service startup's projection, not a synthetic spec."""

    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()

    async def _project_and_read(self) -> tuple[dict[str, int], dict[str, int]]:
        async with self.Session() as session:
            await project_disciplines(session)
            await session.commit()
            return (
                await StatDefRepository().ids(session, discipline="lol"),
                await EventTypeRepository().ids(session, discipline="lol"),
            )

    async def test_lol_projects_kills_dragons_and_kill_with_stable_ids(self) -> None:
        stats, events = await self._project_and_read()
        self.assertEqual({"kills", "dragons"}, set(stats))
        self.assertIn("kill", events)
        self.assertEqual((stats, events), await self._project_and_read())
