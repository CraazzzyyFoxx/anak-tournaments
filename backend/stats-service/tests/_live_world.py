"""Identity half of the live ingest smoke world: real users, workspaces, roles and API keys (``ApiKeyService.create``).

Run as a subprocess (``python _live_world.py <identity-service dir>``): the stats and identity services both ship a
top-level ``src`` package. The database is the smoke's own ``POSTGRES_DB``; nothing here may run anywhere else. Prints one
``__WORLD__{json}`` line carrying the raw keys (held in memory by the caller, never persisted).

World: one owner holding the workspace ``admin`` role in both workspaces.

* ``OFF`` (overwatch + lol, tournaments with ``logs_official`` false) keys ``off_ok``, ``off_ok2``, ``off_no_scope``
  (``team.create`` only), ``off_revoked``
* ``ON`` (overwatch, ``logs_official`` true) key ``on_ok``
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

IDENTITY = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(IDENTITY))
sys.path.insert(0, str(IDENTITY.parent))

from shared.testing import apply_test_env_defaults  # noqa: E402

apply_test_env_defaults()

import sqlalchemy as sa  # noqa: E402

from shared.rbac import (  # noqa: E402
    assign_workspace_system_role,
    ensure_permission_catalog,
    ensure_workspace_system_roles,
)
from shared.repository import get_or_create_workspace_member  # noqa: E402
from shared.schemas.quota import QuotaLimitsPayload  # noqa: E402
from src import models, schemas  # noqa: E402
from src.core import db  # noqa: E402
from src.services.api_keys import api_keys  # noqa: E402
from src.services.auth import auth  # noqa: E402

PASSWORD = "Correct-horse-battery1!"


async def main() -> dict:
    tag = uuid.uuid4().hex[:8]
    async with db.async_session_maker() as session:
        await ensure_permission_catalog(session)
        email = f"p5-owner-{tag}@example.com"
        owner = await auth.register(
            session, schemas.UserRegister(email=email, username=f"p5_owner_{tag}", password=PASSWORD)
        )
        await session.flush()
        owner_id = owner.id
        workspaces: dict[str, models.Workspace] = {}
        for name, disciplines in (("OFF", ["overwatch", "lol"]), ("ON", ["overwatch"])):
            workspace = models.Workspace(
                slug=f"p5-{name.lower()}-{tag}", name=f"P5 {name}", disciplines_enabled=disciplines
            )
            session.add(workspace)
            await session.flush()
            await ensure_workspace_system_roles(session, workspace.id)
            workspaces[name] = workspace
        player = await session.scalar(sa.select(models.User).where(models.User.auth_user_id == owner_id))
        for workspace in workspaces.values():
            await get_or_create_workspace_member(session, workspace_id=workspace.id, player_id=player.id)
            await assign_workspace_system_role(session, user_id=owner_id, workspace_id=workspace.id, role_name="admin")
        await session.commit()
        ws_ids = {name: workspace.id for name, workspace in workspaces.items()}

        async def issue(workspace: str, scopes: list[str]) -> tuple[str, int]:
            created = await api_keys.create(
                session,
                user=owner,
                payload=schemas.ApiKeyCreate(
                    name=f"{workspace}-{uuid.uuid4().hex[:6]}", workspace_id=ws_ids[workspace], scopes=scopes
                ),
            )
            return created.key, created.api_key.id

        keys: dict[str, tuple[str, int, str]] = {}
        keys["off_ok"] = (*await issue("OFF", ["stats.ingest"]), "OFF")
        keys["off_ok2"] = (*await issue("OFF", ["stats.ingest"]), "OFF")
        keys["off_no_scope"] = (*await issue("OFF", ["team.create"]), "OFF")
        keys["off_revoked"] = (*await issue("OFF", ["stats.ingest"]), "OFF")
        await api_keys.revoke(session, user=owner, api_key_id=keys["off_revoked"][1])
        keys["on_ok"] = (*await issue("ON", ["stats.ingest"]), "ON")
        await session.commit()
        # The plan's default per-key limit (60/min) is smaller than a status-polling smoke: a superuser (as an operator
        # would) raises it for every key, through the same service call the admin API uses.
        root_email = f"p5-root-{tag}@example.com"
        root = await auth.register(
            session,
            schemas.UserRegister(email=root_email, username=f"p5_root_{tag}", password=PASSWORD),
        )
        root.is_superuser = True
        await session.flush()
        root_id = root.id
        for label, (_raw, key_id, _workspace) in keys.items():
            if label == "off_revoked":
                continue
            await api_keys.set_quota(
                session, user=root, api_key_id=key_id, limits=QuotaLimitsPayload(requests_per_minute=100000)
            )
        await session.commit()
        await session.close()

    return {
        "workspaces": ws_ids,
        "owner": {"auth_user_id": owner_id, "email": email, "password": PASSWORD},
        # The superuser login (additive for P8: enabling a game, the catalog seed and the source sync are superuser's).
        "root": {"auth_user_id": root_id, "email": root_email, "password": PASSWORD},
        "keys": {
            label: {"key": raw, "api_key_id": key_id, "workspace": ws} for label, (raw, key_id, ws) in keys.items()
        },
    }


if __name__ == "__main__":
    print("__WORLD__" + json.dumps(asyncio.run(main()), default=str))
