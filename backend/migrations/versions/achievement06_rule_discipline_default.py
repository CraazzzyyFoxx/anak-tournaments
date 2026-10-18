"""Achievement rules name their discipline explicitly (P6).

``achievements.rule.discipline`` was added by ``discipline01`` with ``DEFAULT 'overwatch'`` so existing rows and the
pre-multi-game writers kept working. Every writer now passes the discipline, so the default would only turn a forgotten
one into a silent Overwatch rule. Dropping it makes such an insert fail on NOT NULL instead.

Only the server default changes: the column stays NOT NULL, ``fk_rule_discipline``, ``fk_rule_entity``, every id and
every stored value are untouched. Nothing is backfilled and no column is created.

Revision ID: achievement06
Revises: ingest01
"""

from __future__ import annotations

from alembic import op

revision = "achievement06"
down_revision = "ingest01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("rule", "discipline", schema="achievements", server_default=None)


def downgrade() -> None:
    raise RuntimeError("achievement06 is forward-fix-only; restoring the implicit Overwatch default is not a reversal")
