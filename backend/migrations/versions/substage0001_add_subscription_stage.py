"""add registration_form.subscription_stage

WHEN a subscription requirement bites, now that it is a choice: at sign-up or at
check-in. ``require_subscription`` stays the on/off switch — exactly the shape
``require_open_profile`` + ``open_profile_scope`` already has in this table.

**The backfill is a deliberate LOOSENING, not a no-op.** Before this revision the
gate ran at both stages unconditionally, so every existing row behaved like
``registration``. They are backfilled to ``check_in`` instead: a roster is built at
check-in, that is where the answer matters, and refusing a sign-up months earlier
over a subscription the player can still buy turns a soft requirement into a hard
one. Any organizer who wants the stricter behaviour back sets the stage explicitly
on the form.

Concretely, at the time of writing exactly one row is affected (tournament 84,
workspace 6, the only form with ``require_subscription`` on), and the effect is
that its sign-up stops refusing. ``downgrade`` cannot restore the distinction
because the pre-revision schema has nowhere to put it — the column simply goes,
and every form is back to blocking at both stages.

Ordered EXPAND-only: adding a ``NOT NULL`` column with a server default is
backward compatible, so the old code (which never selects it) keeps working and
this can land before the services roll. Nothing to contract afterwards.

Revision ID: substage0001
Revises: roster0002
Create Date: 2026-08-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "substage0001"
down_revision: str | Sequence[str] | None = "roster0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Mirrors enums.SubscriptionEnforcementStage. Spelled out rather than imported:
# a migration must keep describing the schema it wrote even after the enum moves.
_CHECK_IN = "check_in"


def upgrade() -> None:
    op.add_column(
        "registration_form",
        sa.Column(
            "subscription_stage",
            sa.String(length=16),
            server_default=_CHECK_IN,
            nullable=False,
        ),
        schema="balancer",
    )
    # The server default already wrote `check_in` into every existing row; this is
    # only here to make the loosening explicit and to survive a future default change.
    op.execute(f"update balancer.registration_form set subscription_stage = '{_CHECK_IN}'")


def downgrade() -> None:
    op.drop_column("registration_form", "subscription_stage", schema="balancer")
