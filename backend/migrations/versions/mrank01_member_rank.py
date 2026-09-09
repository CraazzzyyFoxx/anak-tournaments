"""Add ``balancer.member_rank`` and move every rank layer onto ``workspace_member``.

Revision ID: mrank01
Revises: mixperm01
Create Date: 2026-08-25 00:00:00.000000

Ranks used to live in three places keyed three different ways
(``workspace_player_rank``, ``host_player_rank``, and a per-game pin on
``custom_game_player``), anchored on a balancer-local player row that could
exist without a ``players.user``. This revision folds them into one table
anchored on ``workspace_member`` -- the same anchor registrations, teams, drafts
and achievements already use -- so identity dedup comes from
``uq_workspace_member_workspace_player`` plus the global user-merge instead of a
parallel merge implementation inside the balancer.

Reversible on purpose: the old tables are left in place and only dropped by
``mrank02``, so a deploy can be rolled back without resurrecting data.

Two data facts worth knowing before running this:

* **Ghosts get real players.** A ``workspace_player`` with no ``player_id`` is
  resolved to an existing ``players.user`` by the same two-pass BattleTag match
  the application uses (``find_users_by_battle_tags``: in-game name, then
  battlenet handle), and a bare player row is minted only when that finds
  nothing. The new rows carry no ``auth_user_id``, so nobody gains access.
* **Duplicate mappings are resolved, not rejected.** Two ``workspace_player``
  rows can map to one member (a ghost and a linked row that were never merged).
  Per role the later ``updated_at`` wins, ties go to the lower id -- the rule
  ``shared.domain.workspace_player.merge_ranks`` applied at runtime.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mrank01"
down_revision: str | Sequence[str] | None = "mixperm01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Mirrors shared.core.social.normalize_social_handle for battlenet: collapse the
# spacing around '#', drop remaining spaces, casefold.
_NORMALIZE = r"lower(replace(regexp_replace({col}, '\s*#\s*', '#', 'g'), ' ', ''))"


def upgrade() -> None:
    op.add_column("workspace_member", sa.Column("display_name", sa.String(length=255), nullable=True))

    op.create_table(
        "member_rank",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_member_id", sa.BigInteger(), nullable=False),
        sa.Column("author_user_id", sa.BigInteger(), nullable=True),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("rank_value", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_member_id"], ["workspace_member.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(op.f("ix_balancer_member_rank_workspace_id"), "member_rank", ["workspace_id"], schema="balancer")
    op.create_index(
        op.f("ix_balancer_member_rank_workspace_member_id"),
        "member_rank",
        ["workspace_member_id"],
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_member_rank_author_user_id"), "member_rank", ["author_user_id"], schema="balancer"
    )
    # Partial, because Postgres counts NULLs in a composite unique key as
    # distinct: a plain constraint would allow two canon rows per (member, role).
    op.create_index(
        "uq_member_rank_canon",
        "member_rank",
        ["workspace_id", "workspace_member_id", "role"],
        unique=True,
        schema="balancer",
        postgresql_where=sa.text("author_user_id IS NULL"),
    )
    op.create_index(
        "uq_member_rank_author",
        "member_rank",
        ["workspace_id", "author_user_id", "workspace_member_id", "role"],
        unique=True,
        schema="balancer",
        postgresql_where=sa.text("author_user_id IS NOT NULL"),
    )

    _provision_members()
    _backfill_ranks()
    _repoint_custom_game_player()


def _provision_members() -> None:
    """Every ``workspace_player`` gets a ``workspace_member`` to hang ranks on."""
    op.execute(
        sa.text(
            """
            INSERT INTO workspace_member (workspace_id, player_id)
            SELECT DISTINCT wp.workspace_id, wp.player_id
            FROM balancer.workspace_player wp
            WHERE wp.player_id IS NOT NULL
            ON CONFLICT ON CONSTRAINT uq_workspace_member_workspace_player DO NOTHING
            """
        )
    )

    # Ghosts: resolve the tag to an existing player the same two ways the
    # application does, in the same precedence (in-game name beats handle).
    op.execute(
        sa.text(
            f"""
            CREATE TEMP TABLE mrank01_ghost ON COMMIT DROP AS
            SELECT
                wp.id AS workspace_player_id,
                wp.workspace_id,
                wp.battle_tag,
                COALESCE(wp.battle_tag_normalized, {_NORMALIZE.format(col="wp.battle_tag")}) AS tag_key,
                COALESCE(
                    (
                        SELECT u.id FROM players."user" u
                        WHERE u.name = wp.battle_tag OR initcap(u.name) = wp.battle_tag
                        ORDER BY u.id LIMIT 1
                    ),
                    (
                        SELECT sa.user_id FROM players.social_account sa
                        WHERE sa.provider = 'battlenet'
                          AND (
                              sa.username_normalized = COALESCE(
                                  wp.battle_tag_normalized, {_NORMALIZE.format(col="wp.battle_tag")}
                              )
                              OR lower(split_part(sa.username, '#', 1)) = lower(wp.battle_tag)
                          )
                        ORDER BY sa.user_id LIMIT 1
                    )
                ) AS player_id
            FROM balancer.workspace_player wp
            WHERE wp.player_id IS NULL AND wp.battle_tag IS NOT NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO players."user" (name)
            SELECT DISTINCT g.battle_tag FROM mrank01_ghost g WHERE g.player_id IS NULL
            ON CONFLICT (name) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE mrank01_ghost g SET player_id = u.id
            FROM players."user" u
            WHERE g.player_id IS NULL AND u.name = g.battle_tag
            """
        )
    )
    # NOT EXISTS rather than ON CONFLICT: the guard must hold whatever unique
    # index social_account happens to carry.
    op.execute(
        sa.text(
            """
            INSERT INTO players.social_account (user_id, provider, username, username_normalized)
            SELECT DISTINCT g.player_id, 'battlenet', g.battle_tag, g.tag_key
            FROM mrank01_ghost g
            WHERE g.player_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM players.social_account sa
                  WHERE sa.user_id = g.player_id
                    AND sa.provider = 'battlenet'
                    AND sa.username_normalized = g.tag_key
              )
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO workspace_member (workspace_id, player_id)
            SELECT DISTINCT g.workspace_id, g.player_id
            FROM mrank01_ghost g
            WHERE g.player_id IS NOT NULL
            ON CONFLICT ON CONSTRAINT uq_workspace_member_workspace_player DO NOTHING
            """
        )
    )

    op.execute(
        sa.text(
            """
            CREATE TEMP TABLE mrank01_map ON COMMIT DROP AS
            SELECT wp.id AS workspace_player_id, wp.workspace_id, wm.id AS workspace_member_id
            FROM balancer.workspace_player wp
            LEFT JOIN mrank01_ghost g ON g.workspace_player_id = wp.id
            JOIN workspace_member wm
              ON wm.workspace_id = wp.workspace_id
             AND wm.player_id = COALESCE(wp.player_id, g.player_id)
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE workspace_member wm SET display_name = wp.display_name
            FROM balancer.workspace_player wp
            JOIN mrank01_map m ON m.workspace_player_id = wp.id
            WHERE wm.id = m.workspace_member_id
              AND wp.display_name IS NOT NULL
              AND wm.display_name IS NULL
            """
        )
    )


def _backfill_ranks() -> None:
    """Canon then author, deduplicated per target key by ``updated_at``."""
    op.execute(
        sa.text(
            """
            INSERT INTO balancer.member_rank
                (workspace_id, workspace_member_id, author_user_id, role, rank_value)
            SELECT DISTINCT ON (m.workspace_member_id, r.role)
                m.workspace_id, m.workspace_member_id, NULL, r.role, r.rank_value
            FROM balancer.workspace_player_rank r
            JOIN mrank01_map m ON m.workspace_player_id = r.workspace_player_id
            ORDER BY m.workspace_member_id, r.role, r.updated_at DESC NULLS LAST, r.id ASC
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO balancer.member_rank
                (workspace_id, workspace_member_id, author_user_id, role, rank_value)
            SELECT DISTINCT ON (m.workspace_member_id, hr.host_user_id, hr.role)
                m.workspace_id, m.workspace_member_id, hr.host_user_id, hr.role, hr.rank_value
            FROM balancer.host_player_rank hr
            JOIN mrank01_map m ON m.workspace_player_id = hr.workspace_player_id
            ORDER BY m.workspace_member_id, hr.host_user_id, hr.role,
                     hr.updated_at DESC NULLS LAST, hr.id ASC
            """
        )
    )


def _repoint_custom_game_player() -> None:
    """Mix rosters gain the member anchor, without losing the old one yet.

    The column stays NULLABLE and unconstrained here on purpose: between this
    revision and the code deploy, the running release still inserts roster rows
    with only ``workspace_player_id``, and a NOT NULL column with no default
    would reject every one of them. ``mrank02`` tightens it once the code that
    fills it is live -- that is the whole reason the drop is a separate revision.
    """
    op.add_column(
        "custom_game_player", sa.Column("workspace_member_id", sa.BigInteger(), nullable=True), schema="balancer"
    )
    op.execute(
        sa.text(
            """
            UPDATE balancer.custom_game_player cgp SET workspace_member_id = m.workspace_member_id
            FROM mrank01_map m WHERE m.workspace_player_id = cgp.workspace_player_id
            """
        )
    )
    op.create_foreign_key(
        "fk_balancer_custom_game_player_workspace_member_id",
        "custom_game_player",
        "workspace_member",
        ["workspace_member_id"],
        ["id"],
        source_schema="balancer",
        ondelete="CASCADE",
    )
    op.create_index(
        op.f("ix_balancer_custom_game_player_workspace_member_id"),
        "custom_game_player",
        ["workspace_member_id"],
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_balancer_custom_game_player_workspace_member_id"),
        table_name="custom_game_player",
        schema="balancer",
    )
    op.drop_constraint(
        "fk_balancer_custom_game_player_workspace_member_id",
        "custom_game_player",
        schema="balancer",
        type_="foreignkey",
    )
    op.drop_column("custom_game_player", "workspace_member_id", schema="balancer")

    op.drop_index("uq_member_rank_author", table_name="member_rank", schema="balancer")
    op.drop_index("uq_member_rank_canon", table_name="member_rank", schema="balancer")
    op.drop_index(op.f("ix_balancer_member_rank_author_user_id"), table_name="member_rank", schema="balancer")
    op.drop_index(op.f("ix_balancer_member_rank_workspace_member_id"), table_name="member_rank", schema="balancer")
    op.drop_index(op.f("ix_balancer_member_rank_workspace_id"), table_name="member_rank", schema="balancer")
    op.drop_table("member_rank", schema="balancer")

    op.drop_column("workspace_member", "display_name")
