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

``downgrade`` restores the column at its ``{}`` server default and stops there. It
does NOT refill it: per-form rules are NOT recoverable by this revision and must be
re-entered by hand. An earlier version copied the workspace's elected rule onto every
form in that workspace, which is worse than doing nothing -- a form that held ``{}``
or the empty-but-present ``{"mode": "all", "requirements": []}`` while
``require_subscription`` was on was a documented no-op, and refilling it would arm a
real rule on a tournament that never had one, so a rollback would start refusing
check-ins for players it used to admit. On the production shape that is the majority
of forms. Between a rollback that wrongly refuses players mid-event and one that
admits too many, this codebase consistently prefers the latter.

Nothing is lost: the elected rule still lives in ``subscriptions.requirement`` (this
revision does not drop that table -- ``wsreq0001``'s downgrade does), so an operator
who needs the old per-form behaviour back can copy it onto the specific forms that
genuinely had it.

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
    # rather than merely similar. Every row therefore comes back as `{}` -- the
    # no-rule value. Deliberately no refill: see the docstring. Copying the
    # workspace's elected rule onto every form would arm tournaments that never had a
    # rule and make a rollback refuse check-ins it previously allowed.
    op.add_column(
        "registration_form",
        sa.Column("subscription_requirement_json", sa.JSON(), nullable=False, server_default="{}"),
        schema="balancer",
    )
