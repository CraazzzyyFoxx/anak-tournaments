"""Complete immutable tournament-reader parity under a native-only database role.

The existing collector includes real hidden-tournament gates, cross-workspace
404s, ownership resolution, expanded reads, events, stats and admin provenance.
"""

from __future__ import annotations

import asyncio

import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from shared.testing.stats_access import native_role
from tests.test_stats_reader_parity import assert_tournament_golden, collect_outputs


def test_tournament_full_golden_without_legacy_access(stats_parity_database):
    async def exercise():
        """Legacy storage access, visibility leaks or any golden regression fail here."""
        url, ids = stats_parity_database
        with native_role(url) as role:
            engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
            try:
                async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
                    await session.execute(sa.text(f'SET LOCAL ROLE "{role}"'))
                    facts = (
                        await session.execute(
                            sa.text("""
                        SELECT current_user, r.rolsuper, r.rolinherit, r.rolbypassrls,
                               (SELECT count(*) FROM pg_class WHERE relowner = r.oid) AS owned_relations,
                               (SELECT count(*) FROM pg_namespace WHERE nspowner = r.oid) AS owned_schemas
                        FROM pg_roles r WHERE r.rolname = current_user
                    """)
                        )
                    ).one()
                    assert tuple(facts) == (role, False, False, False, 0, 0)
                    privileges = dict(
                        (
                            await session.execute(
                                sa.text("""
                        SELECT nspname, has_schema_privilege(current_user, oid, 'USAGE')
                        FROM pg_namespace
                        WHERE nspname IN ('matches', 'log_processing', 'overwatch', 'casual')
                    """)
                            )
                        ).all()
                    )
                    assert {"matches", "log_processing"} <= privileges.keys()
                    assert not any(privileges.values()), privileges
                    assert_tournament_golden(await collect_outputs(session, ids))
                    assert await session.scalar(sa.text("SELECT current_user")) == role
            finally:
                await engine.dispose()

    asyncio.run(exercise())
