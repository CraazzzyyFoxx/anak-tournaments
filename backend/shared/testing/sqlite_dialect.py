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

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
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

    @compiles(JSONB, "sqlite")
    def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
        return "JSON"

    @compiles(ARRAY, "sqlite")
    def _compile_array_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
        return "JSON"

    @compiles(sa.BigInteger, "sqlite")
    def _compile_bigint_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
        return "INTEGER"
