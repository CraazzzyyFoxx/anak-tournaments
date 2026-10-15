"""Ranks and hidden ratings by role (V3 P3; D32, D87, spec §8.5, §14.3, §14.5, §14.6).

Every rank is held on a role of its discipline's rated dimension: ``balancer.member_rank`` and
``balancer.member_hidden_rating`` get ``role_id`` (every existing row is Overwatch's), their unique keys move to it, and
``flex`` rows -- flex is no role (D86) -- are dropped and kept in ``balancer.discipline01c_dropped_ranks`` for the
reconcile. The legacy ``role`` columns stay until the gated ``discipline02``. Forward-fix only.

Revision ID: discipline01c
Revises: discipline01b
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "discipline01c"
down_revision: str | Sequence[str] | None = "discipline01b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINTS_ON = """
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = CAST(:table AS regclass) AND c.contype = :contype
       AND (:contype = 'p' OR
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                   ORDER BY k.ord) = CAST(:columns AS text[]))
     ORDER BY c.conname
"""
#: Unique indexes that back no constraint (the partial rank keys), by their column list.
_UNIQUE_INDEXES_ON = """
    SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
     WHERE x.indrelid = CAST(:table AS regclass) AND x.indisunique AND NOT x.indisprimary
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)
       AND ARRAY(SELECT a.attname::text FROM unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
                  ORDER BY k.ord) = CAST(:columns AS text[])
     ORDER BY i.relname
"""


def _name(query: str, kind: str, table: str, columns: Sequence[str], **extra: str) -> str:
    bind = op.get_bind()
    names = bind.execute(sa.text(query), {"table": table, "columns": list(columns), **extra}).scalars().all()
    if len(names) != 1:
        raise RuntimeError(f"discipline01c expected exactly one {kind} on {table}{tuple(columns)}, found {names}")
    return bind.dialect.identifier_preparer.quote(names[0])


def _drop_constraint(table: str, columns: Sequence[str], contype: str):
    def run() -> None:
        op.execute(
            f"ALTER TABLE {table} DROP CONSTRAINT {_name(_CONSTRAINTS_ON, contype, table, columns, contype=contype)}"
        )

    return run


def _drop_unique_index(table: str, columns: Sequence[str]):
    schema = table.split(".")[0]

    def run() -> None:
        op.execute(f"DROP INDEX {schema}.{_name(_UNIQUE_INDEXES_ON, 'unique index', table, columns)}")

    return run


#: Questions the data must answer before anything moves; a non-empty answer stops the revision (spec §14.5).
#: Numbered after discipline01b's in backend/scripts/discipline01_preflight.sql, text for text
#: (tests/test_discipline01_preflight_sql.py).
PREFLIGHT: tuple[tuple[str, str], ...] = (
    (
        "member ranks that collide once their role is normalized",
        """
        SELECT m.workspace_id, m.author_user_id, m.workspace_member_id, lower(btrim(m.role)) AS role, count(*) AS row_count
          FROM balancer.member_rank m
         GROUP BY m.workspace_id, m.author_user_id, m.workspace_member_id, lower(btrim(m.role))
        HAVING count(*) > 1
         ORDER BY m.workspace_id, m.author_user_id, m.workspace_member_id, lower(btrim(m.role))
        """,
    ),
    (
        "hidden ratings that collide once their role is normalized",
        """
        SELECT h.workspace_member_id, lower(btrim(h.role)) AS role, count(*) AS row_count
          FROM balancer.member_hidden_rating h
         GROUP BY h.workspace_member_id, lower(btrim(h.role))
        HAVING count(*) > 1
         ORDER BY h.workspace_member_id, lower(btrim(h.role))
        """,
    ),
)
PREFLIGHT_SAMPLE = 20

#: Not a stop (spec §14.6): flex is no role (D86); these rows are dropped and listed by the reconcile.
FLEX_RANKS = """
SELECT count(*) AS flex_ranks_dropped
  FROM (SELECT 1 FROM balancer.member_rank m WHERE lower(btrim(m.role)) = 'flex'
        UNION ALL
        SELECT 1 FROM balancer.member_hidden_rating h WHERE lower(btrim(h.role)) = 'flex') f
