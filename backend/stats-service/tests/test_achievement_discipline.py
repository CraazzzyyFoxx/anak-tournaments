"""Every achievement mutation and evaluation is scoped to its discipline (P6 Task 2).

Real PostgreSQL, one rolled-back transaction per test. Every test plants a *sentinel* — a nonempty award, rule or
override of the other game — and asserts it survives the operation under test: that is what a destructive,
unscoped query would have taken.
"""

from __future__ import annotations

import asyncio
import dataclasses
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy import exc as sa_exc
from sqlalchemy.ext.asyncio import AsyncSession

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))


from shared import models  # noqa: E402
from shared.core.errors import BaseAPIException  # noqa: E402
from shared.disciplines import discipline as discipline_spec  # noqa: E402
from shared.models.achievements.achievement import (  # noqa: E402
    AchievementEvaluationResult,
    AchievementOverride,
    AchievementOverrideAction,
    AchievementRule,
    EvaluationRunStatus,
    EvaluationRunTrigger,
)
from shared.repository.support import (  # noqa: E402
    AchievementEvaluationResultRepository,
    AchievementOverrideRepository,
    AchievementRuleRepository,
)
from shared.schemas.events import AchievementEvaluateEvent  # noqa: E402
from shared.services.achievement_effective import build_effective_achievement_rows_subquery  # noqa: E402
from shared.testing import create_test_async_engine, ensure_test_postgres  # noqa: E402
from src import schemas  # noqa: E402
from src.services.achievement import admin_reads  # noqa: E402
from src.services.achievement import import_export as portable  # noqa: E402
from src.services.achievement.engine import runner  # noqa: E402
from src.services.achievement.engine.seeder import AchievementSeederService  # noqa: E402
from src.services.achievement.rule_service import achievement_rule_service  # noqa: E402

PLAYED_ONCE = {"type": "tournament_count", "params": {"op": ">=", "value": 1}}
_rules = AchievementRuleRepository()
_results = AchievementEvaluationResultRepository()


