from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
PARSER_SERVICE_ROOT = REPO_BACKEND_ROOT / "parser-service"

for candidate in (str(REPO_BACKEND_ROOT), str(PARSER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")

from shared.core.enums import StageType  # noqa: E402
from shared.models.achievement import AchievementGrain, AchievementRule  # noqa: E402
from shared.services.achievement_effective import override_applies_to_scope  # noqa: E402

from src.services.achievement.engine.conditions.tournament_format import (  # noqa: E402
    matches_tournament_format,
)
from src.services.achievement.engine.differ import EvaluationSlice, diff_and_apply  # noqa: E402
from src.services.achievement.engine.seeder import (  # noqa: E402
    _all_default_rules,
    get_canonical_rule_catalog,
)
from src.services.achievement.engine.validation import infer_grain, validate_condition_tree  # noqa: E402


def _legacy_rule_catalog() -> dict[str, tuple[str, str, str]]:
    catalog: dict[str, tuple[str, str, str]] = {}
    for achievement in get_canonical_rule_catalog():
        catalog[achievement.slug] = (
            achievement.name,
            achievement.description_ru,
            achievement.description_en,
        )
    return catalog


EXPECTED_LEGACY_RULES = _legacy_rule_catalog()


class DiffScopeTests(IsolatedAsyncioTestCase):
    async def test_tournament_scoped_diff_does_not_delete_other_tournament_results(self) -> None:
        rule = AchievementRule(id=7, slug="afgan", rule_version=3)

        async def execute_side_effect(query):
            sql = str(query)
            if "SELECT achievements.evaluation_result.id" in sql:
                if "tournament_id" in sql and "=" in sql:
                    return [
                        (101, 55, 10, None),
                    ]
                return [
                    (101, 55, 10, None),
                    (202, 55, 20, None),
                ]
            return None

        session = SimpleNamespace(
            execute=AsyncMock(side_effect=execute_side_effect),
            add=lambda _row: None,
        )

        diff = await diff_and_apply(
            session=session,
            rule=rule,
            new_results={(55, 10)},
            run_id="run-1",
            evaluation_slice=EvaluationSlice(tournament_id=10),
        )

        self.assertEqual([], diff.to_delete)


class ValidationTests(TestCase):
    def test_rejects_top_level_player_role_condition(self) -> None:
        errors = validate_condition_tree({"type": "player_role", "params": {"role": "Damage"}})
        self.assertTrue(any("top-level" in error for error in errors))

    def test_distinct_count_with_tournament_scope_infers_tournament_grain(self) -> None:
        grain = infer_grain(
            {
                "type": "distinct_count",
                "params": {"field": "hero", "op": ">=", "value": 7, "scope": "tournament"},
            }
        )
        self.assertEqual(AchievementGrain.user_tournament, grain)

    def test_default_rule_grains_match_inferred_grains(self) -> None:
        mismatches = [
            (rule.slug, rule.grain, infer_grain(rule.condition_tree))
            for rule in _all_default_rules(1)
            if rule.condition_tree and infer_grain(rule.condition_tree) != rule.grain
        ]
        self.assertEqual([], mismatches)

    def test_default_rule_catalog_matches_legacy_consts(self) -> None:
        rules = {rule.slug: rule for rule in _all_default_rules(1)}
        self.assertEqual(sorted(EXPECTED_LEGACY_RULES), sorted(rules))

        metadata_mismatches = [
            (
                slug,
                EXPECTED_LEGACY_RULES[slug],
                (
                    rules[slug].name,
                    rules[slug].description_ru,
                    rules[slug].description_en,
                ),
            )
            for slug in sorted(EXPECTED_LEGACY_RULES)
            if (
                rules[slug].name,
                rules[slug].description_ru,
                rules[slug].description_en,
            ) != EXPECTED_LEGACY_RULES[slug]
        ]
        self.assertEqual([], metadata_mismatches)


class TournamentFormatTests(TestCase):
    def test_round_robin_detected_from_stage_type(self) -> None:
        self.assertTrue(matches_tournament_format({StageType.ROUND_ROBIN}, "round_robin"))
        self.assertFalse(matches_tournament_format({StageType.ROUND_ROBIN}, "has_bracket"))

    def test_single_elimination_detected_from_stage_type(self) -> None:
        self.assertTrue(matches_tournament_format({StageType.SINGLE_ELIMINATION}, "single_elim"))
        self.assertTrue(matches_tournament_format({StageType.SINGLE_ELIMINATION}, "has_bracket"))
        self.assertFalse(matches_tournament_format({StageType.SINGLE_ELIMINATION}, "double_elim"))

    def test_double_elimination_detected_from_stage_type(self) -> None:
        self.assertTrue(matches_tournament_format({StageType.DOUBLE_ELIMINATION}, "double_elim"))
        self.assertTrue(matches_tournament_format({StageType.DOUBLE_ELIMINATION}, "has_bracket"))
        self.assertFalse(matches_tournament_format({StageType.DOUBLE_ELIMINATION}, "single_elim"))


class OverrideScopeTests(TestCase):
    def test_global_revoke_matches_any_scope(self) -> None:
        self.assertTrue(override_applies_to_scope(None, None, None, None))
        self.assertTrue(override_applies_to_scope(None, None, 10, None))
        self.assertTrue(override_applies_to_scope(None, None, 10, 501))

    def test_tournament_revoke_matches_tournament_and_match_rows_in_same_tournament(self) -> None:
        self.assertTrue(override_applies_to_scope(10, None, 10, None))
        self.assertTrue(override_applies_to_scope(10, None, 10, 501))
        self.assertFalse(override_applies_to_scope(10, None, 11, None))

    def test_match_revoke_matches_only_exact_match(self) -> None:
        self.assertTrue(override_applies_to_scope(10, 501, 10, 501))
        self.assertFalse(override_applies_to_scope(10, 501, 10, 502))
        self.assertFalse(override_applies_to_scope(10, 501, 10, None))
