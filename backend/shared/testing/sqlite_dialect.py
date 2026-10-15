"""SQLite dialect shims for Postgres-only column types.

Five suites need their models -- built with Postgres-specific ``JSONB``/
``ARRAY``/``BigInteger`` columns -- to run their DDL against a real (in-memory)
SQLite engine, for flush/cascade/query-shape tests that don't need a real
Postgres. Each used to register its own ``@compiles`` shim for the same three
types.

That is not just duplication: ``@compiles`` registers globally on the
SQLAlchemy type object the first time any of these modules is imported, so
five independent definitions are an import-order footgun -- whichever module
happens to import first "wins" and the other four silently become no-ops.
Calling :func:`install_postgres_type_shims` once, idempotently, from every
caller removes both the duplication and the footgun.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.sqlite import dialect as SQLiteDialect
from sqlalchemy.dialects.sqlite.base import JSON as SQLiteJSON
from sqlalchemy.ext.compiler import compiles

_installed = False


def install_postgres_type_shims() -> None:
    """Register SQLite ``@compiles`` shims for ``JSONB``/``ARRAY``/``BigInteger``.

    Idempotent -- safe to call from every test module that needs it,
    regardless of import order.
    """
    global _installed
    if _installed:
        return
    _installed = True
    # ARRAY's DDL shim is not enough once a Python list default is inserted.
    # Use SQLite's JSON processors for binding and reading those test values too.
    SQLiteDialect.colspecs = {**SQLiteDialect.colspecs, ARRAY: SQLiteJSON}

    @compiles(JSONB, "sqlite")
    def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
        return "JSON"

    @compiles(ARRAY, "sqlite")
    def _compile_array_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
        return "JSON"

    @compiles(sa.BigInteger, "sqlite")
    def _compile_bigint_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
        return "INTEGER"


def create_sqlite_tables(conn: sa.Connection, tables: Sequence[sa.Table]) -> None:
    """``CREATE`` ``tables`` on SQLite, for the suites that fake the database in memory.

    SQLite cannot spell four things the encounter layer uses: ``ON DELETE SET NULL
    (column)``, a partial unique index (it would build a plain one, and a retired
    seat beside its replacement would collide), a ``jsonb_typeof`` CHECK (the
    function does not exist) and a ``'[]'::jsonb`` server default (the cast is a
    syntax error). All four are left out of the DDL -- these suites exercise
    queries and flushes, not the constraints or the defaults. ``num_nonnulls`` (the
    encounter's owner CHECK) is a function SQLite lacks as well and goes the same way.
    """
    for table in tables:
        constraints = [
            constraint
            for constraint in table.constraints
            if (
                isinstance(constraint, sa.ForeignKeyConstraint) and (constraint.ondelete or "").startswith("SET NULL (")
            )
            or (
                isinstance(constraint, sa.CheckConstraint)
                and any(name in str(constraint.sqltext) for name in ("jsonb_typeof", "num_nonnulls"))
            )
        ]
        indexes = [index for index in table.indexes if index.dialect_options["postgresql"]["where"] is not None]
        pg_defaults = {
            column: column.server_default
            for column in table.columns
            if column.server_default is not None and "::" in str(getattr(column.server_default, "arg", ""))
        }
        table.constraints.difference_update(constraints)
        table.indexes.difference_update(indexes)
        for column in pg_defaults:
            column.server_default = None
        try:
            table.create(conn)
        finally:
            table.constraints.update(constraints)
            table.indexes.update(indexes)
            for column, default in pg_defaults.items():
                column.server_default = default
