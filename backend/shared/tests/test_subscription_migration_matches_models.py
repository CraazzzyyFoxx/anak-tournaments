"""Guard the migration against model drift.

``subs0001`` hand-writes the DDL for the two ``subscriptions`` tables. If someone
edits the model without touching the migration (or vice versa) a fresh database
and a migrated one diverge silently -- and the mismatch only surfaces in
production. These tests compile the *models* against the Postgres dialect and
assert the properties the migration hard-codes.

This is a metadata check, not a substitute for applying the migration: run
``alembic upgrade heads`` against a real database too.
"""

from __future__ import annotations

import pathlib
import re

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models

MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2] / "migrations" / "versions" / "subs0001_add_subscription_tables.py"
)


def _ddl(model) -> str:
    return str(CreateTable(model.__table__).compile(dialect=postgresql.dialect()))


class TestMigrationFileExists:
    def test_migration_is_present(self):
        assert MIGRATION.is_file(), f"missing {MIGRATION}"

    def test_chains_off_a_committed_revision(self):
        """`down_revision` must not point at uncommitted local work, or this
        migration dangles for anyone who checks out the commit without it."""
        text = MIGRATION.read_text(encoding="utf-8")
        match = re.search(r'^down_revision[^=]*=\s*"([^"]+)"', text, re.M)
        assert match, "down_revision must be a single quoted revision id"
        assert match.group(1) == "statidx001"


class TestProviderConfigDDL:
    def test_pk_is_bigserial(self):
        """db.TimeStampIntegerMixin uses BigInteger, not Integer."""
        assert "id BIGSERIAL NOT NULL" in _ddl(models.SubscriptionProviderConfig)

    def test_updated_at_is_nullable_without_server_default(self):
        """The mixin sets updated_at via onupdate; a server_default here would
        diverge from every other table."""
        ddl = _ddl(models.SubscriptionProviderConfig)
        assert re.search(r"updated_at TIMESTAMP WITH TIME ZONE,\s", ddl)
        assert "updated_at TIMESTAMP WITH TIME ZONE DEFAULT" not in ddl

    def test_enabled_defaults_false(self):
        assert "enabled BOOLEAN DEFAULT 'false' NOT NULL" in _ddl(models.SubscriptionProviderConfig)

    def test_unique_constraint_name_matches_migration(self):
        name = "uq_subscription_config_workspace_provider"
        assert name in _ddl(models.SubscriptionProviderConfig)
        assert name in MIGRATION.read_text(encoding="utf-8")


class TestEntitlementDDL:
    def test_pk_is_bigserial(self):
        assert "id BIGSERIAL NOT NULL" in _ddl(models.SubscriptionEntitlement)

    def test_state_defaults_to_unknown(self):
        """`unknown` fails open — the default must never be `inactive`."""
        assert "state VARCHAR(16) DEFAULT 'unknown' NOT NULL" in _ddl(models.SubscriptionEntitlement)

    def test_auth_user_fk_quotes_the_reserved_table_name(self):
        ddl = _ddl(models.SubscriptionEntitlement)
        assert 'FOREIGN KEY(auth_user_id) REFERENCES auth."user" (id) ON DELETE CASCADE' in ddl

    def test_workspace_fk_cascades(self):
        ddl = _ddl(models.SubscriptionEntitlement)
        assert "FOREIGN KEY(workspace_id) REFERENCES workspace (id) ON DELETE CASCADE" in ddl

    def test_timestamps_are_timezone_aware(self):
        ddl = _ddl(models.SubscriptionEntitlement)
        assert "checked_at TIMESTAMP WITH TIME ZONE" in ddl
        assert "expires_at TIMESTAMP WITH TIME ZONE" in ddl

    def test_unique_constraint_name_matches_migration(self):
        name = "uq_subscription_entitlement_scope"
        assert name in _ddl(models.SubscriptionEntitlement)
        assert name in MIGRATION.read_text(encoding="utf-8")


class TestMigrationCoversEveryModelColumn:
    """The strongest cheap check: every model column must be named in the migration."""

    def test_provider_config_columns_all_present(self):
        text = MIGRATION.read_text(encoding="utf-8")
        for column in models.SubscriptionProviderConfig.__table__.columns:
            assert f'"{column.name}"' in text, f"provider_config.{column.name} missing"

    def test_entitlement_columns_all_present(self):
        text = MIGRATION.read_text(encoding="utf-8")
        for column in models.SubscriptionEntitlement.__table__.columns:
            assert f'"{column.name}"' in text, f"entitlement.{column.name} missing"


class TestDowngradeIsSymmetric:
    def test_drops_both_tables(self):
        text = MIGRATION.read_text(encoding="utf-8")
        downgrade = text.split("def downgrade()")[1]
        assert 'drop_table("entitlement"' in downgrade
        assert 'drop_table("provider_config"' in downgrade

    def test_drops_every_index_it_creates(self):
        text = MIGRATION.read_text(encoding="utf-8")
        upgrade, downgrade = text.split("def downgrade()")
        created = set(re.findall(r'create_index\(\s*(?:op\.f\()?\s*"([^"]+)"', upgrade))
        dropped = set(re.findall(r'drop_index\(\s*(?:op\.f\()?\s*"([^"]+)"', downgrade))
        assert created, "expected the migration to create indexes"
        assert created == dropped, f"asymmetric: created-only {created - dropped}"

    def test_drops_the_schema(self):
        downgrade = MIGRATION.read_text(encoding="utf-8").split("def downgrade()")[1]
        assert "DROP SCHEMA IF EXISTS" in downgrade
