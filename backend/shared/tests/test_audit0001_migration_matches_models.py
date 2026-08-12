"""Guard ``audit0001`` against model drift.

The revision hand-writes the DDL for ``public.audit_log``, so the model and the
migration are two independent statements of the same table -- exactly the shape
that silently diverges. Three properties of this table are load-bearing and none
of them is self-evident from either file alone:

- **No foreign keys.** The journal must outlive the actor and the entity it
  describes. A CASCADE added "for referential hygiene" would delete a deleted
  tournament's history; a SET NULL would blank the actor. Both apply cleanly and
  destroy the only thing the table exists for.
- **No ``payload_json``, no ``method``.** The first was removed so that raw
  request bodies -- secrets, 16 MB base64 blobs -- are never captured at all,
  which is what makes "no secrets in the journal" structural rather than a
  denylist. The second had no reader. Re-adding either is a regression, not a
  feature.
- **Exactly three indexes, all trailing in ``created_at``.** A fourth taxes every
  INSERT on a growing table; sorting on ``id`` instead would order the feed
  wrongly, because ``now()`` is the transaction start time.

These tests compile the model against the Postgres dialect and assert the
properties the revision hard-codes. This is a metadata check, not a substitute
for applying it: run ``alembic upgrade heads`` against a real database too -- in
particular the RBAC backfill cannot be exercised here.

Form follows ``shared/tests/test_encres0001_migration_matches_models.py``.
"""

from __future__ import annotations

import importlib.util
import pathlib
import re

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models
from shared.rbac.catalog import PERMISSION_CATALOG, permission_names_for_workspace_role

MIGRATION = pathlib.Path(__file__).resolve().parents[2] / "migrations" / "versions" / "audit0001_platform_audit_log.py"

# The design's column contract, pinned literally. Deriving the expectation from
# the model would let both sides drift together in silence; this way a change has
# to be made here as well, which is where a reviewer will see it.
#
# (name, rendered PG type, nullable, the type as the revision spells it)
_EXPECTED: tuple[tuple[str, str, bool, str], ...] = (
    ("id", "BIGSERIAL", False, "sa.BigInteger()"),
    ("created_at", "TIMESTAMP WITH TIME ZONE", False, "sa.DateTime(timezone=True)"),
    ("workspace_id", "BIGINT", True, "sa.BigInteger()"),
    ("actor_auth_user_id", "BIGINT", True, "sa.BigInteger()"),
    ("actor_label", "VARCHAR(255)", True, "sa.String(length=255)"),
    ("source", "VARCHAR(16)", False, "sa.String(length=16)"),
    ("action", "VARCHAR(64)", False, "sa.String(length=64)"),
    ("entity_type", "VARCHAR(64)", True, "sa.String(length=64)"),
    ("entity_id", "BIGINT", True, "sa.BigInteger()"),
    ("entity_label", "VARCHAR(255)", True, "sa.String(length=255)"),
    ("before_json", "JSONB", True, "postgresql.JSONB()"),
    ("after_json", "JSONB", True, "postgresql.JSONB()"),
    ("reason", "TEXT", True, "sa.Text()"),
    ("ip_address", "VARCHAR(45)", True, "sa.String(length=45)"),
    ("user_agent", "VARCHAR(255)", True, "sa.String(length=255)"),
    ("correlation_id", "VARCHAR(64)", True, "sa.String(length=64)"),
)

_INDEXES: dict[str, tuple[str, ...]] = {
    "ix_audit_log_workspace_created": ("workspace_id", "created_at"),
    "ix_audit_log_entity_created": ("entity_type", "entity_id", "created_at"),
    "ix_audit_log_actor_created": ("actor_auth_user_id", "created_at"),
}


