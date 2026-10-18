from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
STATS_SERVICE_ROOT = REPO_BACKEND_ROOT / "stats-service"

for candidate in (str(REPO_BACKEND_ROOT), str(STATS_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


from shared.models.achievements.achievement import AchievementRule  # noqa: E402
from shared.models.tenancy.workspace import Workspace  # noqa: E402
from src import schemas  # noqa: E402
from src.services.achievement.import_export import (  # noqa: E402
    PortableAchievementRule,
    build_export_payload,
    copy_workspace_achievement_image,
    import_portable_rules,
)


class ExportPayloadTests(TestCase):
    def test_build_export_payload_contains_only_definition_fields(self) -> None:
        workspace = Workspace(id=7, slug="source-ws", name="Source")
        rule = AchievementRule(
            id=42,
            workspace_id=7,
            slug="alpha",
            name="Alpha",
            description_ru="RU",
            description_en="EN",
            image_url="http://cdn/assets/achievements/source-ws/alpha.webp",
            discipline="overwatch",
            entity_id=3,
            category="overall",
            scope="global",
            grain="user",
            condition_tree={"type": "match_win"},
            depends_on=["stats.fact", "stats.match"],
            enabled=True,
            rule_version=5,
            min_tournament_id=12,
        )

        payload = build_export_payload(workspace, [rule])

        self.assertEqual(2, payload["schema_version"])
        self.assertEqual("overwatch", payload["rules"][0]["discipline"])
        self.assertEqual(3, payload["rules"][0]["entity_id"])
        self.assertEqual({"id", "slug", "name"}, set(payload["source_workspace"]))
        self.assertEqual(
            {
                "slug",
                "name",
                "description_ru",
                "description_en",
                "image_url",
                "discipline",
                "entity_id",
                "category",
                "scope",
                "grain",
                "condition_tree",
                "depends_on",
                "enabled",
                "rule_version",
                "min_tournament_id",
            },
            set(payload["rules"][0]),
        )


class CopyImageTests(IsolatedAsyncioTestCase):
    async def test_copy_workspace_achievement_image_rewrites_asset_into_target_workspace(self) -> None:
        s3 = SimpleNamespace(
            _public_url="http://cdn/bucket",
            get_object=AsyncMock(return_value=b"img-bytes"),
            head_object=AsyncMock(return_value={"ContentType": "image/webp"}),
            # The source workspace's real asset inventory is the allow-list.
            list_objects=AsyncMock(return_value=["assets/achievements/source/alpha.webp"]),
        )
        source_workspace = Workspace(id=1, slug="source", name="Source")
        target_workspace = Workspace(id=2, slug="target", name="Target")

        with patch(
            "src.services.achievement.import_export.upload_asset",
            AsyncMock(
                return_value=SimpleNamespace(
                    success=True, public_url="http://cdn/bucket/assets/achievements/target/alpha.webp", error=None
                )
            ),
        ) as upload_mock:
            copied_url, warning = await copy_workspace_achievement_image(
                s3,
                source_workspace=source_workspace,
                target_workspace=target_workspace,
                slug="alpha",
                image_url="http://cdn/bucket/assets/achievements/source/alpha.webp",
            )

        self.assertEqual("http://cdn/bucket/assets/achievements/target/alpha.webp", copied_url)
        self.assertIsNone(warning)
        upload_mock.assert_awaited_once()
        s3.get_object.assert_awaited_once_with("assets/achievements/source/alpha.webp")

    async def test_copy_rejects_image_url_pointing_outside_source_workspace(self) -> None:
        """C3: a crafted image_url resolving to a foreign object key must never
        be fetched/copied, even when it shares the bucket's public base URL."""
        s3 = SimpleNamespace(
            _public_url="http://cdn/bucket",
            get_object=AsyncMock(return_value=b"stolen-bytes"),
            head_object=AsyncMock(return_value={"ContentType": "text/plain"}),
            # Only the source workspace's own asset is listed; the foreign key is not.
            list_objects=AsyncMock(return_value=["assets/achievements/source/legit.webp"]),
        )
        source_workspace = Workspace(id=1, slug="source", name="Source")
        target_workspace = Workspace(id=2, slug="target", name="Target")

        with patch(
            "src.services.achievement.import_export.upload_asset",
            AsyncMock(),
        ) as upload_mock:
            copied_url, warning = await copy_workspace_achievement_image(
                s3,
                source_workspace=source_workspace,
                target_workspace=target_workspace,
                slug="alpha",
                image_url="http://cdn/bucket/logs/99/secret.replay",
            )

        self.assertIsNone(copied_url)
        self.assertIsNotNone(warning)
        upload_mock.assert_not_awaited()
        # The foreign object must never be read.
        s3.get_object.assert_not_awaited()


class ImportRulesTests(IsolatedAsyncioTestCase):
    async def test_import_portable_rules_raises_on_validation_errors(self) -> None:
        target_workspace = Workspace(id=10, slug="target", name="Target", disciplines_enabled=["overwatch"])
        payload = PortableAchievementRule(
            slug="broken",
            name="Broken",
            description_ru="RU",
            description_en="EN",
            image_url=None,
            discipline="overwatch",
            entity_id=None,
            category="overall",
            scope="global",
            grain="user",
            condition_tree={"type": "bad"},
            depends_on=[],
            enabled=True,
            rule_version=1,
            min_tournament_id=None,
        )

        with patch(
            "src.services.achievement.import_export.validate_rule_definition",
            return_value=(["invalid rule"], None),
        ):
            with self.assertRaises(ValueError) as ctx:
                await import_portable_rules(
                    session=SimpleNamespace(add=lambda _obj: None),
                    s3=None,
                    target_workspace=target_workspace,
                    rules=[payload],
                    source_workspace=None,
                )

        self.assertEqual([{"slug": "broken", "errors": ["invalid rule"]}], ctx.exception.args[0])


def _portable(**overrides: object) -> dict:
    return {
        "slug": "alpha",
        "name": "Alpha",
        "description_ru": "RU",
        "description_en": "EN",
        "discipline": "overwatch",
        "category": "overall",
        "scope": "global",
        "grain": "user",
        "condition_tree": {},
        **overrides,
    }


class WireFormatTests(TestCase):
    """Portable v2 only; the retired v1 shape fails explicitly on every request shape that can carry it."""

    def test_v2_envelope_round_trips_discipline_and_entity(self) -> None:
        envelope = schemas.AchievementRuleExportEnvelope.model_validate(
            {"schema_version": 2, "exported_at": "2026-10-18T00:00:00Z", "rules": [_portable(entity_id=3)]}
        )
        self.assertEqual(("overwatch", 3), (envelope.rules[0].discipline, envelope.rules[0].entity_id))

    def test_v1_and_unknown_versions_are_explicit_errors(self) -> None:
        for version in (1, 3, "2"):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "unsupported schema_version"):
                schemas.AchievementRuleExportEnvelope.model_validate(
                    {"schema_version": version, "exported_at": "2026-10-18T00:00:00Z", "rules": []}
                )
        with self.assertRaises(ValueError):  # the version is required, never defaulted
            schemas.AchievementRuleExportEnvelope.model_validate({"exported_at": "2026-10-18T00:00:00Z", "rules": []})

    def test_hero_id_is_rejected_on_every_rule_request_shape(self) -> None:
        body = _portable(hero_id=3)
        for model in (schemas.AchievementRulePortable, schemas.AchievementRuleCreate):
            with self.subTest(model=model.__name__), self.assertRaisesRegex(ValueError, "hero_id is no longer"):
                model.model_validate(body)
        with self.assertRaisesRegex(ValueError, "hero_id is no longer"):
            schemas.AchievementRuleUpdate.model_validate({"hero_id": 3})
        with self.assertRaisesRegex(ValueError, "hero_id is no longer"):
            schemas.AchievementRuleExportEnvelope.model_validate(
                {"schema_version": 2, "exported_at": "2026-10-18T00:00:00Z", "rules": [body]}
            )

    def test_discipline_is_required_on_create_and_never_updatable(self) -> None:
        body = _portable()
        del body["discipline"]
        with self.assertRaises(ValueError):
            schemas.AchievementRuleCreate.model_validate(body)
        with self.assertRaisesRegex(ValueError, "discipline is immutable"):
            schemas.AchievementRuleUpdate.model_validate({"discipline": "lol"})
        with self.assertRaises(ValueError):  # an extra field is not silently ignored either
            schemas.AchievementRuleUpdate.model_validate({"unexpected": 1})

    def test_update_distinguishes_omitted_null_and_empty(self) -> None:
        omitted = schemas.AchievementRuleUpdate.model_validate({"name": "x"}).model_dump(exclude_unset=True)
        cleared = schemas.AchievementRuleUpdate.model_validate({"entity_id": None, "condition_tree": {}}).model_dump(
            exclude_unset=True
        )
        self.assertEqual({"name": "x"}, omitted)
        self.assertEqual({"entity_id": None, "condition_tree": {}}, cleared)
        with self.assertRaisesRegex(ValueError, "cannot be null"):
            schemas.AchievementRuleUpdate.model_validate({"condition_tree": None})
