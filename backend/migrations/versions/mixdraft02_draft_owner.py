"""Mix captain draft: a draft session belongs to a tournament or to one lobby of a mix (spec §4.1, §9.1).

Revision ID: mixdraft02
Revises: mixdraft01
Create Date: 2026-10-22 00:00:03.000000

``draft.session`` gains ``discipline`` (backfilled from its tournament: the owner FKs carry it), ``custom_game_id`` and
``lobby_index``; ``tournament_id`` turns nullable. Exactly one owner (CHECK), each owner FK carries the workspace and
the discipline like ``fk_encounter_custom_game``, the lobby FK drops a lobby's drafts with the lobby, and one draft
per lobby may be active at a time. ``draft.player.registration_id`` turns nullable: a seat names a registration
(tournament) or a workspace member (mix), at least one of the two. Which one an owner's seats name is enforced by the
seed (``rules.validate_seat_identities``): a CHECK cannot see the session's owner. Its member FK turns from SET NULL
into the anchor rule of ``encounter.team_member`` (NO ACTION, deferred): a SET NULL would strip a mix seat of its only
identity, while a workspace delete still removes seat and member by commit.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mixdraft02"
down_revision: str | Sequence[str] | None = "mixdraft01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACTIVE = "status IN ('setup','ready','live','paused')"


def _drop_single_column_fk(schema: str, table: str, column: str) -> None:
    """The unnamed FK on one column, whatever the chain named it (``initial_v6`` left it to Postgres)."""
    op.execute(
        f"""
        DO $$
        DECLARE fk text;
        BEGIN
            SELECT con.conname INTO fk
            FROM pg_constraint con
            JOIN pg_class t ON t.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = con.conkey[1]
            WHERE n.nspname = '{schema}' AND t.relname = '{table}' AND con.contype = 'f'
              AND array_length(con.conkey, 1) = 1 AND a.attname = '{column}';
            IF fk IS NOT NULL THEN
                EXECUTE format('ALTER TABLE {schema}.{table} DROP CONSTRAINT %I', fk);
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    op.add_column("session", sa.Column("discipline", sa.String(32), nullable=True), schema="draft")
    op.execute(
        "UPDATE draft.session s SET discipline = t.discipline FROM tournament.tournament t WHERE t.id = s.tournament_id"
    )
    op.alter_column("session", "discipline", nullable=False, schema="draft")
    op.add_column("session", sa.Column("custom_game_id", sa.BigInteger(), nullable=True), schema="draft")
    op.add_column("session", sa.Column("lobby_index", sa.Integer(), nullable=True), schema="draft")
    op.alter_column("session", "tournament_id", nullable=True, schema="draft")
    _drop_single_column_fk("draft", "session", "tournament_id")
    op.create_foreign_key(
        "fk_draft_session_tournament",
        "session",
        "tournament",
        ["tournament_id", "workspace_id", "discipline"],
        ["id", "workspace_id", "discipline"],
        source_schema="draft",
        referent_schema="tournament",
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_draft_session_custom_game",
        "session",
        "custom_game",
        ["custom_game_id", "workspace_id", "discipline"],
        ["id", "workspace_id", "discipline"],
        source_schema="draft",
        referent_schema="mix",
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_draft_session_lobby",
        "session",
        "lobby",
        ["custom_game_id", "lobby_index"],
        ["custom_game_id", "lobby_index"],
        source_schema="draft",
        referent_schema="mix",
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_draft_session_owner", "session", "num_nonnulls(tournament_id, custom_game_id) = 1", schema="draft"
    )
    op.create_check_constraint(
        "ck_draft_session_lobby", "session", "(custom_game_id IS NULL) = (lobby_index IS NULL)", schema="draft"
    )
    op.create_index(
        "uq_draft_session_active_lobby",
        "session",
        ["custom_game_id", "lobby_index"],
        unique=True,
        schema="draft",
        postgresql_where=sa.text(_ACTIVE),
    )
    op.alter_column("player", "registration_id", nullable=True, schema="draft")
    op.create_check_constraint(
        "ck_draft_player_identity", "player", "num_nonnulls(registration_id, workspace_member_id) >= 1", schema="draft"
    )
    _drop_single_column_fk("draft", "player", "workspace_member_id")
    op.create_foreign_key(
        "fk_draft_player_workspace_member",
        "player",
        "workspace_member",
        ["workspace_member_id"],
        ["id"],
        source_schema="draft",
        deferrable=True,
        initially="DEFERRED",
    )


def downgrade() -> None:
    # A mix draft has no tournament to fall back to: the downgrade drops them (their seats and picks cascade).
    op.execute("DELETE FROM draft.session WHERE custom_game_id IS NOT NULL")
    op.drop_constraint("fk_draft_player_workspace_member", "player", schema="draft", type_="foreignkey")
    op.create_foreign_key(
        "draft_player_workspace_member_id_fkey",
        "player",
        "workspace_member",
        ["workspace_member_id"],
        ["id"],
        source_schema="draft",
        ondelete="SET NULL",
    )
    op.drop_constraint("ck_draft_player_identity", "player", schema="draft", type_="check")
    op.alter_column("player", "registration_id", nullable=False, schema="draft")
    op.drop_index("uq_draft_session_active_lobby", table_name="session", schema="draft")
    op.drop_constraint("ck_draft_session_lobby", "session", schema="draft", type_="check")
    op.drop_constraint("ck_draft_session_owner", "session", schema="draft", type_="check")
    op.drop_constraint("fk_draft_session_lobby", "session", schema="draft", type_="foreignkey")
    op.drop_constraint("fk_draft_session_custom_game", "session", schema="draft", type_="foreignkey")
    op.drop_constraint("fk_draft_session_tournament", "session", schema="draft", type_="foreignkey")
    op.create_foreign_key(
        "draft_session_tournament_id_fkey",
        "session",
        "tournament",
        ["tournament_id"],
        ["id"],
        source_schema="draft",
        referent_schema="tournament",
        ondelete="CASCADE",
    )
    op.alter_column("session", "tournament_id", nullable=False, schema="draft")
    op.drop_column("session", "lobby_index", schema="draft")
    op.drop_column("session", "custom_game_id", schema="draft")
    op.drop_column("session", "discipline", schema="draft")
