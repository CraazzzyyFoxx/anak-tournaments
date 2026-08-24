"""Model artifact registry — CRUD over ``analytics.ml_model_artifact``.

Each ``MLModelArtifact`` row carries the storage URI of a serialised model on
disk plus metadata (training cutoff, metrics, feature importance). The
inference runner queries this table with ``is_active=True`` to discover the
boosters to load.

The corresponding ``AnalyticsAlgorithm`` row is created/found here too. Some
v2 rows are internal augmentation pipelines; the read API decides which
algorithm rows are user-selectable.
"""

from __future__ import annotations

import typing

from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import AnalyticsAlgorithmRepository, MLModelArtifactRepository
from src import models

__all__ = ("ModelRegistryService", "registry_service")


class ModelRegistryService:
    def __init__(
        self,
        *,
        algorithms: AnalyticsAlgorithmRepository = AnalyticsAlgorithmRepository(),
        artifacts: MLModelArtifactRepository = MLModelArtifactRepository(),
    ) -> None:
        self.algorithms = algorithms
        self.artifacts = artifacts

    async def ensure_algorithm(self, session: AsyncSession, name: str) -> models.AnalyticsAlgorithm:
        """Upsert an ``AnalyticsAlgorithm`` row by ``name``."""
        return await self.algorithms.ensure(session, name)

    async def register_artifact(
        self,
        session: AsyncSession,
        *,
        algorithm_id: int,
        model_kind: str,
        role: str | None,
        version: str,
        storage_uri: str,
        feature_version: str,
        training_cutoff_tournament_id: int | None,
        metrics: dict[str, typing.Any] | None,
        feature_importance: dict[str, typing.Any] | None,
        activate: bool = True,
    ) -> models.MLModelArtifact:
        """Insert a new artifact row (or update if the same key already exists).

        When ``activate=True``, any other artifact rows for the same
        ``(algorithm_id, model_kind, role)`` are flipped to ``is_active=False``
        so only the freshly-registered row is loaded by inference.
        """
        existing = await self.artifacts.get_by_identity(
            session,
            algorithm_id=algorithm_id,
            model_kind=model_kind,
            role=role,
            version=version,
        )
        if existing is None:
            artifact = await self.artifacts.create(
                session,
                models.MLModelArtifact(
                    algorithm_id=algorithm_id,
                    model_kind=model_kind,
                    role=role,
                    version=version,
                    storage_uri=storage_uri,
                    feature_version=feature_version,
                    training_cutoff_tournament_id=training_cutoff_tournament_id,
                    metrics=metrics,
                    feature_importance=feature_importance,
                    is_active=activate,
                ),
            )
        else:
            artifact = await self.artifacts.update_fields(
                session,
                existing,
                {
                    "storage_uri": storage_uri,
                    "feature_version": feature_version,
                    "training_cutoff_tournament_id": training_cutoff_tournament_id,
                    "metrics": metrics,
                    "feature_importance": feature_importance,
                    "is_active": activate,
                },
            )

        if activate:
            await self.deactivate_other_artifacts(
                session,
                algorithm_id=algorithm_id,
                model_kind=model_kind,
                role=role,
                keep_version=version,
            )

        await session.flush()
        return artifact

    async def deactivate_other_artifacts(
        self,
        session: AsyncSession,
        *,
        algorithm_id: int,
        model_kind: str,
        role: str | None,
        keep_version: str,
    ) -> None:
        """Flip ``is_active=False`` on every artifact sharing key but not version."""
        await self.artifacts.deactivate_others(
            session,
            algorithm_id=algorithm_id,
            model_kind=model_kind,
            role=role,
            keep_version=keep_version,
        )

    async def load_active_artifact(
        self,
        session: AsyncSession,
        *,
        algorithm_id: int,
        model_kind: str,
        role: str | None,
    ) -> models.MLModelArtifact | None:
        """Return the active artifact row matching the key, if any."""
        return await self.artifacts.get_active(
            session,
            algorithm_id=algorithm_id,
            model_kind=model_kind,
            role=role,
        )

    async def load_active_artifacts(
        self,
        session: AsyncSession,
        *,
        model_kind: str,
    ) -> typing.Sequence[models.MLModelArtifact]:
        """Return all active artifacts of a given ``model_kind``."""
        return await self.artifacts.list_active(session, model_kind=model_kind)


registry_service = ModelRegistryService()
