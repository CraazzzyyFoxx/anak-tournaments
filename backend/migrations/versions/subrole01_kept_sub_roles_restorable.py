"""Make the sub-roles ``discipline01b`` kept from player data ordinary, restorable sub-roles.

Revision ID: subrole01
Revises: discordmsg03
Create Date: 2026-10-22 00:00:00.000000

``discipline01b`` turned every sub-role value players and registrations used,
but the workspace catalog did not list, into a workspace sub-role: inactive,
not selectable, and described by a provenance note ("Kept by discipline01b:
...") in ``description`` -- the field the sub-role admin shows its organizers.

The note is migration bookkeeping, not a description, so it goes. And
``selectable = false`` is a second off-switch the sub-role admin has no
control for: restoring such a sub-role set ``active`` and left it out of every
picker anyway. Workspace sub-roles have one switch, ``active``; every one of
them becomes selectable (``discipline01b`` was the only writer of ``false``),
which changes nothing while they stay inactive.

Irreversible by design: the note and the flag described the migration, not
the sub-roles, so ``downgrade`` is a no-op rather than a fabricated one.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "subrole01"
down_revision: str | Sequence[str] | None = "discordmsg03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KEPT_NOTE = "Kept by discipline01b: used by players or registrations, absent from the workspace sub-role catalog."


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE catalog.role
           SET selectable = true,
               description = CASE WHEN description = '{KEPT_NOTE}' THEN NULL ELSE description END
         WHERE workspace_id IS NOT NULL
           AND parent_id IS NOT NULL
           AND (NOT selectable OR description = '{KEPT_NOTE}')
        """
    )


def downgrade() -> None:
    """No-op: see the module docstring."""
