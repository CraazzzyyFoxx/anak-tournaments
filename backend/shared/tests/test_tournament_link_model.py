"""Pin the DDL and metadata ``TournamentLink`` compiles to.

Every property asserted here is a decision, not a SQLAlchemy default:

* the table lives in the ``tournament`` schema (a schema-less migration would
  target ``public.tournament_link`` and silently create a second table);
* ``kind`` is ``VARCHAR(32)``, not a PG enum, so adding a link kind is a change
  to ``TOURNAMENT_LINK_KINDS`` alone and never a migration — which only holds
  while every value in that set still fits the column;
* ``(tournament_id, kind, url)`` is unique, so the admin CRUD can report a 409
  from an explicit pre-check and Postgres backs it up;
* the FK CASCADEs, so deleting a tournament leaves no orphan links behind;
* ``sort_order``/``is_active`` carry server defaults, so rows inserted outside
  the ORM (migrations, backfills, psql) land active and orderable.

This is a metadata check, not a substitute for applying the schema: run
``alembic upgrade heads`` against a real database too.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models
from shared.models.tournament.link import TOURNAMENT_LINK_KINDS

TABLE = models.TournamentLink.__table__


def _ddl() -> str:
    return str(CreateTable(TABLE).compile(dialect=postgresql.dialect()))


class TestPlacement:
    def test_lives_in_the_tournament_schema(self):
        assert TABLE.schema == "tournament"

    def test_table_name(self):
        assert TABLE.name == "tournament_link"

    def test_exported_from_the_models_aggregator(self):
        """Wave-2 consumers import it as ``from shared.models import TournamentLink``."""
        assert models.TournamentLink is not None
        assert models.TournamentLink.__table__ is TABLE


class TestKindVocabulary:
    def test_kind_is_free_text_not_a_pg_enum(self):
        """A PG enum would turn every new link kind into a migration."""
        assert "kind VARCHAR(32) NOT NULL" in _ddl()

    def test_every_known_kind_fits_the_column(self):
        length = TABLE.columns["kind"].type.length
        assert length is not None
        assert max(len(kind) for kind in TOURNAMENT_LINK_KINDS) <= length

    def test_the_vocabulary_is_the_documented_one(self):
        assert TOURNAMENT_LINK_KINDS == frozenset({"discord", "stream", "vod", "bracket", "rules", "other"})


class TestConstraints:
    def test_unique_on_tournament_kind_url(self):
        unique = {
            constraint.name: [column.name for column in constraint.columns]
            for constraint in TABLE.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        }
        assert unique["uq_tournament_link_tournament_kind_url"] == ["tournament_id", "kind", "url"]

    def test_composite_lookup_index(self):
        indexes = {index.name: [column.name for column in index.columns] for index in TABLE.indexes}
        assert indexes["ix_tournament_link_tournament_active"] == ["tournament_id", "is_active"]

    def test_tournament_fk_cascades(self):
        (fk,) = TABLE.columns["tournament_id"].foreign_keys
        assert fk.target_fullname == "tournament.tournament.id"
        assert fk.ondelete == "CASCADE"


class TestColumnDefaults:
    def test_sort_order_defaults_to_zero_in_the_database(self):
        assert str(TABLE.columns["sort_order"].server_default.arg) == "0"
        assert "sort_order INTEGER DEFAULT '0' NOT NULL" in _ddl()

    def test_is_active_defaults_to_true_in_the_database(self):
        assert str(TABLE.columns["is_active"].server_default.arg) == "true"
        assert "is_active BOOLEAN DEFAULT 'true' NOT NULL" in _ddl()

    def test_label_is_the_only_nullable_payload_column(self):
        nullable = {name for name, column in TABLE.columns.items() if column.nullable}
        # ``updated_at`` comes from db.TimeStampIntegerMixin (set via onupdate).
        assert nullable == {"label", "updated_at"}

    def test_url_is_long_enough_for_a_real_link(self):
        assert "url VARCHAR(500) NOT NULL" in _ddl()
