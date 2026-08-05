"""add workspace subscription requirement table

Creates ``subscriptions.requirement`` -- one ``default`` row per workspace holding
the rule ``{mode, requirements: [{provider, min_tier_rank}]}`` that until now lived
per tournament in ``balancer.registration_form.subscription_requirement_json``.

This is the EXPAND half of an expand/contract pair; the contract half (``wsreq0002``)
drops the form column. They are deliberately separate revisions because they need
opposite orderings relative to the code roll:

- create BEFORE the code roll -- the new ``load_requirement`` selects this table, so
  it must exist before any service that queries it starts;
- drop AFTER the code roll -- the old ORM still maps ``subscription_requirement_json``
  and SQLAlchemy emits every mapped column in every SELECT, so dropping it while the
  previous release is still serving would break every registration-form read.

The backfill elects one rule per workspace from the distinct non-empty blobs its
tournaments hold. When a workspace holds MORE than one distinct rule there is no
correct answer, so the migration aborts with the offending workspace ids rather than
picking one: silently choosing an admission rule would quietly change who may
register, which is exactly the failure this guard exists to prevent.

Revision ID: wsreq0001
Revises: wsguild0002
Create Date: 2026-08-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsreq0001"
down_revision: str | Sequence[str] | None = "wsguild0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "subscriptions"


def upgrade() -> None:
    # Column types mirror db.TimeStampIntegerMixin exactly: BigInteger pk,
    # created_at with a server default, updated_at nullable with NO server
    # default (the mixin sets it via onupdate).
    op.create_table(
        "requirement",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(64), nullable=False, server_default="default"),
        sa.Column("requirement_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_subscription_requirement_workspace_name"),
        schema=SCHEMA,
    )
    op.create_index(
        op.f("ix_subscriptions_requirement_workspace_id"),
        "requirement",
        ["workspace_id"],
        schema=SCHEMA,
    )
    # At most one default rule per workspace -- enforced in the database rather
    # than in the service, because the read path picks the default row blindly.
    op.create_index(
        "uq_subscription_requirement_one_default",
        "requirement",
        ["workspace_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
        schema=SCHEMA,
    )

    # The guard interrogates live data, so it only runs online: an offline
    # `--sql` render has no connection to query (`execute` returns None there),
    # and the DBA applying that script runs the same pre-flight query by hand.
    if not op.get_context().as_sql:
        conn = op.get_bind()
        ambiguous = conn.execute(
            sa.text(
                """
                select t.workspace_id, count(distinct f.subscription_requirement_json::text) as variants
                  from balancer.registration_form f
                  join tournament.tournament t on t.id = f.tournament_id
                 where coalesce(f.subscription_requirement_json::text, '{}') not in ('{}', 'null')
                 group by t.workspace_id
                having count(distinct f.subscription_requirement_json::text) > 1
                """
            )
        ).all()
        if ambiguous:
            raise RuntimeError(
                "Cannot elect a default subscription requirement for workspace(s) "
                f"{[row[0] for row in ambiguous]}: they hold more than one distinct rule. "
                "Resolve by hand (pick the intended rule per workspace) before migrating -- "
                "silently choosing an admission rule is exactly the failure this guard exists to prevent."
            )

    op.execute(
        """
        insert into subscriptions.requirement (workspace_id, name, requirement_json, is_default)
        select distinct t.workspace_id, 'default', f.subscription_requirement_json, true
          from balancer.registration_form f
          join tournament.tournament t on t.id = f.tournament_id
         where coalesce(f.subscription_requirement_json::text, '{}') not in ('{}', 'null')
        """
    )


def downgrade() -> None:
    # Nothing to restore: this is the expand half, so
    # balancer.registration_form.subscription_requirement_json still exists and
    # still holds the per-tournament rule the backfill copied from.
    op.drop_index("uq_subscription_requirement_one_default", "requirement", schema=SCHEMA)
    op.drop_index(op.f("ix_subscriptions_requirement_workspace_id"), "requirement", schema=SCHEMA)
    op.drop_table("requirement", schema=SCHEMA)
