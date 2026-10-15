"""Artifact identity, activation and wire roles use the catalog, including all-role models."""

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import CatalogRoleRepository
from src.services.analytics.reads import flows_service
from src.services.ml.training.registry import registry_service


def test_artifact_registration_activation_and_reads_use_catalog_roles(db_session: AsyncSession) -> None:
    async def check() -> None:
        algorithm = await registry_service.ensure_algorithm(db_session, "artifact-role-test")
        roles = await CatalogRoleRepository().rated_rows(db_session, discipline="overwatch", workspace_id=None)

        async def register(role: str | None, version: str, uri: str = "s3://model"):
            return await registry_service.register_artifact(
                db_session,
                algorithm_id=algorithm.id,
                model_kind="performance",
                role=role,
                version=version,
                storage_uri=uri,
                feature_version="1",
                training_cutoff_tournament_id=None,
                metrics=None,
                feature_importance=None,
            )

        old = await register("tank", "1")
        current = await register("tank", "2")
        support = await register("support", "1")
        all_roles = await register(None, "1")
        replacement = await register(None, "2")
        updated = await register("tank", "2", "s3://updated")
        assert updated.id == current.id
        assert updated.storage_uri == "s3://updated"
        assert (current.role_id, current.dimension_id) == (roles["tank"].id, roles["tank"].dimension_id)
        assert current.role == "tank"
        assert replacement.role_id is None and replacement.dimension_id is None
        assert replacement.role is None
        assert not old.is_active and not all_roles.is_active
        assert support.is_active and current.is_active and replacement.is_active
        current_id, replacement_id, algorithm_id = current.id, replacement.id, algorithm.id

        db_session.expire_all()
        active = await registry_service.load_active_artifact(
            db_session, algorithm_id=algorithm_id, model_kind="performance", role="tank"
        )
        assert active.id == current_id and active.role == "tank"
        active_all = await registry_service.load_active_artifact(
            db_session, algorithm_id=algorithm_id, model_kind="performance", role=None
        )
        assert active_all.id == replacement_id and active_all.role is None
        rows = await flows_service.list_artifacts(db_session, model_kind="performance", active_only=True)
        payloads = {row.id: row.model_dump(mode="json") for row in rows}
        assert payloads[current_id]["role"] == {"dimension": "player_role", "role": "tank", "parent": None}
        assert payloads[replacement_id]["role"] is None

    async def run() -> None:
        async with db_session:
            await check()

    asyncio.run(run())
