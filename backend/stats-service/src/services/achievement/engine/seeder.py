"""Workspace seeder for the achievement engine.

Default rule metadata (the canonical catalog + pure rule-builder functions)
belongs to the discipline module and is reached through ``DisciplineSpec.achievement_catalog``; this module keeps only the
DB-touching ``seed_workspace``/``hard_reset_workspace`` orchestration, wrapped
in one class + singleton per ``backend/ARCHITECTURE.md``.
"""

from __future__ import annotations

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import BaseAPIException as HTTPException
from shared.disciplines import discipline as discipline_spec
from shared.domain.achievements.validation import derive_depends_on, infer_grain
from shared.models.achievements.achievement import (
    AchievementRule,
    EvaluationRun,
    EvaluationRunTrigger,
)
from shared.models.catalog.entity import CatalogEntity
from shared.repository.support import AchievementEvaluationResultRepository, AchievementRuleRepository
from src.services.achievement.admin_reads import resolve_rule_ids

from .runner import AchievementEvaluationRunnerService, achievement_evaluation_runner_service


class AchievementSeederService:
    def __init__(
        self,
        *,
        rule_repo: AchievementRuleRepository = AchievementRuleRepository(),
        results_repo: AchievementEvaluationResultRepository = AchievementEvaluationResultRepository(),
        runner: AchievementEvaluationRunnerService = achievement_evaluation_runner_service,
    ) -> None:
        self.rule_repo = rule_repo
        self.results_repo = results_repo
        self.runner = runner

    async def seed_workspace(
        self,
        session: AsyncSession,
        workspace_id: int,
        *,
        discipline: str,
        replace_catalog: bool = False,
    ) -> tuple[int, int]:
        """Seed ``discipline``'s default achievement catalog for a workspace (upsert).

        If a rule with the same slug already exists in the workspace, its metadata
        and engine definition are updated in place. A same-slug rule of *another*
        discipline is a 409 raised before anything is written: the slug identity is
        per workspace and that rule is not ours to touch.

        When `replace_catalog=True`, this discipline's rules that the catalog no
        longer lists are removed; other disciplines' rules are never candidates.

        A discipline without an achievement catalog is rejected up front, before any
        deletion. Character rules are generated from that discipline's live
        ``catalog.entity`` characters, so heroes synced from OW automatically get an
        achievement on the next seed.
        """
        catalog = discipline_spec(discipline).achievement_catalog
        if catalog is None:
            raise HTTPException(
                status_code=422, detail=f"discipline {discipline!r} declares no achievement catalog to seed"
            )

        characters = list(
            (
                await session.execute(
                    sa.select(CatalogEntity).where(
                        CatalogEntity.discipline == discipline, CatalogEntity.kind == "character"
                    )
                )
            ).scalars()
        )
        all_rules = catalog(workspace_id, characters)
        count = 0
        removed = 0
        supported_slugs = {rule.slug for rule in all_rules}

        existing_rules = list(
            (
                await session.execute(
                    sa.select(AchievementRule).where(
                        AchievementRule.workspace_id == workspace_id,
                    )
                )
            ).scalars()
        )
        existing_by_slug = {rule.slug: rule for rule in existing_rules}

        # Everything that can reject the seed runs before the first write.
        for rule in all_rules:
            if rule.discipline != discipline:
                raise ValueError(f"Seed rule '{rule.slug}' belongs to {rule.discipline!r}, not {discipline!r}")
            rule.depends_on = derive_depends_on(rule.condition_tree, discipline=discipline)
            if rule.condition_tree:
                inferred_grain = infer_grain(rule.condition_tree, discipline=discipline)
                if inferred_grain != rule.grain:
                    raise ValueError(
                        f"Seed rule '{rule.slug}' has grain '{rule.grain}' but infers '{inferred_grain.value}'"
                    )
            other = existing_by_slug.get(rule.slug)
            if other is not None and other.discipline != discipline:
                raise HTTPException(
                    status_code=409,
                    detail=f"Slug '{rule.slug}' already exists in this workspace for discipline {other.discipline!r}",
                )

        if replace_catalog:
            for existing in existing_rules:
                if existing.discipline != discipline or existing.slug in supported_slugs:
                    continue
                await self.rule_repo.delete(session, existing)
                removed += 1

        for rule in all_rules:
            existing = existing_by_slug.get(rule.slug)

            if existing:
                updates = {
                    "condition_tree": rule.condition_tree,
                    "category": rule.category,
                    "scope": rule.scope,
                    "grain": rule.grain,
                    "depends_on": rule.depends_on,
                    "name": rule.name,
                    "description_ru": rule.description_ru,
                    "description_en": rule.description_en,
                    "min_tournament_id": rule.min_tournament_id,
                }
                # Preserve admin-customised images on non-character rules.
                if rule.entity_id is not None:
                    updates["entity_id"] = rule.entity_id
                if rule.image_url is not None:
                    updates["image_url"] = rule.image_url
                await self.rule_repo.update_fields(session, existing, updates)
            else:
                await self.rule_repo.create(session, rule)

            count += 1

        await session.commit()
        logger.info(
            "Seeded workspace {} ({}) with {} achievement rules (upsert), removed {}",
            workspace_id,
            discipline,
            count,
            removed,
        )
        return count, removed

    async def hard_reset_workspace(
        self,
        session: AsyncSession,
        workspace_id: int,
        *,
        discipline: str,
    ) -> tuple[int, int, int, EvaluationRun]:
        seeded, removed = await self.seed_workspace(
            session,
            workspace_id,
            discipline=discipline,
            replace_catalog=True,
        )

        discipline_rule_ids = sa.select(AchievementRule.id).where(
            AchievementRule.workspace_id == workspace_id, AchievementRule.discipline == discipline
        )
        cleared_results = await self.results_repo.delete_for_rules(session, discipline_rule_ids)

        run = await self.runner.run_evaluation(
            session=session,
            workspace_id=workspace_id,
            trigger=EvaluationRunTrigger.manual,
            rule_ids=await resolve_rule_ids(session, workspace_id=workspace_id, discipline=discipline, rule_ids=None),
        )
        logger.info(
            "Hard-reset workspace {} ({}): seeded={}, removed={}, cleared_results={}, run={}",
            workspace_id,
            discipline,
            seeded,
            removed,
            cleared_results,
            run.id,
        )
        return seeded, removed, cleared_results, run


achievement_seeder_service = AchievementSeederService()
seed_workspace = achievement_seeder_service.seed_workspace
hard_reset_workspace = achievement_seeder_service.hard_reset_workspace
