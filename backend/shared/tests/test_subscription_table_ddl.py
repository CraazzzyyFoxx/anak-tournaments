"""Pin the DDL the two ``subscriptions`` models compile to.

Complements ``test_subscription_models.py``, which reads the same tables through
SQLAlchemy metadata: this file asserts the rendered Postgres text, where the
defaults and quoting actually show up. Every property here is a decision rather
than a default -- the mixin's ``updated_at`` must stay server-default-free,
``enabled`` must default false, entitlement ``state`` must default to ``unknown``
(which fails open, never ``inactive``), and both FKs must CASCADE so a deleted
user or workspace leaves no orphan entitlement behind.

The assertions that read the ``subs0001`` revision file -- its constraint names,
its column coverage, its symmetric downgrade -- went away with the ``initial_v6``
squash, which replaced every per-revision file with one generated baseline. This
is a metadata check, not a substitute for applying the schema: run
``alembic upgrade heads`` against a real database too.
"""

from __future__ import annotations

import re

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models


def _ddl(model) -> str:
    return str(CreateTable(model.__table__).compile(dialect=postgresql.dialect()))


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
