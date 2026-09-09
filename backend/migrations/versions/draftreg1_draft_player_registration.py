"""Anchor a draft player on its registration and delete the roles/ranks snapshot.

Revision ID: draftreg1
Revises: tcover01
Create Date: 2026-09-04 00:00:00.000000

``balancer.draft_player`` used to carry its own copy of the player's roles and
ranks (``primary_role``, ``sub_role``, ``is_flex``, ``division_number``,
``rank_value``, plus the ``draft_player_role`` / ``draft_player_role_hero``
child tables), written once at seed time from the RAW
``balancer.registration_role.rank_value`` column. The balancer resolves that
same rank through three layers (registration -> workspace canon -> Overwatch
snapshot), so a player ranked only through the canon or a snapshot was fully
ranked in the balancer and blank in the draft -- and even when the seed was
correct, nothing ever re-synced it afterwards.

This revision removes the copy. A draft player becomes a reference to the
registration plus its draft state (``status``, ``is_captain``,
``drafted_by_team_id``), and roles/ranks are resolved live by the one engine,
``shared.services.roster``. The single derivation left in the schema is
``draft_pick.target_role`` / ``target_rank_value``, which is a historical fact
about a completed pick, not a cache.

Two data facts before running this:

* **Backfill is identity-first.** ``registration_id`` is matched on
  ``workspace_member_id`` within the session's tournament, then on
  ``battle_tag_normalized``. Verified against production: 1768 draft players
  across 20 sessions, 0 unmatched.
* **It fails loudly, never silently.** An unmatched row in a session that is
  still ``setup``/``ready``/``live``/``paused`` aborts the migration -- that
  draft must be re-seeded, because a live pool with an unresolvable player has
  no roles to draft on. Unmatched rows in ``completed``/``cancelled`` sessions
  are deleted; their picks keep the frozen ``(role, rank)`` and lose only the
  player link (``picked_player_id`` is already ``ON DELETE SET NULL``).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "draftreg1"
down_revision: str | Sequence[str] | None = "tcover01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACTIVE_STATUSES = ("setup", "ready", "live", "paused")


def upgrade() -> None:
    op.add_column(
        "draft_player",
        sa.Column("registration_id", sa.Integer(), nullable=True),
        schema="balancer",
    )
    _backfill_by_member()
    _backfill_by_battle_tag()
    _resolve_unmatched()

    op.create_foreign_key(
        "fk_draft_player_registration",
        "draft_player",
        "registration",
        ["registration_id"],
        ["id"],
        source_schema="balancer",
        referent_schema="balancer",
        # RESTRICT, not CASCADE: a registration is soft-deleted (``deleted_at``),
        # so a hard delete here would mean somebody is erasing a row a draft
        # depends on. Refuse rather than silently drop draft history.
        ondelete="RESTRICT",
    )
    op.alter_column("draft_player", "registration_id", nullable=False, schema="balancer")
    op.drop_constraint("uq_draft_player_session_member", "draft_player", schema="balancer", type_="unique")
    op.create_unique_constraint(
        "uq_draft_player_session_registration",
        "draft_player",
        ["session_id", "registration_id"],
        schema="balancer",
    )

    op.drop_table("draft_player_role_hero", schema="balancer")
    op.drop_table("draft_player_role", schema="balancer")
    for column in (
        "primary_role",
        "sub_role",
        "is_flex",
        "division_number",
        "rank_value",
        "battle_tag",
        "additional_info",
    ):
        op.drop_column("draft_player", column, schema="balancer")


def _backfill_by_member() -> None:
    """The member anchor is the exact one: a live registration is unique per
    (tournament, member).

    A correlated scalar subquery, not a joined ``FROM``: Postgres will not let a
    ``FROM`` item (nor a ``LATERAL`` one) reference the UPDATE target, because
    the target is not part of that ``FROM`` list. The ``ORDER BY`` matters --
    ``uq_balancer_registration_user`` is partial (``deleted_at IS NULL``), so a
    member can own both a soft-deleted and a live registration; prefer the live
    one, then the lower id, so a re-run picks the same row.
    """
    op.execute(
        sa.text(
            """
            UPDATE balancer.draft_player AS dp
               SET registration_id = (
                     SELECT reg.id
                       FROM balancer.registration AS reg
                       JOIN balancer.draft_session AS ds ON ds.id = dp.session_id
                      WHERE reg.tournament_id = ds.tournament_id
                        AND reg.workspace_member_id = dp.workspace_member_id
                      ORDER BY reg.deleted_at NULLS FIRST, reg.id
                      LIMIT 1
                   )
             WHERE dp.registration_id IS NULL
               AND dp.workspace_member_id IS NOT NULL
               AND EXISTS (
                     SELECT 1
                       FROM balancer.registration AS reg
                       JOIN balancer.draft_session AS ds ON ds.id = dp.session_id
                      WHERE reg.tournament_id = ds.tournament_id
                        AND reg.workspace_member_id = dp.workspace_member_id
                   )
            """
        )
    )


def _backfill_by_battle_tag() -> None:
    """Fallback for pool players seeded without a member (sheet rows, manual adds).

    Same correlated shape and the same reason as :func:`_backfill_by_member`.
    The expression mirrors ``shared.core.social.normalize_social_handle`` for
    battlenet: collapse the spacing around '#', drop remaining spaces, casefold.
    """
    op.execute(
        sa.text(
            """
            UPDATE balancer.draft_player AS dp
               SET registration_id = (
                     SELECT reg.id
                       FROM balancer.registration AS reg
                       JOIN balancer.draft_session AS ds ON ds.id = dp.session_id
                      WHERE reg.tournament_id = ds.tournament_id
                        AND reg.battle_tag_normalized IS NOT NULL
                        AND reg.battle_tag_normalized
                            = lower(replace(regexp_replace(dp.battle_tag, '\\s*#\\s*', '#', 'g'), ' ', ''))
                      ORDER BY reg.deleted_at NULLS FIRST, reg.id
                      LIMIT 1
                   )
             WHERE dp.registration_id IS NULL
               AND dp.battle_tag IS NOT NULL
               AND EXISTS (
                     SELECT 1
                       FROM balancer.registration AS reg
                       JOIN balancer.draft_session AS ds ON ds.id = dp.session_id
                      WHERE reg.tournament_id = ds.tournament_id
                        AND reg.battle_tag_normalized IS NOT NULL
                        AND reg.battle_tag_normalized
                            = lower(replace(regexp_replace(dp.battle_tag, '\\s*#\\s*', '#', 'g'), ' ', ''))
                   )
            """
        )
    )


def _resolve_unmatched() -> None:
    """Abort on a live session, prune a finished one. Never leave a NULL behind."""
    connection = op.get_bind()
    blocking = connection.execute(
        sa.text(
            """
            SELECT ds.id AS session_id, ds.status, count(*) AS players
              FROM balancer.draft_player AS dp
              JOIN balancer.draft_session AS ds ON ds.id = dp.session_id
             WHERE dp.registration_id IS NULL
               AND ds.status = ANY(:statuses)
             GROUP BY ds.id, ds.status
             ORDER BY ds.id
            """
        ),
        {"statuses": list(_ACTIVE_STATUSES)},
    ).all()
    if blocking:
        detail = ", ".join(f"session {row.session_id} ({row.status}): {row.players} players" for row in blocking)
        raise RuntimeError(
            "draftreg1: cannot anchor these draft players on a registration -- "
            f"{detail}. Re-seed those drafts from the balancer pool, then re-run."
        )
    op.execute(sa.text("DELETE FROM balancer.draft_player WHERE registration_id IS NULL"))


def downgrade() -> None:
    op.add_column("draft_player", sa.Column("primary_role", sa.String(length=16), nullable=True), schema="balancer")
    op.add_column("draft_player", sa.Column("sub_role", sa.String(length=128), nullable=True), schema="balancer")
    op.add_column(
        "draft_player",
        sa.Column("is_flex", sa.Boolean(), nullable=False, server_default="false"),
        schema="balancer",
    )
    op.add_column("draft_player", sa.Column("division_number", sa.Integer(), nullable=True), schema="balancer")
    op.add_column("draft_player", sa.Column("rank_value", sa.Integer(), nullable=True), schema="balancer")
    op.add_column("draft_player", sa.Column("battle_tag", sa.String(length=255), nullable=True), schema="balancer")
    op.add_column(
        "draft_player",
        sa.Column("additional_info", sa.JSON(), nullable=False, server_default="{}"),
        schema="balancer",
    )
    # Roles/ranks are recoverable only by re-seeding: the raw snapshot they came
    # from was the bug. Identity is restored so a rollback leaves readable rows.
    op.execute(
        sa.text(
            """
            UPDATE balancer.draft_player AS dp
               SET battle_tag = reg.battle_tag,
                   primary_role = 'dps'
              FROM balancer.registration AS reg
             WHERE reg.id = dp.registration_id
            """
        )
    )
    op.alter_column("draft_player", "primary_role", nullable=False, schema="balancer")

    op.create_table(
        "draft_player_role",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("draft_player_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("rank_value", sa.Integer(), nullable=True),
        sa.Column("is_secondary", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["draft_player_id"], ["balancer.draft_player.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("draft_player_id", "role", name="uq_draft_player_role"),
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_draft_player_role_draft_player_id", "draft_player_role", ["draft_player_id"], schema="balancer"
    )
    op.create_table(
        "draft_player_role_hero",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("draft_player_role_id", sa.Integer(), nullable=False),
        sa.Column("hero_id", sa.Integer(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["draft_player_role_id"], ["balancer.draft_player_role.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["hero_id"], ["overwatch.hero.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("draft_player_role_id", "priority", name="uq_draft_player_role_hero_priority"),
        sa.UniqueConstraint("draft_player_role_id", "hero_id", name="uq_draft_player_role_hero_hero"),
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_draft_player_role_hero_draft_player_role_id",
        "draft_player_role_hero",
        ["draft_player_role_id"],
        schema="balancer",
    )

    op.drop_constraint("uq_draft_player_session_registration", "draft_player", schema="balancer", type_="unique")
    op.create_unique_constraint(
        "uq_draft_player_session_member",
        "draft_player",
        ["session_id", "workspace_member_id"],
        schema="balancer",
    )
    op.drop_constraint("fk_draft_player_registration", "draft_player", schema="balancer", type_="foreignkey")
    op.drop_column("draft_player", "registration_id", schema="balancer")
