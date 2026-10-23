"""Disposable native-only PostgreSQL roles for stats01 scratch-database proofs."""

from __future__ import annotations

from contextlib import contextmanager
from uuid import uuid4

import sqlalchemy as sa


@contextmanager
def native_role(database_url, *, write: bool = False):
    """Yield a non-owner role; callers use SET LOCAL ROLE inside their own transaction."""
    engine = sa.create_engine(database_url, poolclass=sa.pool.NullPool)
    role = f"p4_native_{uuid4().hex}"
    created = False
    try:
        with engine.begin() as conn:
            if not conn.scalar(sa.text("SELECT current_database()")).startswith("p4_stats01_"):
                raise ValueError("native access proofs require an owned stats01 scratch database")
            schemas = (
                conn.execute(
                    sa.text(
                        "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'"
                        " ORDER BY nspname"
                    )
                )
                .scalars()
                .all()
            )
            conn.execute(sa.text(f'CREATE ROLE "{role}" NOLOGIN NOSUPERUSER NOINHERIT'))
            quote = conn.dialect.identifier_preparer.quote
            for schema in schemas:
                name = quote(schema)
                conn.execute(sa.text(f'GRANT USAGE ON SCHEMA {name} TO "{role}"'))
                privileges = "SELECT, INSERT, UPDATE, DELETE" if write else "SELECT"
                conn.execute(sa.text(f'GRANT {privileges} ON ALL TABLES IN SCHEMA {name} TO "{role}"'))
                if write:
                    conn.execute(sa.text(f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {name} TO "{role}"'))
        created = True
        yield role
    finally:
        try:
            if created:
                with engine.begin() as conn:
                    conn.execute(sa.text(f'DROP OWNED BY "{role}"'))
                    conn.execute(sa.text(f'DROP ROLE "{role}"'))
        finally:
            engine.dispose()
