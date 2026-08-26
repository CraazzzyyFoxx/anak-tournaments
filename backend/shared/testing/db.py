"""Unified real-Postgres session hook for integration tests across services.

Every service's ``src/core/db.py`` re-exports ``async_session_maker`` bound to
a module-global engine created once at import time. Reusing that global engine
across more than one ``asyncio.run()`` call is unsafe here: pooled asyncpg
connections are bound to the event loop that created them, and this codebase
has no ``pytest-asyncio`` -- async test bodies each get their own event loop
via a fresh ``asyncio.run()`` (or ``unittest.IsolatedAsyncioTestCase``, which
does the same internally). Reusing a pooled connection from a prior loop
raises "Future attached to a different loop" once a second test touches it.

:func:`real_db_sessionmaker` is the fix multiple test files had already
converged on independently (see ``tournament-service/tests/
test_auto_transitions.py``): a throwaway ``NullPool`` engine, created and
disposed inside a single event loop, so nothing outlives that one ``asyncio.
run()``/``IsolatedAsyncioTestCase`` test method. Probing also hard-guards
against ever touching a production database and skips (not fails) when no
database is reachable at all -- unit/validation tests still run, DB-
integration tests skip cleanly, matching CI (no Postgres service required).

Usage in an async test body or ``IsolatedAsyncioTestCase`` method::

    async def test_something():
        async with real_db_sessionmaker() as sessionmaker:
            async with sessionmaker() as session:
                ...

:func:`db_session` is a plain ``pytest.fixture`` for the common single-
session, plain-``def test_x(db_session):`` case; the whole probe lives inside
one ``asyncio.run()`` and hands back an ordinary (already-connected)
``AsyncSession`` for the test body to drive with its own ``asyncio.run(...)``
calls -- safe as long as the test issues at most one such call per session
(the pattern every existing sync-fixture caller already follows).
"""

from __future__ import annotations

import asyncio
import importlib
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

#: Database names integration tests must never run against, regardless of
#: what POSTGRES_* resolves to (a dev machine's real ``.env`` may point at a
#: shared server whose default database is one of these).
PROTECTED_DB_NAMES: frozenset[str] = frozenset({"anak_v5", "anak_prod"})


def _settings():
    # Imported lazily and by name: each service has its own `src.core.config`
    # module at this same dotted path, resolved relative to whichever
    # service's `tests/` directory is on sys.path for the current run.
    return importlib.import_module("src.core.config").settings


@asynccontextmanager
async def real_db_sessionmaker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Yield a session factory bound to a fresh throwaway engine, or skip.

    One engine per call, disposed on exit -- safe to call from any number of
    tests, in any order, without event-loop-lifetime issues.
    """
    engine = create_async_engine(_settings().db_url_asyncpg, poolclass=NullPool)
    try:
        try:
            async with engine.connect() as conn:
                dbname = (await conn.execute(sa.text("select current_database()"))).scalar()
        except Exception as exc:  # noqa: BLE001 -- any connect failure => skip, not fail
            pytest.skip(f"database unreachable: {exc}")
        if dbname in PROTECTED_DB_NAMES:
            pytest.skip("refusing to run integration tests against production")
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


@pytest.fixture
def db_session() -> Iterator[AsyncSession]:
    """Function-scoped live ``AsyncSession``, or skip if unreachable/prod.

    Unlike ``real_db_sessionmaker``, the engine has to outlive the ``async
    with`` block that probes it -- the caller keeps using the session after
    this fixture returns -- so it is opened and disposed by hand instead of
    reusing that context manager.
    """

    async def _open() -> tuple[AsyncEngine, AsyncSession]:
        engine = create_async_engine(_settings().db_url_asyncpg, poolclass=NullPool)
        try:
            async with engine.connect() as conn:
                dbname = (await conn.execute(sa.text("select current_database()"))).scalar()
        except Exception as exc:  # noqa: BLE001 -- any connect failure => skip, not fail
            await engine.dispose()
            pytest.skip(f"database unreachable: {exc}")
        if dbname in PROTECTED_DB_NAMES:
            await engine.dispose()
            pytest.skip("refusing to run integration tests against production")
        return engine, async_sessionmaker(engine, expire_on_commit=False)()

    engine, session = asyncio.run(_open())
    try:
        yield session
    finally:

        async def _close() -> None:
            await session.close()
            await engine.dispose()

        asyncio.run(_close())
