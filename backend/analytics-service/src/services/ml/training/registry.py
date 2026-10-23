"""Model artifact registry — CRUD over ``analytics.ml_model_artifact``.

Each ``MLModelArtifact`` row carries the storage URI of a serialised model on
disk plus metadata (training cutoff, metrics, feature importance). The
inference runner queries this table with ``is_active=True`` to discover the
boosters to load.

An artifact belongs to the discipline whose analytics module declares its algorithm name and kind
(``AnalyticsExports.MODELS``); a role artifact also sits on a rated role of that same discipline. Every registration and
discovery names the discipline and validates that declaration first, so another algorithm sharing a model kind, or
another game's same-code role, is never registered, activated or loaded as this module's model.

The corresponding ``AnalyticsAlgorithm`` row is created/found here too. Some
v2 rows are internal augmentation pipelines; the read API decides which
algorithm rows are user-selectable.
"""

from __future__ import annotations

import typing

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository import AnalyticsAlgorithmRepository, CatalogRoleRepository, MLModelArtifactRepository
from src.core.analytics_exports import analytics_exports

__all__ = ("ModelRegistryService", "registry_service")


class ModelRegistryService:
    def __init__(
        self,
        *,
        algorithms: AnalyticsAlgorithmRepository = AnalyticsAlgorithmRepository(),
        artifacts: MLModelArtifactRepository = MLModelArtifactRepository(),
        roles: CatalogRoleRepository = CatalogRoleRepository(),
    ) -> None:
        self.algorithms = algorithms
        self.artifacts = artifacts
        self.roles = roles

    async def ensure_algorithm(self, session: AsyncSession, name: str) -> models.AnalyticsAlgorithm:
        """Upsert an ``AnalyticsAlgorithm`` row by ``name``."""
        return await self.algorithms.ensure(session, name)

    async def rated_roles(
        self, session: AsyncSession, *, discipline: str, active_only: bool = True
    ) -> dict[str, models.CatalogRole]:
        """The discipline's module roles on its rated dimension, in display order (never a workspace sub-role)."""
        rows = await self.roles.rated_rows(session, discipline=discipline, workspace_id=None)
        return {code: row for code, row in rows.items() if row.active or not active_only}

    async def _owns(self, session: AsyncSession, *, discipline: str, algorithm_id: int, model_kind: str) -> bool:
        """Whether ``discipline``'s module declares this algorithm for this kind (``UnsupportedAnalytics`` if none)."""
        declaration = analytics_exports(discipline).MODELS.get(model_kind)
        if declaration is None:
            return False
        algorithm = await self.algorithms.get(session, algorithm_id)
        return algorithm is not None and algorithm.name == declaration.algorithm_name

    async def _rated_role(self, session: AsyncSession, *, discipline: str, role_id: int) -> models.CatalogRole | None:
        for row in (await self.rated_roles(session, discipline=discipline, active_only=False)).values():
            if row.id == role_id:
                return row
        return None

    async def register_artifact(
        self,
        session: AsyncSession,
        *,
        discipline: str,
        algorithm_id: int,
        model_kind: str,
        role_id: int | None,
        version: str,
        storage_uri: str,
        feature_version: str,
        training_cutoff_tournament_id: int | None,
        metrics: dict[str, typing.Any] | None,
        feature_importance: dict[str, typing.Any] | None,
        activate: bool = True,
    ) -> models.MLModelArtifact:
        """Insert a new artifact row (or update if the same key already exists).

        The declared algorithm and kind and the role are validated before anything is written. When ``activate=True``,
        any other artifact rows for the same ``(algorithm_id, model_kind, role_id)`` are flipped to
        ``is_active=False`` so only the freshly-registered row is loaded by inference.
        """
        if not await self._owns(session, discipline=discipline, algorithm_id=algorithm_id, model_kind=model_kind):
            raise ValueError(f"algorithm {algorithm_id} is not {discipline}'s declared algorithm for {model_kind!r}")
        role_row = None
        if role_id is not None:
            role_row = await self._rated_role(session, discipline=discipline, role_id=role_id)
            if role_row is None:
                raise ValueError(f"role {role_id} is not a rated role of {discipline}")
        existing = await self.artifacts.get_by_identity(
            session,
            algorithm_id=algorithm_id,
            model_kind=model_kind,
            role_id=role_id,
            version=version,
        )
        if existing is None:
            artifact = await self.artifacts.create(
                session,
                models.MLModelArtifact(
                    algorithm_id=algorithm_id,
                    model_kind=model_kind,
                    dimension_id=role_row.dimension_id if role_row is not None else None,
                    role_id=role_id,
                    role_row=role_row,
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
                role_id=role_id,
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
        role_id: int | None,
        keep_version: str,
    ) -> None:
        """Flip ``is_active=False`` on every artifact sharing key but not version."""
        await self.artifacts.deactivate_others(
            session,
            algorithm_id=algorithm_id,
            model_kind=model_kind,
            role_id=role_id,
            keep_version=keep_version,
        )

    async def load_active_artifact(
        self,
        session: AsyncSession,
        *,
        discipline: str,
        algorithm_id: int,
        model_kind: str,
        role_id: int | None,
    ) -> models.MLModelArtifact | None:
        """Return the active artifact row matching the key, if any.

        ``None`` when ``algorithm_id`` is not the discipline's declared algorithm for the kind or the role is not a
        rated role of the discipline: a foreign row sharing the kind is never returned.
        """
        if not await self._owns(session, discipline=discipline, algorithm_id=algorithm_id, model_kind=model_kind):
            return None
        if role_id is not None and await self._rated_role(session, discipline=discipline, role_id=role_id) is None:
            return None
        return await self.artifacts.get_active(
            session,
            algorithm_id=algorithm_id,
            model_kind=model_kind,
            role_id=role_id,
        )

    async def load_active_artifacts(
        self,
        session: AsyncSession,
        *,
        discipline: str,
        algorithm_id: int,
        model_kind: str,
    ) -> typing.Sequence[models.MLModelArtifact]:
        """Return the active artifacts of the discipline's declared algorithm for ``model_kind``."""
        if not await self._owns(session, discipline=discipline, algorithm_id=algorithm_id, model_kind=model_kind):
            return []
        return await self.artifacts.list_active(
            session, algorithm_id=algorithm_id, model_kind=model_kind, discipline=discipline
        )


registry_service = ModelRegistryService()
