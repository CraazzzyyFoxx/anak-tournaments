"""Canonical match ingest (P5; D95, D96).

Sections, in order (a later task appends its own section to ``upgrade``):

1. ``catalog.alias_miss.kind`` accepts the six diagnostic kinds ``character|map|mode|stat|event|role``. Only the CHECK
   domain changes: rows, ``uq_alias_miss`` and the 128-char ``raw_name`` are untouched, and ``catalog.entity.kind``
   stays three-valued. The existing CHECK is found by relation and the column it constrains, never by its name.
2. ``tournament.tournament.logs_official BOOLEAN NOT NULL DEFAULT false`` (match-layer owner policy for accepting
   ingest evidence). Every existing tournament stays off; a constant default is a metadata-only add on PG 11+.
3. ``public.workspace_member.observed_only BOOLEAN NOT NULL DEFAULT false``: an anchor made by a stats observation is
   not a membership (hidden from token memberships, visibility and link-time role autofill) until a real admission.
   Every existing row is an admitted anchor (false).

Forward-fix only, consistent with P4's release.

Revision ID: ingest01
Revises: stats01a
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ingest01"
down_revision = "stats01a"
branch_labels = None
depends_on = None

ALIAS_MISS_KINDS = ("character", "map", "mode", "stat", "event", "role")

_KIND_CHECKS = """
    SELECT c.conname FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = CAST('catalog.alias_miss' AS regclass) AND c.contype = 'c' AND a.attname = 'kind'
     ORDER BY c.conname
"""


def _widen_alias_miss_kind() -> None:
    bind = op.get_bind()
    names = bind.execute(sa.text(_KIND_CHECKS)).scalars().all()
    if len(names) != 1:
        raise RuntimeError(f"ingest01 expected exactly one CHECK on catalog.alias_miss(kind), found {names}")
    domain = ", ".join(f"'{kind}'" for kind in ALIAS_MISS_KINDS)
    op.execute(sa.text("SET LOCAL lock_timeout = '3s'"))
    op.execute(f"ALTER TABLE catalog.alias_miss DROP CONSTRAINT {bind.dialect.identifier_preparer.quote(names[0])}")
    op.execute(f"ALTER TABLE catalog.alias_miss ADD CONSTRAINT ck_alias_miss_kind CHECK (kind IN ({domain}))")


def _add_logs_official() -> None:
    op.execute(sa.text("SET LOCAL lock_timeout = '3s'"))
    op.add_column(
        "tournament",
        sa.Column("logs_official", sa.Boolean(), server_default="false", nullable=False),
        schema="tournament",
    )


def _add_observed_only() -> None:
    op.execute(sa.text("SET LOCAL lock_timeout = '3s'"))
    op.add_column("workspace_member", sa.Column("observed_only", sa.Boolean(), server_default="false", nullable=False))


def upgrade() -> None:
    _widen_alias_miss_kind()
    _add_logs_official()
    _add_observed_only()


def downgrade() -> None:
    raise RuntimeError("ingest01 is forward-fix-only; restore the pre-upgrade backup to reverse it")
