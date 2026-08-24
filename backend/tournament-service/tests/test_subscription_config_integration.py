"""Provider-config persistence against a real Postgres.

Skipped unless ``SUBSCRIPTIONS_IT_DSN`` is set. The unit tests cover the pure
merge/redaction rules; these cover what only a real database has an opinion about,
and one of them caught a genuine bug:

``upsert_provider_config`` writes with ``INSERT ... ON CONFLICT``, which changes the
row behind the ORM's back. The post-upsert SELECT was therefore served from the
identity map and returned the PRE-upsert ``config_json`` — so clearing the codes
with an explicit ``[]`` silently appeared to do nothing.
``test_explicit_empty_code_list_clears_them`` pins the fix.

Run::

    SUBSCRIPTIONS_IT_DSN=postgresql+psycopg://user:pw@127.0.0.1:15432/anak_dev \\
        uv run pytest tournament-service/tests/test_subscription_config_integration.py -v
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa

DSN = os.environ.get("SUBSCRIPTIONS_IT_DSN")

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

for _key, _value in {
    "POSTGRES_HOST": "localhost",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "tournament_test",
    "POSTGRES_USER": "postgres",
    "POSTGRES_PASSWORD": "postgres",
    "JWT_SECRET_KEY": "test-secret",
    "REDIS_URL": "redis://localhost:6379",
}.items():
    os.environ.setdefault(_key, _value)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

ROLE = "9876543210987654321"


@unittest.skipUnless(DSN, "set SUBSCRIPTIONS_IT_DSN to run config integration tests")
class TestProviderConfigPersistence(IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        self._engine = create_async_engine(DSN, connect_args={"connect_timeout": 20})
        self._session = async_sessionmaker(self._engine, expire_on_commit=False)()
        self.ws = (await self._session.execute(sa.text("select id from workspace order by id limit 1"))).scalar()
        if self.ws is None:
            self.skipTest("target database has no workspace to anchor the FK")

        # Snapshot: `test_the_list_response_reports_the_workspace_guild` mutates a
        # real workspace row and must put it back.
        self._guild_before = (
            await self._session.execute(sa.text("select discord_guild_id from workspace where id=:w"), {"w": self.ws})
        ).scalar()

    async def asyncTearDown(self) -> None:
        await self._session.execute(
            sa.text("delete from subscriptions.provider_config where workspace_id = :w"),
            {"w": self.ws},
        )
        await self._session.execute(
            sa.text("update workspace set discord_guild_id=:g where id=:w"),
            {"g": self._guild_before, "w": self.ws},
        )
        await self._session.commit()
        await self._session.close()
        await self._engine.dispose()

    async def _save(self, **kwargs):
        from src.schemas.registration import SubscriptionProviderConfigUpsert
        from src.services.registration import subscription_config

        return await subscription_config.upsert_provider_config(
            self._session,
            workspace_id=self.ws,
            body=SubscriptionProviderConfigUpsert(**kwargs),
        )

    async def _raw_config(self, provider: str) -> str:
        return (
            await self._session.execute(
                sa.text(
                    "select config_json::text from subscriptions.provider_config "
                    "where workspace_id = :w and provider = :p"
                ),
                {"w": self.ws, "p": provider},
            )
        ).scalar() or ""

    async def test_lists_every_configurable_provider_before_anything_is_saved(self):
        from src.services.registration import subscription_config

        listed = await subscription_config.list_provider_configs(self._session, self.ws)
        assert [c.provider for c in listed.configs] == ["boosty", "twitch"]
        assert all(c.enabled is False for c in listed.configs)

    async def test_stores_the_role_mapping(self):
        read = await self._save(
            provider="boosty",
            enabled=True,
            role_tiers=[{"role_id": ROLE, "tier_rank": 2, "tier_label": "Уровень 2"}],
        )
        assert read.role_tiers[0].role_id == ROLE
        assert read.role_tiers[0].tier_rank == 2

    async def test_snowflakes_survive_as_strings(self):
        """A Discord id exceeds 2**53; a float round-trip would corrupt it."""
        await self._save(provider="boosty", role_tiers=[{"role_id": ROLE, "tier_rank": 1}])
        raw = await self._raw_config("boosty")
        assert f'"{ROLE}"' in raw

    async def test_the_list_response_reports_the_workspace_guild(self):
        """The guild is workspace-scoped: one field for the whole response."""
        from src.services.registration import subscription_config

        await self._session.execute(
            sa.text("update workspace set discord_guild_id='424242424242424242' where id=:w"),
            {"w": self.ws},
        )
        await self._session.commit()
        response = await subscription_config.list_provider_configs(self._session, self.ws)
        assert response.discord_guild_id == "424242424242424242"

    async def test_plaintext_code_never_reaches_the_database(self):
        read = await self._save(provider="boosty", codes=[{"code": "live-secret", "tier_rank": 3, "tier_label": "L3"}])
        from shared.services.subscriptions.challenge_code import hash_code

        raw = await self._raw_config("boosty")
        assert "live-secret" not in raw
        assert hash_code("live-secret") in raw
        # And the digest must not travel back to the client either.
        assert hash_code("live-secret") not in str(read.model_dump())
        assert read.codes[0].tier_rank == 3

    async def test_saving_without_codes_keeps_them(self):
        """The admin cannot see stored codes, so a plain save must not wipe them."""
        await self._save(provider="boosty", codes=[{"code": "keep-me", "tier_rank": 1}])
        read = await self._save(provider="boosty")
        assert len(read.codes) == 1

    async def test_explicit_empty_code_list_clears_them(self):
        """Regression: the post-upsert read used to come from the identity map and
        still showed the old codes."""
        await self._save(provider="boosty", codes=[{"code": "drop-me", "tier_rank": 1}])
        read = await self._save(provider="boosty", codes=[])
        assert read.codes == []
        assert "drop-me" not in await self._raw_config("boosty")

    async def test_stores_twitch_broadcaster(self):
        read = await self._save(provider="twitch", enabled=True, broadcaster_id="12345", broadcaster_login="streamer")
        assert (read.broadcaster_id, read.broadcaster_login) == ("12345", "streamer")

    async def test_repeated_save_updates_in_place(self):
        await self._save(provider="boosty", verification_method="live")
        await self._save(provider="boosty", verification_method="code")
        count = (
            await self._session.execute(
                sa.text(
                    "select count(*) from subscriptions.provider_config where workspace_id = :w and provider = 'boosty'"
                ),
                {"w": self.ws},
            )
        ).scalar()
        assert count == 1
        read = await self._save(provider="boosty")
        assert read.verification_method == "code"

    async def test_enabled_flag_round_trips(self):
        assert (await self._save(provider="boosty", enabled=True)).enabled is True
        assert (await self._save(provider="boosty", enabled=False)).enabled is False
