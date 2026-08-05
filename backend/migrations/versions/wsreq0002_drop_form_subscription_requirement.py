"""drop the per-form subscription requirement (contract half)

The CONTRACT half of the pair started by ``wsreq0001``. That revision created
``subscriptions.requirement`` and backfilled one ``default`` row per workspace;
this one removes the column those rows were built from.

**Apply this only AFTER the services carrying the new code are running.** The old
``BalancerRegistrationForm`` maps ``subscription_requirement_json``, and SQLAlchemy
emits every mapped column in every ``SELECT``, so dropping it while old code is live
raises ``UndefinedColumn`` on every registration-form query -- the public form, the
admin builder and the check-in dialog alike. Symmetrically, ``wsreq0001`` must run
BEFORE the new code, which selects the new table. Neither ordering works for a single
combined revision, which is why there are two.

``downgrade`` restores the column and refills it from each tournament's workspace
default, so the pre-``wsreq0001`` code can run again. It is not perfectly
value-preserving: ``wsreq0001`` collapsed a workspace's rules to one, so a workspace
that somehow held several before would get the elected one back everywhere. In
practice ``wsreq0001`` refuses to run at all in that case, so the only way to reach
here is from a workspace that had exactly one rule -- for which the restore is exact.

Revision ID: wsreq0002
Revises: wsreq0001
Create Date: 2026-08-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsreq0002"
down_revision: str | Sequence[str] | None = "wsreq0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("registration_form", "subscription_requirement_json", schema="balancer")


def downgrade() -> None:
    # NOT NULL is restored via a server default, which stays: that is how the column
    # was originally declared in `subs0002`, so keeping it makes the schema identical
    # rather than merely similar.
    op.add_column(
        "registration_form",
        sa.Column("subscription_requirement_json", sa.JSON(), nullable=False, server_default="{}"),
        schema="balancer",
    )
    op.execute(
        """
        update balancer.registration_form f
           set subscription_requirement_json = r.requirement_json
          from tournament.tournament t
          join subscriptions.requirement r
            on r.workspace_id = t.workspace_id and r.is_default
         where t.id = f.tournament_id
        """
    )
