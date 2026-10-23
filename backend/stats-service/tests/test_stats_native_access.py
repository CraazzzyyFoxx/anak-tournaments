"""Native-only full reader parity.

The begin hook also restricts overview enrichment's independently opened sessions.
The download-reference authorization half stays with app-service, which owns that resolver.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from shared.testing.stats_access import native_role
from tests.stats_reader_numeric_parity import assert_app_golden
from tests.test_stats_reader_parity import collect_outputs


@asynccontextmanager
async def _native_session(url):
    with native_role(url) as role:
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))

        @sa.event.listens_for(engine.sync_engine, "begin")
        def restrict_transaction(connection):
            # Apply to EVERY connection, not just the collector's main session.
            connection.execute(sa.text(f'SET LOCAL ROLE "{role}"'))
            facts = connection.execute(
                sa.text("""
                SELECT current_user, r.rolsuper, r.rolinherit, r.rolbypassrls,
                       (SELECT count(*) FROM pg_class WHERE relowner = r.oid) AS owned_relations,
                       (SELECT count(*) FROM pg_namespace WHERE nspowner = r.oid) AS owned_schemas
                FROM pg_roles r WHERE r.rolname = current_user
            """)
            ).one()
            assert tuple(facts) == (role, False, False, False, 0, 0)

        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                yield session
        finally:
            await engine.dispose()


def test_app_full_golden_without_legacy_access(stats_parity_database):
    """Any changed reader/enrichment output fails, under a non-owner role."""
    url, ids = stats_parity_database

    async def run():
        async with _native_session(url) as session:
            await assert_app_golden(session, ids, await collect_outputs(session, ids))

    asyncio.run(run())
