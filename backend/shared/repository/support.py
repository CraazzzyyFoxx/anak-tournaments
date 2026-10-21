from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository
from shared.services.achievement_evidence import (
    achievement_reference_change,
    lock_achievement_rules,
    reserve_reference_ids,
)
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence


class DivisionGridRepository(BaseRepository[models.DivisionGrid]):
    def __init__(self) -> None:
        super().__init__(models.DivisionGrid)


class AchievementRuleRepository(BaseRepository[models.AchievementRule]):
    def __init__(self) -> None:
        super().__init__(models.AchievementRule)

    async def list_by_workspace(
        self,
        session: AsyncSession,
        workspace_id: int,
    ) -> Sequence[models.AchievementRule]:
        result = await session.execute(
            sa.select(models.AchievementRule)
            .where(models.AchievementRule.workspace_id == workspace_id)
            .order_by(models.AchievementRule.id.asc())
        )
        return result.scalars().all()

    async def create(self, session: AsyncSession, instance: models.AchievementRule) -> models.AchievementRule:
        await session.execute(
            sa.select(models.Workspace.id).where(models.Workspace.id == instance.workspace_id).with_for_update()
        )
        if instance.id is None:
            instance.id = (await reserve_reference_ids(session, self.model, 1))[0]
        async with achievement_reference_change(
            session,
            kind="rule",
            ids=[instance.id],
            workspace_id=instance.workspace_id,
        ):
            await super().create(session, instance)
        return instance

    async def update_fields(self, session: AsyncSession, instance: models.AchievementRule, data: dict):
        async with achievement_reference_change(
            session,
            kind="rule",
            ids=[instance.id],
            workspace_id=instance.workspace_id,
        ):
            await super().update_fields(session, instance, data)
        return instance

    async def delete(self, session: AsyncSession, instance: models.AchievementRule) -> None:
        await lock_achievement_rules(session, [instance.id])
        rule_ids = sa.select(self.model.id).where(self.model.id == instance.id)
        await AchievementEvaluationResultRepository().delete_for_rules(session, rule_ids)
        await AchievementOverrideRepository().delete_for_rule(session, instance.id)
        async with achievement_reference_change(
            session,
            kind="rule",
            ids=[instance.id],
            workspace_id=instance.workspace_id,
        ):
            await session.execute(sa.delete(self.model).where(self.model.id == instance.id))


class AchievementOverrideRepository(BaseRepository[models.AchievementOverride]):
    def __init__(self) -> None:
        super().__init__(models.AchievementOverride)

    async def create(self, session: AsyncSession, instance: models.AchievementOverride) -> models.AchievementOverride:
        workspace_id = await lock_achievement_rules(session, [instance.achievement_rule_id])
        if instance.id is None:
            instance.id = (await reserve_reference_ids(session, self.model, 1))[0]
        async with achievement_reference_change(session, kind="override", ids=[instance.id], workspace_id=workspace_id):
            await super().create(session, instance)
        return instance

    async def delete(self, session: AsyncSession, instance: models.AchievementOverride) -> None:
        workspace_id = await lock_achievement_rules(session, [instance.achievement_rule_id])
        async with achievement_reference_change(session, kind="override", ids=[instance.id], workspace_id=workspace_id):
            await super().delete(session, instance)

    async def delete_for_rule(self, session: AsyncSession, rule_id: int) -> None:
        workspace_id = await lock_achievement_rules(session, [rule_id])
        while ids := list(
            await session.scalars(
                sa.select(self.model.id)
                .where(self.model.achievement_rule_id == rule_id)
                .order_by(self.model.id)
                .limit(100)
            )
        ):
            async with achievement_reference_change(session, kind="override", ids=ids, workspace_id=workspace_id):
                await session.execute(sa.delete(self.model).where(self.model.id.in_(ids)))


