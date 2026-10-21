"""Native-only full reader parity and download-reference authorization.

The begin hook also restricts overview enrichment's independently opened sessions.
Raw-reference checks stop before S3: this is not an object-store or transport smoke.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from shared.core.errors import BaseAPIException
from shared.testing.stats_access import native_role
from src.rpc._common import gate_tournament
from src.services.workspace.binary import workspace_binary
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


def test_download_reference_visibility_without_legacy_access(stats_parity_database):
    """Exercise the actual download resolver and RPC gate, without fetching bytes."""
    url, ids = stats_parity_database

    async def run():
        async with _native_session(url) as session:
            for match_key, tournament_key, filename in (
                ("match", "tournament", "main.csv"),
                ("match_reversed", "tournament", "reverse.csv"),
                ("match_other", "tournament_other", "other.csv"),
                ("match_hidden", "tournament_hidden", "hidden.csv"),
            ):
                raw_ref, display_name, tournament_id, _, _ = await workspace_binary.resolve_match_log_ref(
                    session,
                    ids[match_key],
                )
                assert (raw_ref, display_name, tournament_id) == (
                    f"logs/{ids[tournament_key]}/{filename}",
                    filename,
                    ids[tournament_key],
                )
                if match_key != "match_hidden":
                    # Public tournaments authorize anonymous downloads too.
                    await gate_tournament(session, {}, tournament_id)
                    continue

                for request in (
                    {},
                    {
                        "identity": {
                            "user_id": ids["auth_user"],
                            "is_active": True,
                            "workspaces": [{"workspace_id": ids["workspace"], "rbac_roles": []}],
                        }
                    },
                    {
                        "identity": {
                            "user_id": ids["auth_user_no_member"],
                            "is_active": True,
                            "workspaces": [{"workspace_id": ids["workspace_other"], "rbac_roles": ["admin"]}],
                        }
                    },
                ):
                    with pytest.raises(BaseAPIException) as denied:
                        await gate_tournament(session, request, tournament_id)
                    assert denied.value.status_code == 404

                # Application-level workspace admin, still an ordinary DB reader.
                await gate_tournament(
                    session,
                    {
                        "identity": {
                            "user_id": ids["auth_user"],
                            "is_active": True,
                            "is_superuser": False,
                            "workspaces": [{"workspace_id": ids["workspace"], "rbac_roles": ["admin"]}],
                        }
                    },
                    tournament_id,
                )

            raw_ref, _, tournament_id, raw_status, content_hash = await workspace_binary.resolve_match_log_ref(
                session, ids["match_no_raw"]
            )
            await gate_tournament(session, {}, tournament_id)
            with pytest.raises(BaseAPIException) as missing:
                await workspace_binary.fetch_log_bytes(raw_ref, raw_status=raw_status, content_hash=content_hash)
            assert missing.value.status_code == 404
            with pytest.raises(BaseAPIException) as missing:
                await workspace_binary.resolve_match_log_ref(session, -1)
            assert missing.value.status_code == 404

    asyncio.run(run())
