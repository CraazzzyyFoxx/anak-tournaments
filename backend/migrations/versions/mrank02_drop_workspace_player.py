"""Drop the balancer-local player registry and the rank tables it anchored.

Revision ID: mrank02
Revises: mrank01
Create Date: 2026-08-25 00:00:00.000000

Everything here was made redundant by ``mrank01``:

* ``workspace_player`` / ``workspace_player_rank`` -- a second player identity
  per workspace, and the canon ranks hanging off it. Both now live on
  ``workspace_member`` / ``member_rank``.
* ``host_player_rank`` -- the per-host rank book, now the ``author_user_id``
  layer of ``member_rank``.
* ``host_player`` -- a per-host subset of the roster that never got a UI: its
  only reader was the ``player_ids IS NULL`` branch of mix creation, which the
  client never took.
* ``custom_game_player.rank_value`` -- the per-game rank pin. A correction now
  goes into the host's own book, so it carries to their next mix instead of
  being forgotten with the game. Existing pins are **not** migrated into that
  book: silently overwriting a number the host set deliberately is worse than
  losing an in-flight override.
* ``registration.workspace_player_id`` -- the second identity anchor on a
  registration; ``workspace_member_id`` is the only one left.

Deliberately irreversible: the rows are gone, and recreating empty tables would
be a rollback that silently loses every rank. Roll back to ``mrank01`` instead --
it leaves all source data intact.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mrank02"
down_revision: str | Sequence[str] | None = "mrank01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tighten_custom_game_player() -> None:
    """Make the member anchor mandatory, now that the live code fills it.

    ``mrank01`` left the column nullable so the previous release could keep
    inserting roster rows through the deploy window. Anything still unmapped
    here belongs to a ``workspace_player`` with neither a tag nor a player --
    no identity to carry forward -- and two rows of one game collapsing onto one
    member keeps the lower id, the alternative being a failed constraint below.
    """
    op.execute(sa.text("DELETE FROM balancer.custom_game_player WHERE workspace_member_id IS NULL"))
    op.execute(
        sa.text(
            """
            DELETE FROM balancer.custom_game_player a
            USING balancer.custom_game_player b
            WHERE a.custom_game_id = b.custom_game_id
              AND a.workspace_member_id = b.workspace_member_id
              AND a.id > b.id
            """
        )
    )
    op.alter_column("custom_game_player", "workspace_member_id", nullable=False, schema="balancer")
    op.create_unique_constraint(
        "uq_custom_game_player_member",
        "custom_game_player",
        ["custom_game_id", "workspace_member_id"],
        schema="balancer",
    )


def upgrade() -> None:
    _tighten_custom_game_player()
    op.drop_constraint("uq_custom_game_player", "custom_game_player", schema="balancer", type_="unique")
    op.drop_index(
        op.f("ix_balancer_custom_game_player_workspace_player_id"),
        table_name="custom_game_player",
        schema="balancer",
    )
    op.drop_column("custom_game_player", "workspace_player_id", schema="balancer")
    op.drop_column("custom_game_player", "rank_value", schema="balancer")

    op.drop_constraint(
        "fk_balancer_registration_workspace_player_id", "registration", schema="balancer", type_="foreignkey"
    )
    op.drop_index(op.f("ix_balancer_registration_workspace_player_id"), table_name="registration", schema="balancer")
    op.drop_column("registration", "workspace_player_id", schema="balancer")

    op.drop_table("host_player_rank", schema="balancer")
    op.drop_table("host_player", schema="balancer")
    op.drop_table("workspace_player_rank", schema="balancer")
    op.drop_table("workspace_player", schema="balancer")


def downgrade() -> None:
    raise NotImplementedError(
        "mrank02 drops the source of every rank it replaced; roll back to mrank01, "
        "which leaves workspace_player and both rank books intact."
    )
