"""Repoint admin-written encounter result audit actors at players.user.

``tournament.encounter_result_audit.actor_user_id`` is a FK to ``players.user``,
but the two admin RPCs (``encounter_set_result``, ``encounter_reopen_result``)
wrote the caller's ``auth.user`` id into it. The FK never complained -- both are
plain integer ids -- so the name join resolved to whichever unrelated player
happened to hold that number: "confirmed by craazzzyyfoxx" (auth 7) rendered as
"Hardstylerz#21775" (player 7).

Only ``source = 'admin'`` rows are affected: the captain paths already stored
the linked player id, and the Challonge/cascade paths store NULL. A row whose
auth id has no linked player becomes NULL (a machine actor) -- an unresolvable
actor is honest, a pointer at an unrelated player is not.

Revision ID: encactor1
Revises: apiscope1
Create Date: 2026-09-01 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "encactor1"
down_revision: str | Sequence[str] | None = "apiscope1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # One pass over a CTE, not two UPDATEs: after the first rewrite the converted
    # rows are indistinguishable from unconverted ones, so a follow-up "NULL the
    # leftovers" statement could not tell them apart.
    op.execute(
        sa.text(
            """
            WITH remapped AS (
                SELECT a.id, p.id AS player_id
                FROM tournament.encounter_result_audit a
                LEFT JOIN players."user" p ON p.auth_user_id = a.actor_user_id
                WHERE a.source = 'admin' AND a.actor_user_id IS NOT NULL
            )
            UPDATE tournament.encounter_result_audit a
            SET actor_user_id = r.player_id
            FROM remapped r
            WHERE a.id = r.id
            """
        )
    )


def downgrade() -> None:
    # Rows nulled above cannot be restored -- the auth id they held is gone.
    op.execute(
        sa.text(
            """
            WITH remapped AS (
                SELECT a.id, p.auth_user_id AS auth_id
                FROM tournament.encounter_result_audit a
                JOIN players."user" p ON p.id = a.actor_user_id
                WHERE a.source = 'admin' AND a.actor_user_id IS NOT NULL
            )
            UPDATE tournament.encounter_result_audit a
            SET actor_user_id = r.auth_id
            FROM remapped r
            WHERE a.id = r.id
            """
        )
    )