"""


def _preflight() -> None:
    bind = op.get_bind()
    failures: list[str] = []
    for question, query in PREFLIGHT:
        rows = bind.execute(sa.text(query)).mappings().all()
        if rows:
            sample = "; ".join(str(dict(row)) for row in rows[:PREFLIGHT_SAMPLE])
            rest = len(rows) - PREFLIGHT_SAMPLE
            failures.append(f"{question} [{len(rows)}]: {sample}" + (f"; … {rest} more" if rest > 0 else ""))
    if failures:
        raise RuntimeError("discipline01c pre-flight failed; resolve these rows by hand first:\n" + "\n".join(failures))


def _carry_roles(table: str) -> tuple[str, ...]:
    """The Overwatch module role each legacy code names: every rank written before this release is Overwatch's."""
    return (
        f"ALTER TABLE {table} ADD COLUMN dimension_id BIGINT, ADD COLUMN role_id BIGINT",
        f"""
        UPDATE {table} x
           SET role_id = r.id, dimension_id = r.dimension_id
          FROM catalog.role r JOIN catalog.role_dimension d ON d.id = r.dimension_id
         WHERE d.discipline = 'overwatch' AND d.rated AND r.workspace_id IS NULL AND r.code = lower(btrim(x.role))
        """,
    )


_DROP_FLEX = (
    """
    CREATE TABLE balancer.discipline01c_dropped_ranks (
      source   VARCHAR(64) NOT NULL,
      row_id   BIGINT NOT NULL,
      row_json JSONB NOT NULL,
      PRIMARY KEY (source, row_id)
    )
    """,
    """
    INSERT INTO balancer.discipline01c_dropped_ranks (source, row_id, row_json)
    SELECT 'balancer.member_rank', m.id, to_jsonb(m) FROM balancer.member_rank m WHERE lower(btrim(m.role)) = 'flex'
    UNION ALL
    SELECT 'balancer.member_hidden_rating', h.id, to_jsonb(h)
      FROM balancer.member_hidden_rating h WHERE lower(btrim(h.role)) = 'flex'
    """,
    "DELETE FROM balancer.member_rank WHERE lower(btrim(role)) = 'flex'",
    "DELETE FROM balancer.member_hidden_rating WHERE lower(btrim(role)) = 'flex'",
)

_MEMBER_RANKS = (
    *_carry_roles("balancer.member_rank"),
    _drop_unique_index("balancer.member_rank", ("workspace_id", "workspace_member_id", "role")),
    _drop_unique_index("balancer.member_rank", ("workspace_id", "author_user_id", "workspace_member_id", "role")),
    """
    ALTER TABLE balancer.member_rank
      ALTER COLUMN role DROP NOT NULL,
      ALTER COLUMN dimension_id SET NOT NULL,
      ALTER COLUMN role_id SET NOT NULL,
      ADD CONSTRAINT fk_member_rank_role FOREIGN KEY (role_id, dimension_id) REFERENCES catalog.role (id, dimension_id)
      DEFERRABLE INITIALLY DEFERRED
    """,
    """
    CREATE UNIQUE INDEX uq_member_rank_canon_role ON balancer.member_rank (workspace_id, workspace_member_id, role_id)
     WHERE author_user_id IS NULL
    """,
    """
    CREATE UNIQUE INDEX uq_member_rank_author_role
        ON balancer.member_rank (workspace_id, author_user_id, workspace_member_id, role_id)
     WHERE author_user_id IS NOT NULL
    """,
)

_HIDDEN_RATINGS = (
    *_carry_roles("balancer.member_hidden_rating"),
    _drop_constraint("balancer.member_hidden_rating", ("workspace_member_id", "role"), "u"),
    """
    ALTER TABLE balancer.member_hidden_rating
      ALTER COLUMN role DROP NOT NULL,
      ALTER COLUMN dimension_id SET NOT NULL,
      ALTER COLUMN role_id SET NOT NULL,
      ADD CONSTRAINT uq_member_hidden_rating_member_role_id UNIQUE (workspace_member_id, role_id),
      ADD CONSTRAINT fk_member_hidden_rating_role FOREIGN KEY (role_id, dimension_id)
        REFERENCES catalog.role (id, dimension_id) DEFERRABLE INITIALLY DEFERRED
    """,
)


def upgrade() -> None:
    # discipline01b ran in this same transaction and leaves RI events pending on tables it altered.
    op.execute("SET CONSTRAINTS ALL IMMEDIATE")
    _preflight()
    for statement in (*_DROP_FLEX, *_MEMBER_RANKS, *_HIDDEN_RATINGS):
        if callable(statement):
            statement()
        else:
            op.execute(statement)
    # Leading indexes on the new FK columns into catalog.role, as discipline01b gives every assignment table.
    for table in ("member_rank", "member_hidden_rating"):
        op.create_index(f"ix_balancer_{table}_role_id", table, ["role_id"], schema="balancer")
    immediate = (
        op.get_bind()
        .execute(
            sa.text("SELECT conrelid::regclass, conname FROM pg_constraint WHERE condeferrable AND NOT condeferred")
        )
        .all()
    )
    if immediate:
        raise RuntimeError(f"discipline01c cannot restore INITIALLY IMMEDIATE constraints: {immediate}")
    op.execute("SET CONSTRAINTS ALL DEFERRED")


def downgrade() -> None:
    raise RuntimeError("discipline01c is forward-fix only; restore from a backup to go back")
