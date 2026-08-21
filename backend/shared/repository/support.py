from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared import models
from shared.repository.base import BaseRepository


class DivisionGridRepository(BaseRepository[models.DivisionGrid]):
    def __init__(self) -> None:
        super().__init__(models.DivisionGrid)

    async def list_workspace_grids(
        self,
        session: AsyncSession,
        workspace_id: int,
    ) -> Sequence[models.DivisionGrid]:
        result = await session.execute(
            sa.select(models.DivisionGrid)
            .options(selectinload(models.DivisionGrid.versions))
            .where(models.DivisionGrid.workspace_id == workspace_id)
            .order_by(models.DivisionGrid.id.asc())
        )
        return result.unique().scalars().all()


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


class AchievementOverrideRepository(BaseRepository[models.AchievementOverride]):
    def __init__(self) -> None:
        super().__init__(models.AchievementOverride)


class DiscordChannelRepository(BaseRepository[models.TournamentDiscordChannel]):
    def __init__(self) -> None:
        super().__init__(models.TournamentDiscordChannel)

    async def get_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> models.TournamentDiscordChannel | None:
        return await self.get_by(session, tournament_id=tournament_id)

    async def list_channel_ids_for_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> Sequence[int]:
        """Active channel ids configured for a tournament (0 or 1: unique per tournament)."""
        result = await session.execute(
            sa.select(models.TournamentDiscordChannel.channel_id).where(
                models.TournamentDiscordChannel.tournament_id == tournament_id,
                models.TournamentDiscordChannel.is_active,
            )
        )
        return result.scalars().all()

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


class LogProcessingRepository(BaseRepository[models.LogProcessingRecord]):
    def __init__(self) -> None:
        super().__init__(models.LogProcessingRecord)

    async def exists_done(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        filename: str,
    ) -> bool:
        """Whether this exact (tournament, filename) already finished processing.

        Used to skip re-uploading logs already seen on a channel-history rescan
        (bot restart, newly-added channel).
        """
        result = await session.execute(
            sa.select(models.LogProcessingRecord.id)
            .where(
                models.LogProcessingRecord.tournament_id == tournament_id,
                models.LogProcessingRecord.filename == filename,
                models.LogProcessingRecord.status == models.LogProcessingStatus.done,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def get_latest_error_message(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        filename: str,
    ) -> str | None:
        result = await session.execute(
            sa.select(models.LogProcessingRecord.error_message)
            .where(
                models.LogProcessingRecord.tournament_id == tournament_id,
                models.LogProcessingRecord.filename == filename,
            )
            .order_by(models.LogProcessingRecord.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()


class ChallongeMappingRepository:
    sources = BaseRepository(models.ChallongeSource)
    participants = BaseRepository(models.ChallongeParticipantMapping)
    matches = BaseRepository(models.ChallongeMatchMapping)
    logs = BaseRepository(models.ChallongeSyncLog)


class AnalyticsStateRepository:
    algorithms = BaseRepository(models.AnalyticsAlgorithm)
    jobs = BaseRepository(models.AnalyticsJob)
    model_artifacts = BaseRepository(models.MLModelArtifact)
    feature_store = BaseRepository(models.MLFeatureStore)
    performance = BaseRepository(models.AnalyticsPerformance)
    standings_distribution = BaseRepository(models.AnalyticsStandingsDistribution)
    match_quality = BaseRepository(models.AnalyticsMatchQuality)
    player_anomaly = BaseRepository(models.AnalyticsPlayerAnomaly)
    explanations = BaseRepository(models.AnalyticsExplanation)
