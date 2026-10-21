"""Builds real ``auth.api_key`` rows through identity-service and resolves them with its real ``validate_token`` handler.

Run as a subprocess (``python _identity_world.py <identity-service dir>``) because the parser and identity services both
ship a top-level ``src`` package and cannot share one interpreter. The target database comes from the ``POSTGRES_*``
environment. It prints one ``__WORLD__{json}`` line: every identity is exactly what the gateway would stamp for that
credential (``None`` when ``validate_token`` answers 401).

World (all owned by one ``owner`` holding the workspace ``admin`` role, except the superuser key):

* A: ``ok`` and ``ok2`` (stats.ingest), ``no_scope`` (team.create only), ``expired``, ``revoked``
* B: ``denied`` (owner gets a workspace deny after issue), ``super`` (superuser-backed key with stats.ingest)
* C: ``removed`` (the owner's custom role loses stats.ingest after issue)
* D: ``inactive`` (workspace deactivated after issue)
* E: ``lol_only`` (workspace without the overwatch discipline)
* ``session``: the owner's ordinary access-token identity
* ``create_refused``: minting a stats.ingest key in C after its owner lost the permission
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

IDENTITY = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(IDENTITY))
sys.path.insert(0, str(IDENTITY.parent))

from shared.testing import apply_test_env_defaults  # noqa: E402

apply_test_env_defaults()

import sqlalchemy as sa  # noqa: E402
from loguru import logger  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from shared import models
from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from shared.models.identity.rbac import Permission, Role, UserPermissionDeny, user_roles  # noqa: E402
from shared.rbac import (  # noqa: E402
    assign_workspace_system_role,
    ensure_permission_catalog,
    ensure_workspace_system_roles,
)
from shared.repository import get_or_create_workspace_member  # noqa: E402
from src import schemas  # noqa: E402
from src.core import db  # noqa: E402
from src.rpc import tokens as tokens_rpc  # noqa: E402
from src.services.api_keys import api_keys  # noqa: E402
from src.services.auth import auth  # noqa: E402
from src.services.token_payload import token_payloads  # noqa: E402

PASSWORD = "Correct-horse-battery1!"


class _Broker:
    """Captures ``@broker.subscriber`` handlers so the real ``validate_token`` function can be called directly."""

    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def subscriber(self, name: str):
        def decorate(fn):
            self.handlers[name] = fn
            return fn

        return decorate


async def main() -> dict:
    tag = uuid.uuid4().hex[:8]
    broker = _Broker()
    tokens_rpc.register(broker, logger)
    validate_token = broker.handlers["rpc.identity.validate_token"]

    async def identity_of(raw: str) -> dict | None:
        reply = await validate_token({"token": raw}, None)
        return reply["data"] if reply.get("ok") else None

    async with db.async_session_maker() as session:
        await ensure_permission_catalog(session)
        owner = await auth.register(
            session,
            schemas.UserRegister(email=f"w-owner-{tag}@example.com", username=f"w_owner_{tag}", password=PASSWORD),
        )
        root = await auth.register(
            session,
            schemas.UserRegister(email=f"w-root-{tag}@example.com", username=f"w_root_{tag}", password=PASSWORD),
        )
        root.is_superuser = True
        await session.flush()
        owner_id = owner.id
        workspaces: dict[str, models.Workspace] = {}
        for name, disciplines in (
            ("A", ["overwatch"]),
            ("B", ["overwatch"]),
            ("C", ["overwatch"]),
            ("D", ["overwatch"]),
            ("E", ["lol"]),
        ):
            workspace = models.Workspace(
                slug=f"w-{name.lower()}-{tag}", name=f"World {name}", disciplines_enabled=disciplines
            )
            session.add(workspace)
            await session.flush()
            await ensure_workspace_system_roles(session, workspace.id)
            workspaces[name] = workspace
        ws_ids = {name: workspace.id for name, workspace in workspaces.items()}
        for user in (owner, root):
            player = await session.scalar(sa.select(models.User).where(models.User.auth_user_id == user.id))
            for name, workspace in workspaces.items():
                if user is root and name != "B":
                    continue
                await get_or_create_workspace_member(session, workspace_id=workspace.id, player_id=player.id)
                if name == "C":
                    continue  # C's owner holds a custom role instead: the system admin role is a blanket bypass
                await assign_workspace_system_role(
                    session, user_id=user.id, workspace_id=workspace.id, role_name="admin"
                )
        catalog = await ensure_permission_catalog(session)
        staff = Role(
            name="ingest-staff",
            workspace_id=ws_ids["C"],
            permissions=[catalog["team.create"], catalog["stats.ingest"]],
        )
        session.add(staff)
        await session.flush()
        await session.execute(sa.insert(user_roles).values(user_id=owner.id, role_id=staff.id))
        await session.commit()

        async def issue(workspace: str, scopes: list[str], *, user=owner, **extra) -> tuple[str, int]:
            created = await api_keys.create(
                session,
                user=user,
                payload=schemas.ApiKeyCreate(
                    name=f"{workspace}-{uuid.uuid4().hex[:6]}", workspace_id=ws_ids[workspace], scopes=scopes, **extra
                ),
            )
            return created.key, created.api_key.id

        keys: dict[str, tuple[str, int, str]] = {}
        keys["ok"] = (*await issue("A", ["stats.ingest"]), "A")
        keys["ok2"] = (*await issue("A", ["stats.ingest"]), "A")
        keys["no_scope"] = (*await issue("A", ["team.create"]), "A")
        keys["expired"] = (*await issue("A", ["stats.ingest"], expires_at=datetime.now(UTC) + timedelta(hours=1)), "A")
        await session.execute(
            sa.update(models.ApiKey)
            .where(models.ApiKey.id == keys["expired"][1])
            .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        keys["revoked"] = (*await issue("A", ["stats.ingest"]), "A")
        await api_keys.revoke(session, user=owner, api_key_id=keys["revoked"][1])
        keys["denied"] = (*await issue("B", ["stats.ingest"]), "B")
        keys["super"] = (
            *await issue(
                "B", ["stats.ingest"], user=root, is_superuser=True, expires_at=datetime.now(UTC) + timedelta(hours=1)
            ),
            "B",
        )
        keys["removed"] = (*await issue("C", ["stats.ingest"]), "C")
        keys["inactive"] = (*await issue("D", ["stats.ingest"]), "D")
        keys["lol_only"] = (*await issue("E", ["stats.ingest"]), "E")

        permission = await session.scalar(sa.select(Permission).where(Permission.name == "stats.ingest"))
        session.add(UserPermissionDeny(user_id=owner.id, permission_id=permission.id, workspace_id=ws_ids["B"]))
        staff = await session.scalar(sa.select(Role).where(Role.id == staff.id).options(selectinload(Role.permissions)))
        staff.permissions = [p for p in staff.permissions if p.name != "stats.ingest"]
        await session.execute(
            sa.update(models.Workspace).where(models.Workspace.id == ws_ids["D"]).values(is_active=False)
        )
        await session.commit()

        # A key cannot be minted with a scope its owner no longer holds (C's custom role lost stats.ingest).
        try:
            await issue("C", ["stats.ingest"])
            refused = None
        except HTTPException as exc:
            await session.rollback()
            refused = {"status": exc.status_code, "detail": str(exc.detail)}

        owner = await session.get(models.AuthUser, owner_id, populate_existing=True)
        session_identity = (await token_payloads.build(session, owner)).model_dump(mode="json")
        identities = {label: await identity_of(raw) for label, (raw, _id, _ws) in keys.items()}
        await session.close()

    return {
        "workspaces": ws_ids,
        "owner_auth_user_id": owner_id,
        "keys": {
            label: {"api_key_id": key_id, "workspace": ws, "identity": identities[label]}
            for label, (_raw, key_id, ws) in keys.items()
        },
        "session": session_identity,
        "create_refused": refused,
    }


if __name__ == "__main__":
    print("__WORLD__" + json.dumps(asyncio.run(main()), default=str))
