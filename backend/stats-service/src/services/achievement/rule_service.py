"""Achievement rule + override admin CRUD.

Absorbs the raw ``AchievementRule``/``AchievementOverride`` writes that used to
live inline in ``src/rpc/achievements.py``'s ``_create``/``_update``/``_delete``/
``_override_create``/``_override_delete`` handlers, routing them through the
existing ``AchievementRuleRepository``/``AchievementOverrideRepository``
(``shared/repository/support.py``).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import BaseAPIException as HTTPException
from shared.core.pagination import paginated_dict
from shared.domain.achievements.validation import derive_depends_on
from shared.models.achievements.achievement import (
    AchievementOverride,
    AchievementRule,
    EvaluationRunTrigger,
)
from shared.repository.support import AchievementOverrideRepository, AchievementRuleRepository
from src import schemas
from src.services.achievement.admin_reads import require_character, require_tournament

from .engine.runner import AchievementEvaluationRunnerService, achievement_evaluation_runner_service


class AchievementRuleService:
    def __init__(
        self,
        *,
        rule_repo: AchievementRuleRepository = AchievementRuleRepository(),
        override_repo: AchievementOverrideRepository = AchievementOverrideRepository(),
        runner: AchievementEvaluationRunnerService = achievement_evaluation_runner_service,
    ) -> None:
        self.rule_repo = rule_repo
        self.override_repo = override_repo
        self.runner = runner

    async def list_rules(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        params: schemas.AchievementRuleListParams,
    ) -> dict[str, Any]:
        scope = (AchievementRule.workspace_id == workspace_id, AchievementRule.discipline == params.discipline)
        query = sa.select(AchievementRule).where(*scope)
        count_query = sa.select(sa.func.count()).select_from(AchievementRule).where(*scope)
        if params.search:
            term = f"%{params.search}%"
            match = sa.or_(AchievementRule.name.ilike(term), AchievementRule.slug.ilike(term))
            query = query.where(match)
            count_query = count_query.where(match)
        if params.category:
            query = query.where(AchievementRule.category == params.category)
            count_query = count_query.where(AchievementRule.category == params.category)
        if params.enabled is not None:
            query = query.where(AchievementRule.enabled.is_(params.enabled))
            count_query = count_query.where(AchievementRule.enabled.is_(params.enabled))
        query = params.apply_pagination_sort(query, AchievementRule)
        rules = (await session.execute(query)).scalars().all()
        total = (await session.execute(count_query)).scalar_one()
        return paginated_dict(
            [schemas.AchievementRuleRead.model_validate(rule, from_attributes=True) for rule in rules],
            int(total or 0),
            params,
        )

    async def _require_free_slug(
        self, session: AsyncSession, *, workspace_id: int, slug: str, except_rule_id: int | None = None
    ) -> None:
        """``UNIQUE(workspace_id, slug)`` is the identity across games: a taken slug is a 409, whichever game owns it,
        and the rule that owns it is left exactly as it was."""
        existing = await session.scalar(
            sa.select(AchievementRule).where(AchievementRule.workspace_id == workspace_id, AchievementRule.slug == slug)
        )
        if existing is not None and existing.id != except_rule_id:
            raise HTTPException(status_code=409, detail=f"Slug '{slug}' already exists in workspace")

    async def create_rule(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        rule_data: dict[str, Any],
    ) -> AchievementRule:
        discipline = rule_data["discipline"]
        await self._require_free_slug(session, workspace_id=workspace_id, slug=rule_data["slug"])
        await require_character(session, discipline=discipline, entity_id=rule_data.get("entity_id"))
        await require_tournament(
            session,
            workspace_id=workspace_id,
            discipline=discipline,
            tournament_id=rule_data.get("min_tournament_id"),
        )
        # Derived, never taken from the caller: a hand-written ``depends_on`` that
        # misses a table is a rule that silently stops re-evaluating.
        rule_data["depends_on"] = derive_depends_on(rule_data.get("condition_tree") or {}, discipline=discipline)
        rule = AchievementRule(workspace_id=workspace_id, **rule_data)
        await self.rule_repo.create(session, rule)
        await session.commit()
        await session.refresh(rule)
        return rule

    async def update_rule(
        self,
        session: AsyncSession,
        rule: AchievementRule,
        *,
        workspace_id: int,
        update_data: dict[str, Any],
        condition_tree_changed: bool,
    ) -> AchievementRule:
        """Apply ``update_data`` (the fields the caller actually sent; the discipline is never one of them).

        An omitted field is untouched; an explicit empty ``condition_tree`` replaces the tree with an empty one and an
        explicit ``entity_id: null`` clears the link.
        """
        if "slug" in update_data:
            await self._require_free_slug(
                session, workspace_id=workspace_id, slug=update_data["slug"], except_rule_id=rule.id
            )
        await require_character(session, discipline=rule.discipline, entity_id=update_data.get("entity_id"))
        await require_tournament(
            session,
            workspace_id=workspace_id,
            discipline=rule.discipline,
            tournament_id=update_data.get("min_tournament_id"),
        )
        if condition_tree_changed and "rule_version" not in update_data:
            update_data["rule_version"] = rule.rule_version + 1
        if condition_tree_changed:
            update_data["depends_on"] = derive_depends_on(update_data["condition_tree"], discipline=rule.discipline)
        else:
            update_data.pop("depends_on", None)
        await self.rule_repo.update_fields(session, rule, update_data)
        await session.refresh(rule)
        if (condition_tree_changed or "enabled" in update_data) and rule.enabled and rule.condition_tree:
            # ``run_evaluation`` owns the commit for this path.
            await self.runner.run_evaluation(
                session,
                workspace_id,
                EvaluationRunTrigger.rule_version_bump,
                rule_ids=[rule.id],
            )
        else:
            await session.commit()
        return rule

    async def delete_rule(self, session: AsyncSession, rule: AchievementRule) -> None:
        await self.rule_repo.delete(session, rule)
        await session.commit()

    async def create_override(self, session: AsyncSession, override: AchievementOverride) -> AchievementOverride:
        await self.override_repo.create(session, override)
        await session.commit()
        await session.refresh(override)
        return override

    async def delete_override(self, session: AsyncSession, override: AchievementOverride) -> None:
        await self.override_repo.delete(session, override)
        await session.commit()


achievement_rule_service = AchievementRuleService()
