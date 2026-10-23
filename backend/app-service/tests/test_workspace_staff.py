"""Public staff roster: ordering, one row per person, no-player skip.

Real-DB integration in the same shape as ``test_workspace_member_helpers``:
the session is opened, used and rolled back, never committed, so nothing is
left behind; skips cleanly when the DB is unreachable / is production.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
import sqlalchemy as sa

from shared.models.identity.auth_user import AuthUser
from shared.models.identity.rbac import Role, user_roles
from shared.models.identity.user import User
from shared.models.tenancy.workspace import Workspace
from src.services.workspace.service import workspaces as workspace_service

_loop: asyncio.AbstractEventLoop


def run(coro):
    """Run ``coro`` on the loop that owns ``db_session``'s connection."""
    return _loop.run_until_complete(coro)


@pytest.fixture
def db_session():
    """Yield a live AsyncSession, or skip the test if the DB is unreachable.

    Probes with ``select current_database()`` (mirrors the app-service ``rpc``
    fixture / identity-service's ``db_session`` fixture) and hard-guards
    against ever running against a production database. The session is never
    committed by these tests, so nothing written here persists.

    The session holds one asyncpg connection, so every step of a test (probe,
    body, rollback) runs on the same event loop via ``run``; a fresh
    ``asyncio.run`` per step would hand the connection to a closed loop.
    """
    global _loop
    from src.core import db as db_module

    _loop = loop = asyncio.new_event_loop()

    async def _probe_and_open():
        session = db_module.async_session_maker()
        dbname = (await session.execute(sa.text("select current_database()"))).scalar()
        return session, dbname

    async def _finish(session):
        await session.rollback()
        await session.close()
        await db_module.async_engine.dispose()

    try:
        try:
            session, dbname = loop.run_until_complete(_probe_and_open())
        except Exception as exc:  # noqa: BLE001 -- any connect failure => skip, not fail
            pytest.skip(f"database unreachable: {exc}")
            return

        if dbname in {"anak_v5", "anak_prod"}:
            loop.run_until_complete(_finish(session))
            pytest.skip("refusing to run integration tests against production")
            return

        try:
            yield session
        finally:
            loop.run_until_complete(_finish(session))
    finally:
        loop.close()


async def _make_workspace(session) -> Workspace:
    suffix = uuid.uuid4().hex[:12]
    workspace = Workspace(
        slug=f"wsstaff-test-{suffix}",
        name=f"WS Staff Test {suffix}",
    )
    session.add(workspace)
    await session.flush()
    return workspace


async def _make_account(session, *, player_name: str | None) -> AuthUser:
    """An auth user, with a linked player when ``player_name`` is given."""
    suffix = uuid.uuid4().hex[:12]
    auth_user = AuthUser(email=f"wss-{suffix}@example.com", username=f"wss_{suffix}", hashed_password="x")
    session.add(auth_user)
    await session.flush()
    if player_name is not None:
        session.add(User(name=player_name, auth_user_id=auth_user.id))
        await session.flush()
    return auth_user


async def _grant(session, workspace: Workspace, auth_user: AuthUser, role_name: str) -> None:
    role = await session.scalar(sa.select(Role).where(Role.workspace_id == workspace.id, Role.name == role_name))
    if role is None:
        role = Role(name=role_name, workspace_id=workspace.id, is_system=True)
        session.add(role)
        await session.flush()
    await session.execute(sa.insert(user_roles).values(user_id=auth_user.id, role_id=role.id))


def test_staff_is_ranked_deduped_and_skips_playerless_accounts(db_session) -> None:
    suffix = uuid.uuid4().hex[:8]
    owner_name = f"zz_owner_{suffix}"
    admin_a_name = f"aa_admin_{suffix}"
    admin_b_name = f"bb_admin_{suffix}"
    referee_name = f"aa_referee_{suffix}"
    host_name = f"aa_host_{suffix}"

    async def _run():
        workspace = await _make_workspace(db_session)

        owner = await _make_account(db_session, player_name=owner_name)
        admin_a = await _make_account(db_session, player_name=admin_a_name)
        admin_b = await _make_account(db_session, player_name=admin_b_name)
        referee = await _make_account(db_session, player_name=referee_name)
        host = await _make_account(db_session, player_name=host_name)
        playerless = await _make_account(db_session, player_name=None)

        await _grant(db_session, workspace, owner, "owner")
        # Same person twice: the lesser role must not produce a second row.
        await _grant(db_session, workspace, owner, "referee")
        await _grant(db_session, workspace, admin_b, "admin")
        await _grant(db_session, workspace, admin_a, "admin")
        await _grant(db_session, workspace, referee, "referee")
        # Not staff: `host` is a system role but not a published one.
        await _grant(db_session, workspace, host, "host")
        await _grant(db_session, workspace, playerless, "admin")

        return await workspace_service.get_staff(db_session, workspace.id)

    staff = run(_run())

    assert staff == [
        ("owner", owner_name),
        ("admin", admin_a_name),
        ("admin", admin_b_name),
        ("referee", referee_name),
    ]