def _module():
    """Import the revision so its constants are asserted as evaluated, not as
    source text."""
    spec = importlib.util.spec_from_file_location("audit0001", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _ddl() -> str:
    return str(CreateTable(models.AuditLog.__table__).compile(dialect=postgresql.dialect()))


def _text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _create_table_text() -> str:
    """Just the ``op.create_table`` call, so column parsing cannot pick up
    anything from the indexes, the backfill, or the downgrade."""
    text = _text()
    start = text.index("op.create_table(")
    return text[start : text.index("op.create_index(", start)]


def _migration_columns() -> dict[str, str]:
    """Map column name -> the source text of its ``sa.Column(...)`` entry.

    Split rather than a regex: a column's keyword arguments contain their own
    parentheses (``sa.DateTime(timezone=True)``), so a non-greedy match to the
    first ``)`` would truncate the entry and read nullability off the wrong text.
    """
    chunks: dict[str, str] = {}
    for chunk in _create_table_text().split("sa.Column(")[1:]:
        match = re.match(r'\s*"([a-z_]+)"', chunk)
        assert match, f"unnamed sa.Column in the revision: {chunk[:60]!r}"
        assert match.group(1) not in chunks, f"duplicate column {match.group(1)!r}"
        chunks[match.group(1)] = chunk
    return chunks


class TestRevisionWiring:
    def test_migration_is_present(self):
        assert MIGRATION.is_file(), f"missing {MIGRATION}"

    def test_revision_id_matches_the_filename(self):
        match = re.search(r'^revision[^=]*=\s*"([^"]+)"', _text(), re.M)
        assert match, "revision must be a single quoted id"
        assert match.group(1) == "audit0001"
        assert MIGRATION.name.startswith("audit0001_")

    def test_chains_off_the_current_head(self):
        """`down_revision` must not point at uncommitted local work, or this
        migration dangles for anyone who checks out the commit without it."""
        match = re.search(r'^down_revision[^=]*=\s*"([^"]+)"', _text(), re.M)
        assert match, "down_revision must be a single quoted revision id"
        assert match.group(1) == "mapidx01"

    def test_the_journal_stays_in_public(self):
        """``public``, beside ``event_outbox``: the table spans every domain and
        belongs to none of them, so ``op.create_table`` takes no ``schema=``."""
        assert models.AuditLog.__table__.schema is None
        assert "schema=" not in _create_table_text()


class TestColumnParity:
    def test_model_declares_exactly_the_expected_columns_in_order(self):
        names = tuple(models.AuditLog.__table__.columns.keys())
        assert names == tuple(name for name, *_ in _EXPECTED)

    def test_migration_declares_exactly_the_expected_columns_in_order(self):
        assert tuple(_migration_columns()) == tuple(name for name, *_ in _EXPECTED)

    def test_rendered_types_match(self):
        ddl = _ddl()
        for name, sql_type, _, _ in _EXPECTED:
            assert f"{name} {sql_type}" in ddl, f"{name} is not {sql_type} in the model DDL"

    def test_migration_spells_the_same_types(self):
        chunks = _migration_columns()
        for name, _, _, migration_type in _EXPECTED:
            assert migration_type in chunks[name], f"{name} is not {migration_type} in the revision"

    def test_nullability_matches_on_both_sides(self):
        chunks = _migration_columns()
        columns = models.AuditLog.__table__.columns
        for name, _, nullable, _ in _EXPECTED:
            assert columns[name].nullable is nullable, f"model nullability drifted on {name}"
            # every column spells `nullable=` explicitly, so this is a real read
            assert ("nullable=False" in chunks[name]) is (not nullable), f"revision nullability drifted on {name}"

    def test_source_and_action_are_required(self):
        """The two columns a row is worthless without: ``source`` distinguishes a
        machine write from an admin one, ``action`` is the whole semantics.
        ``record_audit`` takes both as required keywords for the same reason."""
        ddl = _ddl()
        assert "source VARCHAR(16) NOT NULL" in ddl
        assert "action VARCHAR(64) NOT NULL" in ddl

    def test_pk_is_bigserial(self):
        """BigInteger, not Integer: an append-only journal is the one table that
        only ever grows."""
        assert "id BIGSERIAL NOT NULL" in _ddl()
        assert 'sa.PrimaryKeyConstraint("id")' in _text()

    def test_created_at_defaults_on_the_server(self):
        """The writer never supplies it; ordering depends on it existing."""
        assert models.AuditLog.__table__.c.created_at.server_default is not None
        assert "server_default=sa.func.now()" in _migration_columns()["created_at"]

    def test_there_is_no_updated_at(self):
        """``db.Base``, not ``db.TimeStampIntegerMixin``: a row is written once
        inside the mutation's transaction and never touched again, so
        ``updated_at`` on it could only ever hold a lie."""
        assert "updated_at" not in models.AuditLog.__table__.columns
        assert '"updated_at"' not in _text()


class TestNoForeignKeys:
    def test_model_has_none(self):
        """The row must survive the deletion of its actor, its entity and its
        workspace -- the convention ``event_outbox`` and ``workspace_event``
        already follow. Hence the ``*_label`` snapshots instead."""
        assert models.AuditLog.__table__.foreign_keys == set()
        assert "REFERENCES" not in _ddl()

    def test_migration_declares_none(self):
        text = _text()
        assert "sa.ForeignKey" not in text
        assert "ForeignKeyConstraint" not in text
        assert "ondelete=" not in text

    def test_the_label_snapshots_exist(self):
        """They are what makes a row readable once its referent is gone; drop
        them and the missing FK becomes data loss instead of a design choice."""
        columns = models.AuditLog.__table__.columns
        for name in ("actor_label", "entity_label"):
            assert name in columns
            assert columns[name].nullable is True


class TestRemovedColumns:
    def test_payload_json_is_absent(self):
        """Removed so raw request bodies are never captured: nothing to redact
        if nothing was collected wholesale. ``before_json``/``after_json`` are
        assembled by the caller from named domain fields."""
        assert "payload_json" not in models.AuditLog.__table__.columns
        assert '"payload_json"' not in _text()

    def test_method_is_absent(self):
        """Write-only: no filter, no index, no renderer. ``action`` carries the
        semantics and ``correlation_id`` stitches the row to the trace."""
        assert "method" not in models.AuditLog.__table__.columns
        assert '"method"' not in _text()

    def test_the_replacements_are_present(self):
        columns = models.AuditLog.__table__.columns
        assert {"before_json", "after_json", "action", "correlation_id"} <= set(columns.keys())


class TestIndexes:
    def test_model_declares_exactly_three(self):
        """A fourth composite index under `action`/`source` would tax every
        INSERT on a growing table; at ~45 MB/year those stay heap filters. Same
        trade as ``test_only_the_composite_index_exists`` for the result audit."""
        actual = {
            index.name: tuple(column.name for column in index.columns) for index in models.AuditLog.__table__.indexes
        }
        assert actual == _INDEXES

    def test_every_index_trails_in_created_at(self):
        """``now()`` is the transaction start time, so ``id`` order is not time
        order: reads sort on ``created_at`` with ``id`` as a tiebreaker, and each
        index has to end in the sort column to serve them."""
        for columns in _INDEXES.values():
            assert columns[-1] == "created_at"

    def test_migration_creates_exactly_those_three(self):
        text = _text()
        assert text.count("op.create_index(") == len(_INDEXES)
        for name, columns in _INDEXES.items():
            assert f'"{name}"' in text
            rendered = "[" + ", ".join(f'"{column}"' for column in columns) + "]"
            assert rendered in text, f"{name} does not index {columns} in the revision"

    def test_downgrade_drops_all_three_and_the_table(self):
        text = _text()
        assert text.count("op.drop_index(") == len(_INDEXES)
        assert "op.drop_table(_TABLE)" in text


class TestPermissionBackfill:
    """``ensure_permission_catalog`` upserts the catalog row on boot but never
    writes ``auth.role_permissions``; its only writer runs on workspace creation,
    role assignment and member add -- not on deploy. Without the backfill every
    organizer of an existing workspace is refused on ``/admin/audit`` until
    somebody happens to add a member. Precedent: ``subperm0001``."""

    def test_seeded_permission_matches_the_catalog(self):
        module = _module()
        specs = {spec.name: spec for spec in PERMISSION_CATALOG}
        assert module._PERMISSION_NAME in specs, "the revision seeds a permission the catalog does not define"
        spec = specs[module._PERMISSION_NAME]
        assert module._PERMISSION_RESOURCE == spec.resource
        assert module._PERMISSION_ACTION == spec.action
        assert module._PERMISSION_DESCRIPTION == spec.description

    def test_the_admin_role_is_the_one_with_a_gap(self):
        """``owner`` holds the ``admin.*`` wildcard and needs no row; ``admin``
        is an enumerated list, so a new catalog entry has to be attached."""
        assert permission_names_for_workspace_role("owner") == ("admin.*",)
        assert "audit.read" in permission_names_for_workspace_role("admin")
        assert "audit.read" not in permission_names_for_workspace_role("member")
        assert "audit.read" not in permission_names_for_workspace_role("player")

    def test_the_grant_targets_workspace_admin_roles_only(self):
        text = _text()
        assert "INSERT INTO auth.role_permissions" in text
        assert "r.name = 'admin'" in text
        assert "r.workspace_id IS NOT NULL" in text

    def test_reruns_are_safe(self):
        """``auth.role_permissions`` has a surrogate ``id`` PK and no unique
        constraint on the pair, so ``ON CONFLICT DO NOTHING`` would never fire
        there -- the guard has to be ``NOT EXISTS``. The catalog row does have a
        unique ``name``, so it uses the conflict clause."""
        text = _text()
        assert "NOT EXISTS" in text
        assert "ON CONFLICT (name) DO NOTHING" in text

    def test_downgrade_removes_the_grant_and_the_permission(self):
        text = _text()
        assert "DELETE FROM auth.role_permissions" in text
        assert "DELETE FROM auth.permissions" in text
