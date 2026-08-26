"""``RoleAdminService.list`` must self-heal a workspace's system-role catalog
(real-DB integration; mirrors the DB-skip pattern in
``test_token_workspace_membership.py``).

System roles (owner/admin/host/member/player) are created lazily by
add_member/grant/registration -- never on workspace creation alone. A
workspace that has not exercised one of those paths since a new system role
landed in the catalog would otherwise show a stale role list: the admin
"Roles" page and the members page's role picker would be missing an entry
(e.g. "Host") even though the catalog now defines it.
"""

import asyncio
import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace


def _ensure_test_env() -> None:
    env = {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "anak_dev",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "JWT_SECRET_KEY": "test-secret",
        "DISCORD_CLIENT_ID": "discord-client",
        "DISCORD_CLIENT_SECRET": "discord-secret",
        "TWITCH_CLIENT_ID": "twitch-client",
        "TWITCH_CLIENT_SECRET": "twitch-secret",
        "BATTLENET_CLIENT_ID": "battlenet-client",
        "BATTLENET_CLIENT_SECRET": "battlenet-secret",
        "OAUTH_REDIRECT": "http://localhost:3000/auth/callback",
    }
    for key, value in env.items():
        os.environ.setdefault(key, value)


_ensure_test_env()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest  # noqa: E402

from shared.rbac import WORKSPACE_SYSTEM_ROLE_NAMES  # noqa: E402
from src import models, schemas  # noqa: E402
from src.services.rbac_admin import RoleAdminService  # noqa: E402


@pytest.fixture
def db_session():
    """Yield a live AsyncSession, or skip the test if the DB is unreachable.

    Mirrors ``test_signup_provisions_player.py``'s ``db_session`` fixture.
    """
    from src.core import db as db_module

    async def _make():
        try:
            session = db_module.async_session_maker()
            await session.execute(__import__("sqlalchemy").text("SELECT 1"))
        except Exception as exc:  # pragma: no cover - environment guard
            pytest.skip(f"database unavailable: {exc}")
        return session

    session = asyncio.run(_make())
    yield session
    asyncio.run(session.close())


def test_listing_workspace_roles_creates_missing_system_roles(db_session) -> None:
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        workspace = models.Workspace(slug=f"role-list-test-{suffix}", name=f"Role List Test {suffix}")
        db_session.add(workspace)
        await db_session.commit()

        superuser = SimpleNamespace(is_superuser=True)
        params = schemas.RoleListParams(page=1, per_page=-1, workspace_id=workspace.id)
        result = await RoleAdminService().list(db_session, superuser, params)
        return result

    result = asyncio.run(_run())

    names = {role.name for role in result["results"]}
    assert set(WORKSPACE_SYSTEM_ROLE_NAMES) <= names
    assert "host" in names