class AchievementEvaluationResultRepository(BaseRepository[models.AchievementEvaluationResult]):
    """``achievements.evaluation_result`` — reconcile writes for one rule's diff.

    ``bulk_upsert_ignore_conflicts``'s conflict target mirrors migration
    ``achenc01``'s functional unique index verbatim (``COALESCE(x, 0)`` on the
    nullable dedup columns) — Postgres only matches an ``ON CONFLICT`` target
    against an index whose expressions are syntactically identical, so this
    tuple must never be simplified to a plain ``0`` literal or dropped.
    """

    _DEDUP_INDEX_ELEMENTS = (
        models.AchievementEvaluationResult.achievement_rule_id,
        models.AchievementEvaluationResult.workspace_member_id,
        sa.func.coalesce(models.AchievementEvaluationResult.tournament_id, sa.literal_column("0")),
        sa.func.coalesce(models.AchievementEvaluationResult.encounter_id, sa.literal_column("0")),
        sa.func.coalesce(models.AchievementEvaluationResult.match_id, sa.literal_column("0")),
    )

    def __init__(self) -> None:
        super().__init__(models.AchievementEvaluationResult)

    async def bulk_delete_by_ids(self, session: AsyncSession, ids: Sequence[int]) -> None:
        for start in range(0, len(ids), 100):
            chunk = ids[start : start + 100]
            workspace_id = await lock_achievement_rules(
                session,
                sa.select(self.model.achievement_rule_id).where(self.model.id.in_(chunk)),
            )
            async with achievement_reference_change(session, kind="evaluation", ids=chunk, workspace_id=workspace_id):
                await session.execute(sa.delete(self.model).where(self.model.id.in_(chunk)))

    async def delete_for_rules(self, session: AsyncSession, rule_ids: sa.Select) -> int:
        """Delete references in bounded, evidenced batches before their rule parents."""
        await lock_achievement_rules(session, rule_ids)
        removed = 0
        while ids := list(
            await session.scalars(
                sa.select(self.model.id)
                .where(self.model.achievement_rule_id.in_(rule_ids))
                .order_by(self.model.id)
                .limit(100)
            )
        ):
            await self.bulk_delete_by_ids(session, ids)
            removed += len(ids)
        return removed

    async def bulk_upsert_ignore_conflicts(self, session: AsyncSession, values: list[dict]) -> None:
        if not values:
            return
        workspace_id = await lock_achievement_rules(session, sorted({row["achievement_rule_id"] for row in values}))
        for start in range(0, len(values), 100):
            chunk = values[start : start + 100]
            ids = await reserve_reference_ids(session, self.model, len(chunk))
            # Keep conflict losers out of the receipt's owner chains.
            before = {
                row_id: await capture_stats_evidence(session, scopes=owner_scopes("evaluation", (row_id,)))
                for row_id in ids
            }
            inserted_ids = await session.scalars(
                pg_insert(self.model)
                .values([dict(row, id=row_id) for row_id, row in zip(ids, chunk, strict=True)])
                .on_conflict_do_nothing(index_elements=self._DEDUP_INDEX_ELEMENTS)
                .returning(self.model.id)
            )
            for row_id in inserted_ids:
                after = await capture_stats_evidence(session, scopes=owner_scopes("evaluation", (row_id,)))
                await stage_stats_evidence(
                    session,
                    operation="stats.reference_update",
                    before=before[row_id],
                    after=after,
                    workspace_id=workspace_id,
                    entity_type="achievement_evaluation",
                    entity_id=row_id,
                )


class EvaluationRunRepository(BaseRepository[models.EvaluationRun]):
    def __init__(self) -> None:
        super().__init__(models.EvaluationRun)


class DiscordChannelRepository(BaseRepository[models.TournamentDiscordChannel]):
    def __init__(self) -> None:
        super().__init__(models.TournamentDiscordChannel)

    async def get_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> models.TournamentDiscordChannel | None:
        return await self.get_by(session, tournament_id=tournament_id)

    async def set_last_scanned(self, session: AsyncSession, channel_id: int, message_id: int) -> bool:
        """Raise the channel's rescan cursor to ``message_id``; ``False`` when it already sits there or past.

        Guarded in SQL, so a slow history walk finishing after a live message
        never drags the cursor back.
        """
        model = models.TournamentDiscordChannel
        result = await session.execute(
            sa.update(model)
            .where(
                model.channel_id == channel_id,
                sa.or_(model.last_scanned_message_id.is_(None), model.last_scanned_message_id < message_id),
            )
            .values(last_scanned_message_id=message_id)
        )
        return result.rowcount > 0

    async def list_active_with_tournament(
        self,
        session: AsyncSession,
        *,
        finished_cutoff: datetime,
    ) -> Sequence[tuple[models.TournamentDiscordChannel, models.Tournament]]:
        """Channels to keep monitoring: tournament still running, or finished after ``finished_cutoff``.

        Backs the bot's channel-registry reload — a tournament stays watched for
        a short grace period after it finishes so late log uploads still land.
        """
        result = await session.execute(
            sa.select(models.TournamentDiscordChannel, models.Tournament)
            .join(models.Tournament, models.TournamentDiscordChannel.tournament_id == models.Tournament.id)
            .where(
                models.TournamentDiscordChannel.is_active,
                (
                    (~models.Tournament.is_finished)
                    | (
                        models.Tournament.is_finished
                        & (models.Tournament.end_date.is_not(None))
                        & (models.Tournament.end_date >= finished_cutoff)
                    )
                ),
            )
        )
        return list(result.all())


class ChallongeMappingRepository:
    sources = BaseRepository(models.ChallongeSource)
    participants = BaseRepository(models.ChallongeParticipantMapping)
    matches = BaseRepository(models.ChallongeMatchMapping)
    logs = BaseRepository(models.ChallongeSyncLog)
