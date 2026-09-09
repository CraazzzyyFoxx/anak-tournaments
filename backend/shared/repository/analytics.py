"""Analytics-schema CRUD.

Named methods preserve the exact predicates the pre-conversion call sites
used. Analytical queries (v1 points CTEs, lookbacks, streaks, ML feature
extraction, inference materialization) stay in analytics-service.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository


class AnalyticsAlgorithmRepository(BaseRepository[models.AnalyticsAlgorithm]):
    def __init__(self) -> None:
        super().__init__(models.AnalyticsAlgorithm)

    async def get_by_name(self, session: AsyncSession, name: str) -> models.AnalyticsAlgorithm | None:
        return await self.get_by(session, name=name)

    async def get_id_by_name(self, session: AsyncSession, name: str) -> int | None:
        return await session.scalar(
            sa.select(models.AnalyticsAlgorithm.id).where(models.AnalyticsAlgorithm.name == name)
        )

    async def list_names_by_ids(self, session: AsyncSession, ids: Sequence[int]) -> list[str]:
        if not ids:
            return []
        result = await session.scalars(
            sa.select(models.AnalyticsAlgorithm.name).where(models.AnalyticsAlgorithm.id.in_(list(ids)))
        )
        return list(result.all())

    async def list_by_ids(self, session: AsyncSession, ids: Sequence[int]) -> Sequence[models.AnalyticsAlgorithm]:
        query = sa.select(models.AnalyticsAlgorithm).order_by(models.AnalyticsAlgorithm.id)
        if ids:
            query = query.where(models.AnalyticsAlgorithm.id.in_(list(ids)))
        result = await session.execute(query)
        return result.scalars().all()

    async def list_shift_producers(
        self,
        session: AsyncSession,
        names: Sequence[str],
    ) -> Sequence[models.AnalyticsAlgorithm]:
        result = await session.execute(
            sa.select(models.AnalyticsAlgorithm)
            .where(
                models.AnalyticsAlgorithm.produces_shifts.is_(True),
                models.AnalyticsAlgorithm.name.in_(list(names)),
            )
            .order_by(models.AnalyticsAlgorithm.id)
        )
        return result.scalars().all()

    async def get_shift_producer(
        self,
        session: AsyncSession,
        algorithm_id: int,
        names: Sequence[str],
    ) -> models.AnalyticsAlgorithm | None:
        result = await session.execute(
            sa.select(models.AnalyticsAlgorithm).where(
                models.AnalyticsAlgorithm.id == algorithm_id,
                models.AnalyticsAlgorithm.produces_shifts.is_(True),
                models.AnalyticsAlgorithm.name.in_(list(names)),
            )
        )
        return result.scalars().first()

    async def list_all(self, session: AsyncSession) -> Sequence[models.AnalyticsAlgorithm]:
        result = await session.execute(sa.select(models.AnalyticsAlgorithm).order_by(models.AnalyticsAlgorithm.id))
        return result.scalars().all()

    async def ensure(self, session: AsyncSession, name: str) -> models.AnalyticsAlgorithm:
        existing = await self.get_by_name(session, name)
        if existing is not None:
            return existing
        return await self.create(session, models.AnalyticsAlgorithm(name=name))


class AnalyticsJobRepository(BaseRepository[models.AnalyticsJob]):
    def __init__(self) -> None:
        super().__init__(models.AnalyticsJob)

    def _workspace_clause(self, workspace_id: int | None) -> sa.ColumnElement[bool]:
        if workspace_id is None:
            return models.AnalyticsJob.workspace_id.is_(None)
        return models.AnalyticsJob.workspace_id == workspace_id

    async def get_active(
        self,
        session: AsyncSession,
        workspace_id: int | None,
        statuses: Sequence[str],
    ) -> models.AnalyticsJob | None:
        return await session.scalar(
            sa.select(models.AnalyticsJob)
            .where(
                models.AnalyticsJob.status.in_(list(statuses)),
                self._workspace_clause(workspace_id),
            )
            .order_by(models.AnalyticsJob.id.desc())
            .limit(1)
        )

    async def list_active(
        self,
        session: AsyncSession,
        workspace_id: int | None,
        statuses: Sequence[str],
    ) -> Sequence[models.AnalyticsJob]:
        result = await session.scalars(
            sa.select(models.AnalyticsJob).where(
                models.AnalyticsJob.status.in_(list(statuses)),
                self._workspace_clause(workspace_id),
            )
        )
        return result.all()

    async def list_by_workspace(
        self,
        session: AsyncSession,
        workspace_id: int | None,
        *,
        limit: int = 20,
        statuses: Sequence[str] | None = None,
    ) -> Sequence[models.AnalyticsJob]:
        query = sa.select(models.AnalyticsJob).where(self._workspace_clause(workspace_id))
        if statuses is not None:
            query = query.where(models.AnalyticsJob.status.in_(list(statuses)))
        query = query.order_by(models.AnalyticsJob.id.desc()).limit(int(limit))
        result = await session.scalars(query)
        return result.all()


class AnalyticsAnomalyFeedbackRepository(BaseRepository[models.AnalyticsAnomalyFeedback]):
    def __init__(self) -> None:
        super().__init__(models.AnalyticsAnomalyFeedback)

    async def get_by_key(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        player_id: int,
        kind: str,
    ) -> models.AnalyticsAnomalyFeedback | None:
        return await session.scalar(
            sa.select(models.AnalyticsAnomalyFeedback).where(
                models.AnalyticsAnomalyFeedback.tournament_id == tournament_id,
                models.AnalyticsAnomalyFeedback.player_id == player_id,
                models.AnalyticsAnomalyFeedback.kind == kind,
            )
        )

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> Sequence[models.AnalyticsAnomalyFeedback]:
        result = await session.scalars(
            sa.select(models.AnalyticsAnomalyFeedback).where(
                models.AnalyticsAnomalyFeedback.tournament_id == tournament_id
            )
        )
        return result.all()


class AnalyticsPerformanceRepository(BaseRepository[models.AnalyticsPerformance]):
    def __init__(self) -> None:
        super().__init__(models.AnalyticsPerformance)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        algorithm_id: int | None = None,
    ) -> Sequence[models.AnalyticsPerformance]:
        query = sa.select(models.AnalyticsPerformance).where(models.AnalyticsPerformance.tournament_id == tournament_id)
        if algorithm_id is not None:
            query = query.where(models.AnalyticsPerformance.algorithm_id == algorithm_id)
        result = await session.execute(query)
        return result.scalars().all()

    async def get_for_player(
        self,
        session: AsyncSession,
        *,
        player_id: int,
        tournament_id: int,
        algorithm_id: int | None = None,
    ) -> models.AnalyticsPerformance | None:
        query = sa.select(models.AnalyticsPerformance).where(
            models.AnalyticsPerformance.player_id == player_id,
            models.AnalyticsPerformance.tournament_id == tournament_id,
        )
        if algorithm_id is not None:
            query = query.where(models.AnalyticsPerformance.algorithm_id == algorithm_id)
        query = query.order_by(models.AnalyticsPerformance.id.desc()).limit(1)
        result = await session.execute(query)
        return result.scalar_one_or_none()


class AnalyticsStandingsDistributionRepository(BaseRepository[models.AnalyticsStandingsDistribution]):
    def __init__(self) -> None:
        super().__init__(models.AnalyticsStandingsDistribution)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        algorithm_id: int | None = None,
    ) -> Sequence[models.AnalyticsStandingsDistribution]:
        query = sa.select(models.AnalyticsStandingsDistribution).where(
            models.AnalyticsStandingsDistribution.tournament_id == tournament_id
        )
        if algorithm_id is not None:
            query = query.where(models.AnalyticsStandingsDistribution.algorithm_id == algorithm_id)
        result = await session.execute(query)
        return result.scalars().all()


class AnalyticsMatchQualityRepository(BaseRepository[models.AnalyticsMatchQuality]):
    def __init__(self) -> None:
        super().__init__(models.AnalyticsMatchQuality)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        algorithm_id: int | None = None,
    ) -> Sequence[models.AnalyticsMatchQuality]:
        query = (
            sa.select(models.AnalyticsMatchQuality)
            .join(models.Encounter, models.Encounter.id == models.AnalyticsMatchQuality.encounter_id)
            .where(models.Encounter.tournament_id == tournament_id)
        )
        if algorithm_id is not None:
            query = query.where(models.AnalyticsMatchQuality.algorithm_id == algorithm_id)
        result = await session.execute(query)
        return result.scalars().all()


class AnalyticsPlayerAnomalyRepository(BaseRepository[models.AnalyticsPlayerAnomaly]):
    def __init__(self) -> None:
        super().__init__(models.AnalyticsPlayerAnomaly)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        player_id: int | None = None,
        kind: str | None = None,
    ) -> Sequence[models.AnalyticsPlayerAnomaly]:
        query = sa.select(models.AnalyticsPlayerAnomaly).where(
            models.AnalyticsPlayerAnomaly.tournament_id == tournament_id
        )
        if player_id is not None:
            query = query.where(models.AnalyticsPlayerAnomaly.player_id == player_id)
        if kind is not None:
            query = query.where(models.AnalyticsPlayerAnomaly.kind == kind)
        result = await session.execute(query)
        return result.scalars().all()


class MLModelArtifactRepository(BaseRepository[models.MLModelArtifact]):
    def __init__(self) -> None:
        super().__init__(models.MLModelArtifact)

    async def get_by_identity(
        self,
        session: AsyncSession,
        *,
        algorithm_id: int,
        model_kind: str,
        role: str | None,
        version: str,
    ) -> models.MLModelArtifact | None:
        return await session.scalar(
            sa.select(models.MLModelArtifact).where(
                models.MLModelArtifact.algorithm_id == algorithm_id,
                models.MLModelArtifact.model_kind == model_kind,
                models.MLModelArtifact.role == role,
                models.MLModelArtifact.version == version,
            )
        )

    async def get_active(
        self,
        session: AsyncSession,
        *,
        algorithm_id: int,
        model_kind: str,
        role: str | None,
    ) -> models.MLModelArtifact | None:
        return await session.scalar(
            sa.select(models.MLModelArtifact).where(
                models.MLModelArtifact.algorithm_id == algorithm_id,
                models.MLModelArtifact.model_kind == model_kind,
                models.MLModelArtifact.role == role,
                models.MLModelArtifact.is_active.is_(True),
            )
        )

    async def list_active(self, session: AsyncSession, *, model_kind: str) -> Sequence[models.MLModelArtifact]:
        result = await session.scalars(
            sa.select(models.MLModelArtifact).where(
                models.MLModelArtifact.model_kind == model_kind,
                models.MLModelArtifact.is_active.is_(True),
            )
        )
        return result.all()

    async def list_filtered(
        self,
        session: AsyncSession,
        *,
        model_kind: str | None = None,
        active_only: bool = False,
    ) -> Sequence[models.MLModelArtifact]:
        query = sa.select(models.MLModelArtifact)
        if model_kind is not None:
            query = query.where(models.MLModelArtifact.model_kind == model_kind)
        if active_only:
            query = query.where(models.MLModelArtifact.is_active.is_(True))
        query = query.order_by(models.MLModelArtifact.created_at.desc())
        result = await session.execute(query)
        return result.scalars().all()

    async def deactivate_others(
        self,
        session: AsyncSession,
        *,
        algorithm_id: int,
        model_kind: str,
        role: str | None,
        keep_version: str,
    ) -> None:
        await session.execute(
            sa.update(models.MLModelArtifact)
            .where(
                models.MLModelArtifact.algorithm_id == algorithm_id,
                models.MLModelArtifact.model_kind == model_kind,
                models.MLModelArtifact.role == role,
                models.MLModelArtifact.version != keep_version,
            )
            .values(is_active=False)
        )


class AnalyticsPlayerRepository(BaseRepository[models.AnalyticsPlayer]):
    def __init__(self) -> None:
        super().__init__(models.AnalyticsPlayer)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> Sequence[models.AnalyticsPlayer]:
        result = await session.execute(
            sa.select(models.AnalyticsPlayer)
            .join(models.Player, models.AnalyticsPlayer.player_id == models.Player.id)
            .where(models.AnalyticsPlayer.tournament_id == tournament_id)
        )
        return result.scalars().all()


class AnalyticsShiftRepository(BaseRepository[models.AnalyticsShift]):
    def __init__(self) -> None:
        super().__init__(models.AnalyticsShift)

    async def algorithm_ids_for_tournament(self, session: AsyncSession, tournament_id: int) -> set[int]:
        result = await session.scalars(
            sa.select(models.AnalyticsShift.algorithm_id)
            .where(models.AnalyticsShift.tournament_id == tournament_id)
            .distinct()
        )
        return {int(algorithm_id) for algorithm_id in result.all()}


__all__ = (
    "AnalyticsAlgorithmRepository",
    "AnalyticsAnomalyFeedbackRepository",
    "AnalyticsJobRepository",
    "AnalyticsMatchQualityRepository",
    "AnalyticsPerformanceRepository",
    "AnalyticsPlayerAnomalyRepository",
    "AnalyticsPlayerRepository",
    "AnalyticsShiftRepository",
    "AnalyticsStandingsDistributionRepository",
    "MLModelArtifactRepository",
)