class _DbCase(IsolatedAsyncioTestCase):
    """A rolled-back transaction with a verified workspace that enables both games."""

    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.connection = await self.engine.connect()
        self.transaction = await self.connection.begin()
        self.session = AsyncSession(self.connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        self.tag = uuid.uuid4().hex[:12]
        self.ws = await self.workspace("both")

    async def asyncTearDown(self) -> None:
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    async def workspace(self, label: str, *, enabled: tuple[str, ...] = ("overwatch", "lol")) -> models.Workspace:
        ws = models.Workspace(
            slug=f"{self.tag}-{label}",
            name=f"{self.tag}-{label}",
            disciplines_enabled=list(enabled),
            verification_status="verified",
        )
        self.session.add(ws)
        await self.session.flush()
        return ws

    async def member(self, ws: models.Workspace, label: str) -> models.WorkspaceMember:
        user = models.User(name=f"{self.tag}-{ws.id}-{label}")
        self.session.add(user)
        await self.session.flush()
        member = models.WorkspaceMember(workspace_id=ws.id, player_id=user.id)
        self.session.add(member)
        await self.session.flush()
        return member

    async def tournament(
        self, ws: models.Workspace, discipline: str, label: str, *, players: tuple[models.WorkspaceMember, ...] = ()
    ) -> models.Tournament:
        tournament = models.Tournament(
            workspace_id=ws.id,
            name=f"{self.tag}-{label}",
            slug=f"{self.tag}-{label}-{ws.id}",
            discipline=discipline,
            start_date=datetime(2026, 1, 1, tzinfo=UTC),
        )
        self.session.add(tournament)
        await self.session.flush()
        if players:
            team = models.Team(tournament_id=tournament.id, name=label, balancer_name=label)
            self.session.add(team)
            await self.session.flush()
            for member in players:
                self.session.add(
                    models.Player(
                        tournament_id=tournament.id,
                        team_id=team.id,
                        workspace_member_id=member.id,
                        name=f"p{member.id}",
                        rank=1000,
                        is_substitution=False,
                        is_newcomer=False,
                        is_newcomer_role=False,
                    )
                )
            await self.session.flush()
        return tournament

    async def character(self, discipline: str, label: str = "champ") -> models.CatalogEntity:
        entity = models.CatalogEntity(
            discipline=discipline, kind="character", slug=f"{self.tag}-{label}", name=f"{self.tag}-{label}"
        )
        self.session.add(entity)
        await self.session.flush()
        return entity

    async def rule(
        self,
        slug: str,
        discipline: str,
        tree: dict,
        *,
        ws: models.Workspace | None = None,
        enabled: bool = True,
        entity_id: int | None = None,
        grain: str = "user",
    ) -> AchievementRule:
        rule = AchievementRule(
            workspace_id=(ws or self.ws).id,
            slug=slug,
            name=slug,
            description_ru=slug,
            description_en=slug,
            discipline=discipline,
            entity_id=entity_id,
            category="overall",
            scope="global",
            grain=grain,
            condition_tree=tree,
            depends_on=[],
            enabled=enabled,
            rule_version=1,
        )
        await _rules.create(self.session, rule)
        return rule

    async def award(
        self, rule: AchievementRule, member: models.WorkspaceMember, tournament_id: int | None = None
    ) -> None:
        await _results.bulk_upsert_ignore_conflicts(
            self.session,
            [
                {
                    "achievement_rule_id": rule.id,
                    "workspace_member_id": member.id,
                    "tournament_id": tournament_id,
                    "encounter_id": None,
                    "match_id": None,
                    "qualified_at": datetime.now(UTC),
                    "rule_version": rule.rule_version,
                    "run_id": None,
                    "evidence_json": {"sentinel": True},
                }
            ],
        )

    async def awards_of(self, rule: AchievementRule) -> set[int]:
        rows = await self.session.scalars(
            sa.select(models.WorkspaceMember.player_id)
            .join(
                AchievementEvaluationResult,
                AchievementEvaluationResult.workspace_member_id == models.WorkspaceMember.id,
            )
            .where(AchievementEvaluationResult.achievement_rule_id == rule.id)
        )
        return set(rows)

    async def rule_slugs(self, ws: models.Workspace | None = None, discipline: str | None = None) -> set[str]:
        query = sa.select(AchievementRule.slug).where(AchievementRule.workspace_id == (ws or self.ws).id)
        if discipline is not None:
            query = query.where(AchievementRule.discipline == discipline)
        return set(await self.session.scalars(query))

    async def evaluate(self, **kwargs):  # noqa: ANN003, ANN202
        await self.session.commit()
        return await runner.run_evaluation(self.session, self.ws.id, EvaluationRunTrigger.manual, **kwargs)


class RuleWritesTests(_DbCase):
    def _data(self, **overrides) -> dict:  # noqa: ANN003
        return schemas.AchievementRuleCreate.model_validate(
            {
                "slug": "alpha",
                "name": "Alpha",
                "description_ru": "RU",
                "description_en": "EN",
                "discipline": "overwatch",
                "category": "overall",
                "scope": "global",
                "grain": "user",
                "condition_tree": PLAYED_ONCE,
                **overrides,
            }
        ).model_dump()

    async def test_a_rule_cannot_be_written_without_its_discipline(self) -> None:
        rule = AchievementRule(
            workspace_id=self.ws.id,
            slug="nameless",
            name="n",
            description_ru="n",
            description_en="n",
            category="overall",
            scope="global",
            grain="user",
            condition_tree={},
        )
        self.session.add(rule)
        with self.assertRaises(sa_exc.IntegrityError):
            await self.session.flush()

    async def test_create_derives_dependencies_with_its_own_game_and_checks_character_ownership(self) -> None:
        ow_char = await self.character("overwatch")
        lol_char = await self.character("lol")
        created = await achievement_rule_service.create_rule(
            self.session,
            workspace_id=self.ws.id,
            rule_data=self._data(entity_id=ow_char.id, depends_on=["bogus.table"]),
        )
        self.assertEqual(("overwatch", ow_char.id), (created.discipline, created.entity_id))
        self.assertNotIn("bogus.table", created.depends_on)
        self.assertTrue(created.depends_on)

        for slug, entity_id in (("beta", lol_char.id), ("gamma", 987654321)):
            with self.subTest(entity_id=entity_id), self.assertRaises(BaseAPIException) as ctx:
                await achievement_rule_service.create_rule(
                    self.session, workspace_id=self.ws.id, rule_data=self._data(slug=slug, entity_id=entity_id)
                )
            self.assertEqual(422, ctx.exception.status_code)
            self.assertIn("entity_id", str(ctx.exception.detail))
        self.assertEqual({"alpha"}, await self.rule_slugs())

    async def test_a_slug_is_one_identity_across_games_and_the_other_rule_is_untouched(self) -> None:
        lol_rule = await self.rule("taken", "lol", {})
        await self.session.commit()
        with self.assertRaises(BaseAPIException) as ctx:
            await achievement_rule_service.create_rule(
                self.session, workspace_id=self.ws.id, rule_data=self._data(slug="taken")
            )
        self.assertEqual(409, ctx.exception.status_code)
        mover = await achievement_rule_service.create_rule(
            self.session, workspace_id=self.ws.id, rule_data=self._data(slug="mover")
        )
        with self.assertRaises(BaseAPIException) as ctx:
            await achievement_rule_service.update_rule(
                self.session, workspace_id=self.ws.id, rule_id=mover.id, update_data={"slug": "taken"}
            )
        self.assertEqual(409, ctx.exception.status_code)
        await self.session.refresh(lol_rule)
        self.assertEqual(("taken", "lol"), (lol_rule.slug, lol_rule.discipline))

    async def test_update_separates_omitted_from_explicit_empty_and_null(self) -> None:
        ow_char = await self.character("overwatch")
        rule = await achievement_rule_service.create_rule(
            self.session, workspace_id=self.ws.id, rule_data=self._data(entity_id=ow_char.id)
        )
        before_version = rule.rule_version

        await achievement_rule_service.update_rule(
            self.session, workspace_id=self.ws.id, rule_id=rule.id, update_data={"name": "Renamed"}
        )
        self.assertEqual(
            (ow_char.id, PLAYED_ONCE, before_version), (rule.entity_id, rule.condition_tree, rule.rule_version)
        )

        await achievement_rule_service.update_rule(
            self.session, workspace_id=self.ws.id, rule_id=rule.id, update_data={"condition_tree": {}}
        )
        self.assertEqual(({}, [], before_version + 1), (rule.condition_tree, rule.depends_on, rule.rule_version))
        self.assertEqual(ow_char.id, rule.entity_id)  # a tree edit does not clear the link

        await achievement_rule_service.update_rule(
            self.session, workspace_id=self.ws.id, rule_id=rule.id, update_data={"entity_id": None}
        )
        self.assertIsNone(rule.entity_id)
        self.assertEqual("overwatch", rule.discipline)

    async def test_update_cannot_link_another_games_character_or_tournament(self) -> None:
        lol_char = await self.character("lol")
        lol_tournament = await self.tournament(self.ws, "lol", "lol-cup")
        rule = await achievement_rule_service.create_rule(self.session, workspace_id=self.ws.id, rule_data=self._data())
        for update in ({"entity_id": lol_char.id}, {"min_tournament_id": lol_tournament.id}):
            with self.subTest(update=update), self.assertRaises(BaseAPIException) as ctx:
                await achievement_rule_service.update_rule(
                    self.session, workspace_id=self.ws.id, rule_id=rule.id, update_data=dict(update)
                )
            self.assertEqual(422, ctx.exception.status_code)
        self.assertEqual((None, None), (rule.entity_id, rule.min_tournament_id))

    async def test_scope_references_share_workspace_and_discipline(self) -> None:
        other = await self.workspace("other")
        mine = await self.tournament(self.ws, "overwatch", "ow-cup")
        lol = await self.tournament(self.ws, "lol", "lol-cup")
        foreign = await self.tournament(other, "overwatch", "foreign-cup")
        ref = admin_reads.require_scope_refs
        await ref(self.session, workspace_id=self.ws.id, discipline="overwatch", tournament_id=mine.id)
        await ref(self.session, workspace_id=self.ws.id, discipline="overwatch")
        for tournament_id, status in ((lol.id, 422), (foreign.id, 404), (123456789, 404)):
            with self.subTest(tournament_id=tournament_id), self.assertRaises(BaseAPIException) as ctx:
                await ref(self.session, workspace_id=self.ws.id, discipline="overwatch", tournament_id=tournament_id)
            self.assertEqual(status, ctx.exception.status_code)
        with self.assertRaises(BaseAPIException) as ctx:
            await ref(self.session, workspace_id=self.ws.id, discipline="overwatch", match_id=123456789)
        self.assertEqual(404, ctx.exception.status_code)

    async def test_discipline_must_be_enabled_for_the_workspace(self) -> None:
        ow_only = await self.workspace("ow-only", enabled=("overwatch",))
        await admin_reads.get_workspace_for_discipline(self.session, ow_only.id, "overwatch")
        for discipline in ("lol", "chess"):
            with self.subTest(discipline=discipline), self.assertRaises(BaseAPIException) as ctx:
                await admin_reads.get_workspace_for_discipline(self.session, ow_only.id, discipline)
            self.assertEqual(422, ctx.exception.status_code)

    async def test_manual_rule_selection_is_concrete_and_discipline_bound(self) -> None:
        ow = await self.rule("ow-on", "overwatch", PLAYED_ONCE)
        off = await self.rule("ow-off", "overwatch", PLAYED_ONCE, enabled=False)
        lol = await self.rule("lol-on", "lol", {})
        await self.session.commit()
        resolve = admin_reads.resolve_rule_ids
        self.assertEqual(
            [ow.id], await resolve(self.session, workspace_id=self.ws.id, discipline="overwatch", rule_ids=None)
        )
        self.assertEqual([], await resolve(self.session, workspace_id=self.ws.id, discipline="overwatch", rule_ids=[]))
        self.assertEqual(
            sorted([ow.id, off.id]),
            await resolve(self.session, workspace_id=self.ws.id, discipline="overwatch", rule_ids=[off.id, ow.id]),
        )
        with self.assertRaises(BaseAPIException) as ctx:
            await resolve(self.session, workspace_id=self.ws.id, discipline="overwatch", rule_ids=[ow.id, lol.id])
        self.assertEqual(404, ctx.exception.status_code)

    async def test_rules_of_a_disabled_discipline_are_frozen_for_update_and_override(self) -> None:
        ow_only = await self.workspace("ow-only", enabled=("overwatch",))
        lol_rule = await self.rule("lol-frozen", "lol", {}, ws=ow_only)
        ow_rule = await self.rule("ow-live", "overwatch", PLAYED_ONCE, ws=ow_only)
        member_user = models.User(name=f"{self.tag}-ovr")
        admin = models.AuthUser(email=f"{self.tag}-ovr@example.test", username=f"{self.tag}-ovr")
        self.session.add_all([member_user, admin])
        await self.session.flush()
        await self.session.commit()
        with self.assertRaises(BaseAPIException) as ctx:
            await achievement_rule_service.update_rule(
                self.session, workspace_id=ow_only.id, rule_id=lol_rule.id, update_data={"enabled": False, "name": "x"}
            )
        self.assertEqual(422, ctx.exception.status_code)
        self.assertEqual("lol-frozen", lol_rule.name)

        def override_args(rule):  # noqa: ANN001, ANN202
            return {
                "workspace_id": ow_only.id,
                "rule_id": rule.id,
                "user_id": member_user.id,
                "granted_by": admin.id,
                "tournament_id": None,
                "match_id": None,
                "action": AchievementOverrideAction.grant,
                "reason": "test",
            }

        with self.assertRaises(BaseAPIException) as ctx:
            await achievement_rule_service.create_rule_override(self.session, **override_args(lol_rule))
        self.assertEqual(422, ctx.exception.status_code)
        self.assertEqual(0, await self.session.scalar(sa.select(sa.func.count()).select_from(AchievementOverride)))
        granted = await achievement_rule_service.create_rule_override(self.session, **override_args(ow_rule))
        self.assertEqual(ow_rule.id, granted.achievement_rule_id)


class PortableTests(_DbCase):
    def _payload(self, slug: str, **overrides) -> portable.PortableAchievementRule:  # noqa: ANN003
        fields = {
            "slug": slug,
            "name": slug,
            "description_ru": "RU",
            "description_en": "EN",
            "image_url": None,
            "discipline": "overwatch",
            "entity_id": None,
            "category": "overall",
            "scope": "global",
            "grain": "user",
            "condition_tree": PLAYED_ONCE,
            "depends_on": ["untrusted.export"],
            "enabled": True,
            "rule_version": 3,
            "min_tournament_id": None,
        }
        return portable.PortableAchievementRule(**{**fields, **overrides})

    async def _import(self, rules, workspace: models.Workspace | None = None):  # noqa: ANN001, ANN202
        return await portable.import_portable_rules(
            self.session, None, target_workspace=workspace or self.ws, rules=rules, source_workspace=None
        )

    async def test_export_then_import_round_trips_discipline_and_entity(self) -> None:
        char = await self.character("overwatch")
        original = await self.rule("round-trip", "overwatch", PLAYED_ONCE, entity_id=char.id)
        lol = await self.rule("lol-rule", "lol", {})
        await self.session.commit()

        exported = portable.build_export_payload(
            self.ws, await portable.load_rules_for_workspace(self.session, self.ws.id, discipline="overwatch")
        )
        self.assertEqual(2, exported["schema_version"])
        self.assertEqual(["round-trip"], [rule["slug"] for rule in exported["rules"]])  # the LoL rule is not exported
        envelope = schemas.AchievementRuleExportEnvelope.model_validate(exported)
        envelope.rules[0].depends_on = ["untrusted.export"]

        await _rules.delete(self.session, original)
        await self.session.commit()
        result = await self._import(envelope.rules)
        self.assertEqual({"created": 1, "updated": 0, "warnings": []}, result)
        restored = await self.session.scalar(sa.select(AchievementRule).where(AchievementRule.slug == "round-trip"))
        self.assertEqual(("overwatch", char.id), (restored.discipline, restored.entity_id))
        self.assertNotIn("untrusted.export", restored.depends_on)
        await self.session.refresh(lol)
        self.assertEqual("lol", lol.discipline)

        again = await self._import(envelope.rules)
        self.assertEqual({"created": 0, "updated": 1, "warnings": []}, again)

    async def test_one_bad_rule_rejects_the_whole_batch_without_touching_anything(self) -> None:
        ow_char = await self.character("overwatch")
        lol_char = await self.character("lol")
        existing = await self.rule("existing", "overwatch", PLAYED_ONCE, entity_id=ow_char.id)
        ow_map = await self.session.scalar(
            sa.insert(models.CatalogEntity)
            .values(discipline="overwatch", kind="map", slug=f"{self.tag}-map", name=f"{self.tag}-map")
            .returning(models.CatalogEntity.id)
        )
        await self.session.commit()
        before = await self.rule_slugs()
        bad_entities = {"foreign-game": lol_char.id, "missing": 987654321, "wrong-kind": ow_map}
        batch = [
            self._payload("fresh"),
            self._payload("existing", name="renamed", entity_id=None),
            *(self._payload(slug, entity_id=entity_id) for slug, entity_id in bad_entities.items()),
            self._payload("dup"),
            self._payload("dup"),
            self._payload("not-enabled", discipline="chess"),
            self._payload("bad-tree", condition_tree={"type": "no_such_leaf"}),
        ]
        with self.assertRaises(ValueError) as ctx:
            await self._import(batch)
        errors = {entry["slug"]: entry["errors"] for entry in ctx.exception.args[0]}
        self.assertEqual({*bad_entities, "dup", "not-enabled", "bad-tree"}, set(errors))
        for slug in bad_entities:
            self.assertTrue(errors[slug][0].startswith("entity_id:"), errors[slug])
        self.assertIn("slug: appears more than once in the payload", errors["dup"])
        self.assertTrue(errors["not-enabled"][0].startswith("discipline:"))

        self.assertEqual(before, await self.rule_slugs())
        await self.session.refresh(existing)
        self.assertEqual(("existing", ow_char.id), (existing.name, existing.entity_id))

    async def test_a_slug_owned_by_another_game_is_a_409_that_changes_nothing(self) -> None:
        lol = await self.rule("shared-slug", "lol", {})
        await self.session.commit()
        with self.assertRaises(BaseAPIException) as ctx:
            await self._import([self._payload("sibling"), self._payload("shared-slug")])
        self.assertEqual(409, ctx.exception.status_code)
        self.assertIn("shared-slug", ctx.exception.detail)
        await self.session.refresh(lol)
        self.assertEqual(("shared-slug", "lol", {}), (lol.name, lol.discipline, lol.condition_tree))
        self.assertEqual({"shared-slug"}, await self.rule_slugs())

    async def test_import_needs_the_discipline_enabled_in_the_target(self) -> None:
        ow_only = await self.workspace("ow-only", enabled=("overwatch",))
        with self.assertRaises(ValueError) as ctx:
            await self._import([self._payload("lol-rule", discipline="lol", condition_tree={})], ow_only)
        self.assertIn("discipline:", ctx.exception.args[0][0]["errors"][0])
        self.assertEqual(set(), await self.rule_slugs(ow_only))

    async def test_min_tournament_must_be_the_targets_and_the_rules_game(self) -> None:
        other = await self.workspace("elsewhere")
        mine = await self.tournament(self.ws, "overwatch", "ow-cup")
        lol_cup = await self.tournament(self.ws, "lol", "lol-cup")
        foreign = await self.tournament(other, "overwatch", "foreign-cup")
        await self.session.commit()
        before = await self.rule_slugs()
        bad = {"foreign-ws": foreign.id, "foreign-game": lol_cup.id, "invented": 987654321}
        batch = [
            self._payload("fresh", min_tournament_id=mine.id),
            *(self._payload(slug, min_tournament_id=tid) for slug, tid in bad.items()),
        ]
        with self.assertRaises(ValueError) as ctx:
            await self._import(batch)
        errors = {entry["slug"]: entry["errors"] for entry in ctx.exception.args[0]}
        self.assertEqual(set(bad), set(errors))
        for slug in bad:
            self.assertTrue(errors[slug][0].startswith("min_tournament_id:"), errors[slug])
        self.assertEqual(before, await self.rule_slugs())  # nothing written, the valid sibling included

        result = await self._import([self._payload("fresh", min_tournament_id=mine.id)])
        self.assertEqual(1, result["created"])

    def _wire(self, slug: str, **overrides) -> schemas.AchievementRulePortable:  # noqa: ANN003
        """The real pydantic wire type the RPC handlers pass in (a dataclass-only fake once hid a TypeError)."""
        fields = {k: v for k, v in dataclasses.asdict(self._payload(slug)).items() if k != "depends_on"}
        return schemas.AchievementRulePortable(**{**fields, **overrides})

    async def test_cross_workspace_import_drops_the_cutoff_with_a_warning(self) -> None:
        source = await self.workspace("source")
        theirs = await self.tournament(source, "overwatch", "their-cup")
        mine = await self.tournament(self.ws, "overwatch", "my-cup")
        existing = await self.rule("kept", "overwatch", PLAYED_ONCE)
        existing.min_tournament_id = mine.id
        await self.session.commit()
        incoming = [
            self._wire("copied", min_tournament_id=theirs.id),
            self._wire("plain"),
            self._wire("kept", min_tournament_id=theirs.id, name="renamed"),
        ]
        result = await portable.import_portable_rules(
            self.session, None, target_workspace=self.ws, rules=incoming, source_workspace=source
        )
        self.assertEqual((2, 1), (result["created"], result["updated"]))
        self.assertEqual(
            ["copied", "kept"], [w["slug"] for w in result["warnings"] if "min_tournament_id" in w["message"]]
        )
        self.assertEqual(theirs.id, incoming[0].min_tournament_id)  # the caller's payloads are not mutated
        rules = {r.slug: r for r in await portable.load_rules_for_workspace(self.session, self.ws.id, discipline=None)}
        self.assertEqual(None, rules["copied"].min_tournament_id)
        self.assertEqual(None, rules["plain"].min_tournament_id)
        self.assertEqual((mine.id, "renamed"), (rules["kept"].min_tournament_id, rules["kept"].name))  # cutoff kept

    async def test_lib_import_rpc_copies_a_rule_that_has_a_cutoff(self) -> None:
        import logging
        from unittest.mock import AsyncMock, patch

        from src.rpc import achievements as achievements_rpc
        from tests._fakes import FakeBroker, active_identity, session_factory

        source = await self.workspace("lib-source")
        theirs = await self.tournament(source, "overwatch", "lib-cup")
        library_rule = await self.rule("lib-rule", "overwatch", PLAYED_ONCE, ws=source)
        library_rule.min_tournament_id = theirs.id
        await self.session.commit()

        broker = FakeBroker()
        with (
            patch.object(achievements_rpc, "_SF", session_factory(self.session)),
            patch.object(achievements_rpc.quota, "charge", AsyncMock()),
        ):
            achievements_rpc.register(broker, logging.getLogger("lib-import-test"))
            reply = await broker.handlers["rpc.stats.ach.lib_import"](
                {
                    "identity": active_identity(),
                    "workspace_id": self.ws.id,
                    "payload": {"source_workspace_id": source.id, "discipline": "overwatch", "slugs": ["lib-rule"]},
                },
                None,
            )
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(1, reply["data"]["created"])
        self.assertEqual(["lib-rule"], [w["slug"] for w in reply["data"]["warnings"]])
        copied = (await portable.load_rules_for_workspace(self.session, self.ws.id, discipline="overwatch"))[0]
        self.assertEqual(("lib-rule", None), (copied.slug, copied.min_tournament_id))

    async def test_same_workspace_import_with_a_source_still_validates_the_cutoff(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            await portable.import_portable_rules(
                self.session,
                None,
                target_workspace=self.ws,
                rules=[self._payload("invented", min_tournament_id=987654321)],
                source_workspace=self.ws,
            )
        self.assertTrue(ctx.exception.args[0][0]["errors"][0].startswith("min_tournament_id:"))


class SeedAndResetTests(_DbCase):
    async def _lol_sentinel(self):  # noqa: ANN202
        member = await self.member(self.ws, "lol-player")
        rule = await self.rule("lol-sentinel", "lol", {})
        await self.award(rule, member)
        await AchievementOverrideRepository().create(
            self.session,
            AchievementOverride(
                achievement_rule_id=rule.id,
                workspace_member_id=member.id,
                action=AchievementOverrideAction.grant,
                reason="sentinel",
                granted_by=await self._auth_user(),
            ),
        )
        await self.session.commit()
        return rule, member

    async def _auth_user(self) -> int:
        user = models.AuthUser(email=f"{self.tag}@example.test", username=self.tag)
        self.session.add(user)
        await self.session.flush()
        return user.id

    async def _lol_survives(self, rule, member) -> None:  # noqa: ANN001
        self.assertEqual({"lol-sentinel"}, await self.rule_slugs(discipline="lol"))
        self.assertEqual({member.player_id}, await self.awards_of(rule))
        self.assertEqual(
            1,
            await self.session.scalar(
                sa.select(sa.func.count())
                .select_from(AchievementOverride)
                .where(AchievementOverride.achievement_rule_id == rule.id)
            ),
        )

    async def test_seed_and_reset_replace_only_their_own_catalog(self) -> None:
        rule, member = await self._lol_sentinel()
        stale = await self.rule("ow-not-in-catalog", "overwatch", PLAYED_ONCE)
        ow_member = await self.member(self.ws, "ow-player")
        await self.award(stale, ow_member)
        await self.session.commit()
        seeder = AchievementSeederService()

        seeded, removed = await seeder.seed_workspace(self.session, self.ws.id, discipline="overwatch")
        self.assertGreater(seeded, 0)
        self.assertEqual(0, removed)  # no replace_catalog
        await self._lol_survives(rule, member)
        self.assertIn("ow-not-in-catalog", await self.rule_slugs(discipline="overwatch"))

        seeded_again, removed_again, cleared, run = await seeder.hard_reset_workspace(
            self.session, self.ws.id, discipline="overwatch"
        )
        self.assertEqual(seeded, seeded_again)
        self.assertEqual(1, removed_again)  # only the OW rule the OW catalog does not list
        self.assertGreaterEqual(cleared, 0)
        self.assertEqual(EvaluationRunStatus.done, run.status, run.error_message)
        self.assertNotIn("ow-not-in-catalog", await self.rule_slugs())
        await self._lol_survives(rule, member)

    async def test_a_game_without_a_catalog_is_refused_before_anything_is_deleted(self) -> None:
        rule, member = await self._lol_sentinel()
        await AchievementSeederService().seed_workspace(self.session, self.ws.id, discipline="overwatch")
        before = await self.rule_slugs()
        for replace in (False, True):
            with self.subTest(replace=replace), self.assertRaises(BaseAPIException) as ctx:
                await AchievementSeederService().seed_workspace(
                    self.session, self.ws.id, discipline="lol", replace_catalog=replace
                )
            self.assertEqual(422, ctx.exception.status_code)
        with self.assertRaises(BaseAPIException):
            await AchievementSeederService().hard_reset_workspace(self.session, self.ws.id, discipline="lol")
        self.assertEqual(before, await self.rule_slugs())
        await self._lol_survives(rule, member)

    async def test_seeding_over_another_games_slug_is_a_409_before_any_write(self) -> None:
        catalog = discipline_spec("overwatch").achievement_catalog
        catalog_slug = next(iter(sorted(rule.slug for rule in catalog(self.ws.id, []))))
        squatter = await self.rule(catalog_slug, "lol", {})
        keep = await self.rule("ow-keeper", "overwatch", PLAYED_ONCE)
        await self.session.commit()
        for replace in (False, True):
            with self.subTest(replace=replace), self.assertRaises(BaseAPIException) as ctx:
                await AchievementSeederService().seed_workspace(
                    self.session, self.ws.id, discipline="overwatch", replace_catalog=replace
                )
            self.assertEqual(409, ctx.exception.status_code)
        self.assertEqual({catalog_slug, "ow-keeper"}, await self.rule_slugs())
        await self.session.refresh(squatter)
        await self.session.refresh(keep)
        self.assertEqual("lol", squatter.discipline)
        self.assertEqual("overwatch", keep.discipline)


class RunnerScopeTests(_DbCase):
    """Rule selection follows the trigger's owner, and every cache follows the rule's discipline."""

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.ow_member = await self.member(self.ws, "ow")
        self.lol_member = await self.member(self.ws, "lol")
        self.ow_cup = await self.tournament(self.ws, "overwatch", "ow-cup", players=(self.ow_member,))
        self.lol_cup = await self.tournament(self.ws, "lol", "lol-cup", players=(self.lol_member,))
        self.ow_rule = await self.rule("ow-played", "overwatch", PLAYED_ONCE)
        # An empty tree is a valid LoL rule: the game registers no conditions.
        self.lol_rule = await self.rule("lol-empty", "lol", {})
        await self.award(self.lol_rule, self.lol_member)

    async def test_a_tournament_trigger_evaluates_only_that_games_rules(self) -> None:
        run = await self.evaluate(tournament_id=self.ow_cup.id)
        self.assertEqual(EvaluationRunStatus.done, run.status, run.error_message)
        self.assertEqual(1, run.rules_evaluated)  # the Overwatch rule only
        self.assertEqual({self.ow_member.player_id}, await self.awards_of(self.ow_rule))
        # The LoL player is not an Overwatch participant, and the LoL award was not diffed away.
        self.assertEqual({self.lol_member.player_id}, await self.awards_of(self.lol_rule))

    async def test_a_workspace_wide_run_partitions_rules_by_their_stored_discipline(self) -> None:
        run = await self.evaluate()
        self.assertEqual(EvaluationRunStatus.done, run.status, run.error_message)
        self.assertEqual(2, run.rules_evaluated)
        self.assertEqual({self.ow_member.player_id}, await self.awards_of(self.ow_rule))
        # The empty LoL tree is an explicit cleanup, applied in the LoL context only.
        self.assertEqual(set(), await self.awards_of(self.lol_rule))

    async def test_a_game_with_no_conditions_reports_failure_instead_of_erasing_awards(self) -> None:
        broken = await self.rule("lol-with-ow-tree", "lol", PLAYED_ONCE)
        await self.award(broken, self.lol_member)
        run = await self.evaluate(rule_ids=[broken.id, self.ow_rule.id])
        self.assertEqual(EvaluationRunStatus.partial, run.status)
        self.assertIn("lol-with-ow-tree", run.error_message)
        self.assertIn("no achievement conditions", run.error_message)
        self.assertEqual(1, run.rules_evaluated)
        self.assertEqual({self.lol_member.player_id}, await self.awards_of(broken))
        self.assertEqual({self.ow_member.player_id}, await self.awards_of(self.ow_rule))

    async def test_none_is_unrestricted_empty_is_nothing_and_explicit_ids_may_name_disabled_rules(self) -> None:
        disabled = await self.rule("ow-disabled", "overwatch", PLAYED_ONCE, enabled=False)
        await self.award(disabled, self.ow_member)

        nothing = await self.evaluate(rule_ids=[])
        self.assertEqual((EvaluationRunStatus.done, 0), (nothing.status, nothing.rules_evaluated))
        self.assertEqual({self.ow_member.player_id}, await self.awards_of(disabled))
        self.assertEqual(set(), await self.awards_of(self.ow_rule))

        everything = await self.evaluate(rule_ids=None)
        self.assertEqual(2, everything.rules_evaluated)  # enabled rules only: ow-played and lol-empty
        self.assertEqual({self.ow_member.player_id}, await self.awards_of(disabled))

        cleaned = await self.evaluate(rule_ids=[disabled.id])
        self.assertEqual(1, cleaned.rules_evaluated)
        self.assertEqual(set(), await self.awards_of(disabled))

    async def test_a_foreign_trigger_owner_fails_the_run(self) -> None:
        other = await self.workspace("elsewhere")
        foreign = await self.tournament(other, "overwatch", "foreign-cup")
        foreign_id, ws_id = foreign.id, self.ws.id
        with self.assertRaises(ValueError):
            await self.evaluate(tournament_id=foreign_id)
        # The failed run rolled the session back; reload what the assertions read.
        await self.session.refresh(self.lol_rule)
        await self.session.refresh(self.lol_member)
        self.assertEqual({self.lol_member.player_id}, await self.awards_of(self.lol_rule))
        statuses = await self.session.scalars(
            sa.select(models.EvaluationRun.status).where(models.EvaluationRun.workspace_id == ws_id)
        )
        self.assertEqual({EvaluationRunStatus.failed}, set(statuses))

    async def test_grids_normalizers_and_leaf_caches_are_per_discipline(self) -> None:
        caches = runner._RunCaches(self.session, self.ws.id)
        self.assertIsNot(caches.leaf_cache("overwatch"), caches.leaf_cache("lol"))
        self.assertIs(caches.leaf_cache("lol"), caches.leaf_cache("lol"))
        self.assertTrue((await caches.grid("overwatch", None)).tiers)
        # LoL has no ladder and this workspace gave it no grid: its failure is its own, and remembered.
        with self.assertRaises(BaseAPIException) as first:
            await caches.grid("lol", None)
        with self.assertRaises(BaseAPIException) as second:
            await caches.grid("lol", None)
        self.assertIs(first.exception, second.exception)
        self.assertTrue((await caches.grid("overwatch", self.ow_cup)).tiers)

    async def test_deferred_run_persists_the_resolved_selection(self) -> None:
        self.ws.verification_status = "unverified"
        await self.session.flush()
        published: list[dict] = []

        async def enqueue(_session, event, **_kwargs):  # noqa: ANN001, ANN003, ANN202
            published.append(event.model_dump())

        with patch.object(runner, "enqueue_outbox_event", enqueue):
            await self.session.commit()
            service = runner.AchievementEvaluationRunnerService()
            for rule_ids in (None, [], [self.ow_rule.id]):
                queued = await service.run_evaluation(
                    self.session,
                    self.ws.id,
                    EvaluationRunTrigger.manual,
                    tournament_id=self.ow_cup.id,
                    rule_ids=rule_ids,
                )
                self.assertEqual(EvaluationRunStatus.queued, queued.status)

        # None resolved to the trigger discipline's enabled rules; [] stayed an empty selection, not "all".
        self.assertEqual([[self.ow_rule.id], [], [self.ow_rule.id]], [message["rule_ids"] for message in published])

        # A rule that appears while the message waits is not evaluated by it.
        late = await self.rule("ow-late", "overwatch", PLAYED_ONCE)
        await self.session.commit()
        for message, expected in zip(published, (1, 0, 1), strict=True):
            event = AchievementEvaluateEvent.model_validate(message)
            resumed = await runner.AchievementEvaluationRunnerService().resume_queued_run(self.session, event)
            self.assertEqual(EvaluationRunStatus.done, resumed.status, resumed.error_message)
            self.assertEqual(expected, resumed.rules_evaluated)
        self.assertEqual(set(), await self.awards_of(late))

    async def test_force_grant_and_revoke_survive_recompute_inside_their_discipline(self) -> None:
        admin = models.AuthUser(email=f"{self.tag}-admin@example.test", username=f"{self.tag}-admin")
        self.session.add(admin)
        await self.session.flush()
        other = await self.member(self.ws, "other-ow")
        overrides = AchievementOverrideRepository()
        # Revoke the player the evaluation awards, force-grant one it does not, and grant twice to test dedup.
        for member, action in (
            (self.ow_member, AchievementOverrideAction.revoke),
            (other, AchievementOverrideAction.grant),
            (other, AchievementOverrideAction.grant),
        ):
            await overrides.create(
                self.session,
                AchievementOverride(
                    achievement_rule_id=self.ow_rule.id,
                    workspace_member_id=member.id,
                    action=action,
                    reason="test",
                    granted_by=admin.id,
                ),
            )
        await self.session.commit()

        async def effective(rule: AchievementRule) -> list[int]:
            rows = build_effective_achievement_rows_subquery(
                workspace_id=self.ws.id, achievement_rule_ids=[rule.id], name="effective"
            )
            return sorted(await self.session.scalars(sa.select(rows.c.user_id)))

        for expected_awards in (set(), {self.ow_member.player_id}):  # before the recompute, then after it
            self.assertEqual(expected_awards, await self.awards_of(self.ow_rule))
            self.assertEqual([other.player_id], await effective(self.ow_rule))
            self.assertEqual([self.lol_member.player_id], await effective(self.lol_rule))
            run = await self.evaluate(rule_ids=[self.ow_rule.id])
            self.assertEqual(EvaluationRunStatus.done, run.status, run.error_message)
        self.assertEqual({self.lol_member.player_id}, await self.awards_of(self.lol_rule))
