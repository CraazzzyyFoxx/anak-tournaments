"""Every built-in status the code knows has its global row, so the catalog lists it and a workspace can override it.

``regstat01`` re-seeded the v5 rows, which never had ``excluded``: Settings > Player statuses lacked it and overriding
it 404'd. Runs against the migrated test database; skips without one.
"""

from __future__ import annotations

import asyncio
import uuid

import sqlalchemy as sa

from shared import models
from shared.registration_statuses import BUILTIN_STATUS_META
from src.services.registration.status_catalog import status_catalog_service


def test_every_builtin_status_has_one_global_row_and_can_be_overridden(db_session) -> None:
    async def run() -> None:
        rows = (
            await db_session.scalars(
                sa.select(models.RegistrationStatus).where(
                    models.RegistrationStatus.workspace_id.is_(None), models.RegistrationStatus.kind == "builtin"
                )
            )
        ).all()
        keys = [(row.scope, row.slug) for row in rows]
        assert len(keys) == len(set(keys)), "one global row per builtin"
        assert set(keys) == {(scope, slug) for scope, items in BUILTIN_STATUS_META.items() for slug in items}
        by_key = {(row.scope, row.slug): row for row in rows}
        for slug in ("excluded", "not_in_balancer"):
            meta = BUILTIN_STATUS_META["balancer"][slug]
            row = by_key[("balancer", slug)]
            assert (row.name, row.description, row.icon_slug, row.icon_color) == (
                meta["name"],
                meta["description"],
                meta["icon_slug"],
                meta["icon_color"],
            )

        workspace = models.Workspace(slug=f"status-rows-{uuid.uuid4().hex[:8]}", name="Status rows")
        db_session.add(workspace)
        await db_session.commit()
        workspace_id = workspace.id
        try:
            override = await status_catalog_service.upsert_builtin_override(
                db_session,
                workspace_id=workspace_id,
                scope="balancer",
                slug="excluded",
                icon_slug=None,
                icon_color=None,
                name="Benched",
                description=None,
            )
            assert (override.workspace_id, override.name, override.description) == (
                workspace_id,
                "Benched",
                BUILTIN_STATUS_META["balancer"]["excluded"]["description"],
            )
        finally:
            await db_session.rollback()
            await db_session.execute(sa.delete(models.Workspace).where(models.Workspace.id == workspace_id))
            await db_session.commit()

    asyncio.run(run())
