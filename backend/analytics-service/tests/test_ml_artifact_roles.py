"""Artifact identity, activation and discovery use the catalog and the module's declared algorithm.

An artifact belongs to the discipline whose analytics module declares its algorithm and kind; a role artifact also sits
on a rated role of that discipline. Another algorithm sharing a kind, or another game's same-code role, is never
registered, activated or loaded as the module's model.
"""

import asyncio
import typing

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from shared.disciplines import discipline
from shared.domain.analytics import PERFORMANCE_MODEL, SHIFT_MODEL
from shared.repository import CatalogRoleRepository
from src import models
from src.core.analytics_exports import UnsupportedAnalytics
from src.services.analytics.reads import flows_service
from src.services.ml.training.registry import registry_service

OW = "overwatch"


def _run(db_session: AsyncSession, check: typing.Callable[[], typing.Awaitable[None]]) -> None:
    async def run() -> None:
        async with db_session:
            await check()

    asyncio.run(run())


async def _register(db_session: AsyncSession, algorithm_id: int, kind: str, role_id: int | None, version: str, **kw):
    return await registry_service.register_artifact(
        db_session,
        discipline=kw.pop("discipline", OW),
        algorithm_id=algorithm_id,
        model_kind=kind,
        role_id=role_id,
        version=version,
        storage_uri=kw.pop("uri", "s3://model"),
        feature_version="1",
        training_cutoff_tournament_id=None,
        metrics=None,
        feature_importance=None,
        **kw,
    )


def test_artifact_registration_activation_and_reads_use_catalog_roles(db_session: AsyncSession) -> None:
    async def check() -> None:
        algorithm = await registry_service.ensure_algorithm(db_session, PERFORMANCE_MODEL.algorithm_name)
        roles = await CatalogRoleRepository().rated_rows(db_session, discipline=OW, workspace_id=None)

        async def register(role: str | None, version: str, uri: str = "s3://model"):
            return await _register(
                db_session,
                algorithm.id,
                "performance",
                roles[role].id if role is not None else None,
                version,
                uri=uri,
            )

        old = await register("tank", "t1")
        current = await register("tank", "t2")
        support = await register("support", "t1")
        all_roles = await register(None, "t1")
        replacement = await register(None, "t2")
        updated = await register("tank", "t2", "s3://updated")
        assert updated.id == current.id
        assert updated.storage_uri == "s3://updated"
        assert (current.role_id, current.dimension_id) == (roles["tank"].id, roles["tank"].dimension_id)
        assert current.role == "tank"
        assert replacement.role_id is None and replacement.dimension_id is None
        assert replacement.role is None
        assert not old.is_active and not all_roles.is_active
        assert support.is_active and current.is_active and replacement.is_active
        current_id, replacement_id, algorithm_id = current.id, replacement.id, algorithm.id
        tank_id = roles["tank"].id

        db_session.expire_all()
        active = await registry_service.load_active_artifact(
            db_session, discipline=OW, algorithm_id=algorithm_id, model_kind="performance", role_id=tank_id
        )
        assert active.id == current_id and active.role == "tank"
        active_all = await registry_service.load_active_artifact(
            db_session, discipline=OW, algorithm_id=algorithm_id, model_kind="performance", role_id=None
        )
        assert active_all.id == replacement_id and active_all.role is None
        rows = await flows_service.list_artifacts(db_session, model_kind="performance", active_only=True)
        payloads = {row.id: row.model_dump(mode="json") for row in rows}
        assert payloads[current_id]["role"] == {"dimension": "player_role", "role": "tank", "parent": None}
        assert payloads[replacement_id]["role"] is None

    _run(db_session, check)


def test_another_algorithm_sharing_a_kind_is_never_registered_or_loaded(db_session: AsyncSession) -> None:
    async def check() -> None:
        declared_id = (await registry_service.ensure_algorithm(db_session, PERFORMANCE_MODEL.algorithm_name)).id
        foreign_id = (await registry_service.ensure_algorithm(db_session, "Someone else's performance model")).id
        tank = (await CatalogRoleRepository().rated_rows(db_session, discipline=OW, workspace_id=None))["tank"]
        tank_id, tank_dimension_id = tank.id, tank.dimension_id

        # Registration validates the declaration before writing anything.
        before = len(await registry_service.artifacts.list_filtered(db_session, model_kind="performance"))
        with pytest.raises(ValueError, match="declared algorithm"):
            await _register(db_session, foreign_id, "performance", tank_id, "foreign-1")
        with pytest.raises(ValueError, match="declared algorithm"):
            await _register(db_session, declared_id, "shift", None, "wrong-kind")  # Performance ML v2 is no shift model
        with pytest.raises(ValueError, match="declared algorithm"):
            await _register(db_session, declared_id, "invented", None, "undeclared-kind")
        assert len(await registry_service.artifacts.list_filtered(db_session, model_kind="performance")) == before

        mine_id = (await _register(db_session, declared_id, "performance", tank_id, "mine-1")).id
        # A foreign row that nevertheless exists (inserted behind the service's back) shadows nothing.
        shadow = await registry_service.artifacts.create(
            db_session,
            models.MLModelArtifact(
                algorithm_id=foreign_id,
                model_kind="performance",
                dimension_id=tank_dimension_id,
                role_id=tank_id,
                version="foreign-1",
                storage_uri="s3://foreign",
                feature_version="1",
                is_active=True,
            ),
        )
        await db_session.flush()
        shadow_id = shadow.id
        db_session.expire_all()

        loaded = await registry_service.load_active_artifacts(
            db_session, discipline=OW, algorithm_id=declared_id, model_kind="performance"
        )
        loaded_ids = {row.id for row in loaded}
        assert shadow_id not in loaded_ids and mine_id in loaded_ids
        assert (
            await registry_service.load_active_artifact(
                db_session, discipline=OW, algorithm_id=foreign_id, model_kind="performance", role_id=tank_id
            )
            is None
        )
        assert (
            await registry_service.load_active_artifacts(
                db_session, discipline=OW, algorithm_id=foreign_id, model_kind="performance"
            )
            == []
        )
        # Registering the declared model never deactivates the foreign algorithm's row.
        await _register(db_session, declared_id, "performance", tank_id, "mine-2")
        db_session.expire_all()
        assert (await registry_service.artifacts.get(db_session, shadow_id)).is_active

    _run(db_session, check)


