"""Evaluation runner — orchestrates achievement evaluation runs."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import resolve_grid
from shared.models.achievement import (
    AchievementRule,
    EvaluationRun,
    EvaluationRunStatus,
    EvaluationRunTrigger,
)

from src import models

from .context import EvalContext
from .differ import diff_and_apply
from .evaluator import evaluate


async def run_evaluation(
    session: AsyncSession,
    workspace_id: int,
    trigger: EvaluationRunTrigger,
    tournament_id: int | None = None,
    changed_tables: list[str] | None = None,
    rule_ids: list[int] | None = None,
) -> EvaluationRun:
    """Execute an achievement evaluation run.

    Args:
        session: Database session.
        workspace_id: Workspace to evaluate.
        trigger: What triggered this run.
        tournament_id: If set, only evaluate for this tournament.
        changed_tables: If set, only evaluate rules that depend on these tables.
        rule_ids: If set, only evaluate these specific rules.
    """
    run_id = str(uuid.uuid4())
    run = EvaluationRun(
        id=run_id,
        workspace_id=workspace_id,
        trigger=trigger,
        tournament_id=tournament_id,
        status=EvaluationRunStatus.running,
        started_at=datetime.now(timezone.utc),
    )
    session.add(run)
    await session.flush()

    try:
        rules = await _get_rules(session, workspace_id, rule_ids)

        if changed_tables:
            rules = _filter_by_depends_on(rules, set(changed_tables))

        tournament = None
        if tournament_id:
            tournament = await session.get(models.Tournament, tournament_id)

        total_created = 0
        total_removed = 0

        for rule in rules:
            if not rule.enabled or not rule.condition_tree:
                # Disabled or empty rule — remove all existing results
                diff = await diff_and_apply(session, rule, set(), run_id)
                total_removed += len(diff.to_delete)
                if diff.to_delete:
                    logger.info(f"Rule '{rule.slug}' disabled/empty: removed {len(diff.to_delete)} results")
                continue

            if rule.min_tournament_id and tournament and tournament.id < rule.min_tournament_id:
                continue

            grid = await _resolve_grid(session, workspace_id, tournament)
            context = EvalContext(
                workspace_id=workspace_id,
                tournament=tournament,
                grid=grid,
            )

            logger.info(f"Evaluating rule '{rule.slug}' (id={rule.id})")

            try:
                results = await evaluate(session, rule.condition_tree, context)
                diff = await diff_and_apply(session, rule, results, run_id)
                total_created += len(diff.to_insert)
                total_removed += len(diff.to_delete)

                logger.info(
                    f"Rule '{rule.slug}': +{len(diff.to_insert)} -{len(diff.to_delete)}"
                )
            except Exception:
                logger.exception(f"Failed to evaluate rule '{rule.slug}'")
                continue

        run.rules_evaluated = len(rules)
        run.results_created = total_created
        run.results_removed = total_removed
        run.status = EvaluationRunStatus.done
        run.finished_at = datetime.now(timezone.utc)

        await session.commit()

    except Exception as exc:
        run.status = EvaluationRunStatus.failed
        run.error_message = str(exc)[:1000]
        run.finished_at = datetime.now(timezone.utc)
        await session.commit()
        logger.exception(f"Evaluation run {run_id} failed")
        raise

    logger.info(
        f"Evaluation run {run_id} done: "
        f"{run.rules_evaluated} rules, +{run.results_created} -{run.results_removed}"
    )
    return run


async def _get_rules(
    session: AsyncSession,
    workspace_id: int,
    rule_ids: list[int] | None,
) -> list[AchievementRule]:
    query = sa.select(AchievementRule).where(
        AchievementRule.workspace_id == workspace_id,
    )
    if rule_ids:
        # When specific rules requested, include disabled ones
        # so the runner can clean up their results
        query = query.where(AchievementRule.id.in_(rule_ids))
    else:
        # Bulk evaluation: only enabled rules
        query = query.where(AchievementRule.enabled.is_(True))

    result = await session.execute(query)
    return list(result.scalars().all())


def _filter_by_depends_on(
    rules: list[AchievementRule],
    changed_tables: set[str],
) -> list[AchievementRule]:
    return [r for r in rules if set(r.depends_on or []) & changed_tables]


async def _resolve_grid(
    session: AsyncSession,
    workspace_id: int,
    tournament: models.Tournament | None,
) -> object | None:
    workspace = await session.get(models.Workspace, workspace_id)
    workspace_grid = workspace.division_grid_json if workspace else None
    tournament_grid = tournament.division_grid_json if tournament else None
    return resolve_grid(workspace_grid, tournament_grid)