def test_another_games_support_role_cannot_replace_or_shadow_overwatch_support(db_session: AsyncSession) -> None:
    async def check() -> None:
        await CatalogRoleRepository().project_module(db_session, discipline("lol"))
        declared_id = (await registry_service.ensure_algorithm(db_session, PERFORMANCE_MODEL.algorithm_name)).id
        roles = CatalogRoleRepository()
        ow_support = (await roles.rated_rows(db_session, discipline=OW, workspace_id=None))["support"]
        lol_support = (await roles.rated_rows(db_session, discipline="lol", workspace_id=None))["support"]
        ow_support_id, lol_support_id = ow_support.id, lol_support.id
        lol_dimension_id = lol_support.dimension_id
        assert ow_support.code == lol_support.code and ow_support_id != lol_support_id

        mine_id = (await _register(db_session, declared_id, "performance", ow_support_id, "support-1")).id
        # Neither the module's registration door nor discovery accepts LoL's role under Overwatch's declaration...
        with pytest.raises(ValueError, match="not a rated role of overwatch"):
            await _register(db_session, declared_id, "performance", lol_support_id, "support-2")
        assert (
            await registry_service.load_active_artifact(
                db_session, discipline=OW, algorithm_id=declared_id, model_kind="performance", role_id=lol_support_id
            )
            is None
        )
        # ... and LoL declares no analytics module, so nothing can be registered or loaded as its own.
        with pytest.raises(UnsupportedAnalytics):
            await _register(db_session, declared_id, "performance", lol_support_id, "support-3", discipline="lol")
        with pytest.raises(UnsupportedAnalytics):
            await registry_service.load_active_artifacts(
                db_session, discipline="lol", algorithm_id=declared_id, model_kind="performance"
            )
        # A row that sits on LoL's support role under the same algorithm is outside Overwatch's bulk discovery.
        stray = await registry_service.artifacts.create(
            db_session,
            models.MLModelArtifact(
                algorithm_id=declared_id,
                model_kind="performance",
                dimension_id=lol_dimension_id,
                role_id=lol_support_id,
                version="stray",
                storage_uri="s3://stray",
                feature_version="1",
                is_active=True,
            ),
        )
        await db_session.flush()
        stray_id = stray.id
        db_session.expire_all()
        loaded = await registry_service.load_active_artifacts(
            db_session, discipline=OW, algorithm_id=declared_id, model_kind="performance"
        )
        loaded_ids = {row.id for row in loaded}
        assert mine_id in loaded_ids and stray_id not in loaded_ids
        assert {row.role for row in loaded if row.role_id is not None} <= {"tank", "damage", "support"}
        assert (await registry_service.artifacts.get(db_session, mine_id)).is_active

    _run(db_session, check)


def test_role_less_standby_artifacts_and_historical_versions(db_session: AsyncSession) -> None:
    async def check() -> None:
        algorithm_id = (await registry_service.ensure_algorithm(db_session, SHIFT_MODEL.algorithm_name)).id
        tank_id = (await CatalogRoleRepository().rated_rows(db_session, discipline=OW, workspace_id=None))["tank"].id
        v1_id = (await _register(db_session, algorithm_id, "shift", None, "h1")).id
        v2_id = (await _register(db_session, algorithm_id, "shift", None, "h2")).id
        standby_id = (await _register(db_session, algorithm_id, "shift", None, "h3", activate=False)).id
        db_session.expire_all()
        assert not (await registry_service.artifacts.get(db_session, v1_id)).is_active
        assert not (await registry_service.artifacts.get(db_session, standby_id)).is_active
        active = await registry_service.load_active_artifact(
            db_session, discipline=OW, algorithm_id=algorithm_id, model_kind="shift", role_id=None
        )
        assert active.id == v2_id
        loaded_ids = {
            row.id
            for row in await registry_service.load_active_artifacts(
                db_session, discipline=OW, algorithm_id=algorithm_id, model_kind="shift"
            )
        }
        assert v2_id in loaded_ids and v1_id not in loaded_ids and standby_id not in loaded_ids
        # A role-less shift model is not role-masked: it never answers a role lookup.
        assert (
            await registry_service.load_active_artifact(
                db_session, discipline=OW, algorithm_id=algorithm_id, model_kind="shift", role_id=tank_id
            )
            is None
        )

    _run(db_session, check)
