"""Split ``balancer`` into ``registration``, ``mix`` and ``draft``; drop the redundant table-name prefixes.

Revision ID: schemasplit01
Revises: subrole01
Create Date: 2026-10-21 00:00:00.000000

``balancer`` had grown to 34 tables, of which only 9 are the balancer: the
saved balances and their teams, the balancer configs and the workspace member
ranks it reads. The rest are three other domains that lived there because the
balancer was their first reader -- tournament registration (forms, statuses,
the registration row, team registration), the workspace pickup mixes
(``custom_game*``) and the live draft (``draft_*``). Each now has its own
schema, and a table drops the prefix the schema now says
(``balancer.registration_form`` -> ``registration.form``,
``balancer.custom_game_player`` -> ``mix.player``,
``balancer.draft_session`` -> ``draft.session``).

Rename-only: ``ALTER TABLE .. SET SCHEMA`` carries the rows, indexes,
constraints and owned sequences along. Afterwards every index or constraint
whose name the models now spell differently is renamed to exactly that name
(the ``index=True`` ones because SQLAlchemy puts the schema and table in
``ix_<schema>_<table>_<column>``, the explicit ones because they no longer say
``balancer``), plus two database-only names that still did, and the owned id
sequences follow their tables (``<table>_id_seq``). No row is rewritten.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "schemasplit01"
down_revision: str | Sequence[str] | None = "subrole01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_SCHEMAS = ("registration", "mix", "draft")

#: ``balancer.<old>`` -> ``<schema>.<new>``.
TABLES = (
    ("registration", "registration", "registration"),
    ("registration_form", "registration", "form"),
    ("registration_form_version", "registration", "form_version"),
    ("registration_form_template", "registration", "form_template"),
    ("registration_google_sheet_feed", "registration", "google_sheet_feed"),
    ("registration_google_sheet_binding", "registration", "google_sheet_binding"),
    ("registration_identity", "registration", "identity"),
    ("registration_role", "registration", "role"),
    ("registration_role_entity", "registration", "role_entity"),
    ("registration_status", "registration", "status"),
    ("registration_team", "registration", "team"),
    ("registration_team_invite", "registration", "team_invite"),
    ("custom_game", "mix", "custom_game"),
    ("custom_game_co_host", "mix", "co_host"),
    ("custom_game_lobby", "mix", "lobby"),
    ("custom_game_player", "mix", "player"),
    ("custom_game_player_role", "mix", "player_role"),
    ("custom_game_round", "mix", "round"),
    ("custom_game_round_member", "mix", "round_member"),
    ("custom_game_team_name", "mix", "team_name"),
    ("draft_session", "draft", "session"),
    ("draft_team", "draft", "team"),
    ("draft_player", "draft", "player"),
    ("draft_pick", "draft", "pick"),
    ("draft_audit_event", "draft", "audit_event"),
)

#: Indexes, incl. the ones backing a unique constraint (renaming the index renames its constraint): ``(schema, old, new)``.
INDEXES = (
    ("registration", "ix_balancer_registration_form_version_id", "ix_registration_registration_form_version_id"),
    (
        "registration",
        "ix_balancer_registration_registration_team_id",
        "ix_registration_registration_registration_team_id",
    ),
    ("registration", "ix_balancer_registration_tournament_id", "ix_registration_registration_tournament_id"),
    (
        "registration",
        "ix_balancer_registration_workspace_member_id",
        "ix_registration_registration_workspace_member_id",
    ),
    (
        "registration",
        "ix_balancer_registration_tournament_balancer_status",
        "ix_registration_tournament_balancer_status",
    ),
    # Database-only (no model declares it), renamed so nothing outside ``balancer`` says ``balancer``.
    ("registration", "ix_balancer_registration_tournament_status", "ix_registration_tournament_status"),
    ("registration", "uq_balancer_registration_tournament_tag_active", "uq_registration_tournament_tag_active"),
    ("registration", "uq_balancer_registration_user", "uq_registration_user"),
    ("registration", "ix_balancer_registration_form_tournament_id", "ix_registration_form_tournament_id"),
    ("registration", "ix_balancer_registration_form_workspace_id", "ix_registration_form_workspace_id"),
    ("registration", "uq_balancer_registration_form_tournament", "uq_registration_form_tournament"),
    ("registration", "uq_balancer_registration_form_template_name", "uq_registration_form_template_name"),
    (
        "registration",
        "ix_balancer_registration_form_template_workspace_id",
        "ix_registration_form_template_workspace_id",
    ),
    ("registration", "ix_balancer_registration_form_version_form_id", "ix_registration_form_version_form_id"),
    ("registration", "uq_balancer_registration_form_version_number", "uq_registration_form_version_number"),
    (
        "registration",
        "ix_balancer_registration_google_sheet_binding_feed_id",
        "ix_registration_google_sheet_binding_feed_id",
    ),
    (
        "registration",
        "ix_balancer_registration_google_sheet_binding_registration_id",
        "ix_registration_google_sheet_binding_registration_id",
    ),
    (
        "registration",
        "uq_balancer_registration_google_sheet_binding_key",
        "uq_registration_google_sheet_binding_key",
    ),
    (
        "registration",
        "uq_balancer_registration_google_sheet_binding_registration",
        "uq_registration_google_sheet_binding_registration",
    ),
    (
        "registration",
        "ix_balancer_registration_google_sheet_feed_tournament_id",
        "ix_registration_google_sheet_feed_tournament_id",
    ),
    (
        "registration",
        "uq_balancer_registration_google_sheet_feed_tournament",
        "uq_registration_google_sheet_feed_tournament",
    ),
    ("registration", "ix_balancer_registration_identity_handle", "ix_registration_identity_handle"),
    (
        "registration",
        "ix_balancer_registration_identity_registration_id",
        "ix_registration_identity_registration_id",
    ),
    ("registration", "uq_balancer_registration_identity_handle", "uq_registration_identity_handle"),
    ("registration", "uq_balancer_registration_identity_position", "uq_registration_identity_position"),
    ("registration", "ix_balancer_registration_role_registration_id", "ix_registration_role_registration_id"),
    ("registration", "ix_balancer_registration_role_role_id", "ix_registration_role_role_id"),
    ("registration", "ix_balancer_registration_role_entity_role_id", "ix_registration_role_entity_role_id"),
    ("registration", "ix_balancer_registration_status_workspace_scope", "ix_registration_status_workspace_scope"),
    ("registration", "ix_balancer_registration_status_workspace_id", "ix_registration_status_workspace_id"),
    (
        "registration",
        "uq_balancer_registration_status_workspace_scope_slug",
        "uq_registration_status_workspace_scope_slug",
    ),
    (
        "registration",
        "ix_balancer_registration_team_captain_registration_id",
        "ix_registration_team_captain_registration_id",
    ),
    ("registration", "ix_balancer_registration_team_exported_team_id", "ix_registration_team_exported_team_id"),
    ("registration", "uq_balancer_registration_team_name_active", "uq_registration_team_name_active"),
    ("registration", "ix_balancer_registration_team_tournament_status", "ix_registration_team_tournament_status"),
    ("registration", "ix_balancer_registration_team_tournament_id", "ix_registration_team_tournament_id"),
    ("registration", "ix_balancer_registration_team_workspace_id", "ix_registration_team_workspace_id"),
    (
        "registration",
        "ix_balancer_registration_team_invite_target_auth_user_id",
        "ix_registration_team_invite_target_auth_user_id",
    ),
    ("registration", "ix_balancer_registration_team_invite_team_state", "ix_registration_team_invite_team_state"),
    ("registration", "ix_balancer_registration_team_invite_team_id", "ix_registration_team_invite_team_id"),
    ("registration", "uq_balancer_registration_team_invite_token", "uq_registration_team_invite_token"),
    ("mix", "ix_balancer_custom_game_host_user_id", "ix_mix_custom_game_host_user_id"),
    ("mix", "ix_balancer_custom_game_workspace_id", "ix_mix_custom_game_workspace_id"),
    ("mix", "ix_balancer_custom_game_player_custom_game_id", "ix_mix_player_custom_game_id"),
    ("mix", "ix_balancer_custom_game_player_workspace_member_id", "ix_mix_player_workspace_member_id"),
    ("mix", "ix_balancer_custom_game_player_role_role_id", "ix_mix_player_role_role_id"),
    ("draft", "ix_balancer_draft_audit_event_actor_auth_user_id", "ix_draft_audit_event_actor_auth_user_id"),
    ("draft", "ix_balancer_draft_pick_draft_team_id", "ix_draft_pick_draft_team_id"),
    ("draft", "ix_balancer_draft_pick_picked_player_id", "ix_draft_pick_picked_player_id"),
    ("draft", "ix_balancer_draft_pick_target_role_id", "ix_draft_pick_target_role_id"),
    ("draft", "ix_balancer_draft_player_captain_role_id", "ix_draft_player_captain_role_id"),
    ("draft", "ix_balancer_draft_player_drafted_by_team_id", "ix_draft_player_drafted_by_team_id"),
    ("draft", "ix_balancer_draft_player_workspace_member_id", "ix_draft_player_workspace_member_id"),
    ("draft", "ix_balancer_draft_session_source_balance_id", "ix_draft_session_source_balance_id"),
    ("draft", "ix_balancer_draft_session_workspace_id", "ix_draft_session_workspace_id"),
    ("draft", "ix_balancer_draft_team_captain_auth_user_id", "ix_draft_team_captain_auth_user_id"),
    ("draft", "ix_balancer_draft_team_captain_workspace_member_id", "ix_draft_team_captain_workspace_member_id"),
    ("draft", "ix_balancer_draft_team_exported_team_id", "ix_draft_team_exported_team_id"),
    ("draft", "ix_balancer_draft_team_session_id", "ix_draft_team_session_id"),
)

#: Database-only foreign key name (the model leaves it unnamed): ``(schema, table, old, new)``.
CONSTRAINTS = (
    (
        "mix",
        "player",
        "fk_balancer_custom_game_player_workspace_member_id",
        "fk_custom_game_player_workspace_member_id",
    ),
)


#: Owned ``id`` sequences of renamed tables (composite-key tables own none): ``(schema, old, new)``.
SEQUENCES = (
    ("registration", "registration_form_id_seq", "form_id_seq"),
    ("registration", "registration_form_version_id_seq", "form_version_id_seq"),
    ("registration", "registration_form_template_id_seq", "form_template_id_seq"),
    ("registration", "registration_google_sheet_feed_id_seq", "google_sheet_feed_id_seq"),
    ("registration", "registration_google_sheet_binding_id_seq", "google_sheet_binding_id_seq"),
    ("registration", "registration_identity_id_seq", "identity_id_seq"),
    ("registration", "registration_role_id_seq", "role_id_seq"),
    ("registration", "registration_role_entity_id_seq", "role_entity_id_seq"),
    ("registration", "registration_status_id_seq", "status_id_seq"),
    ("registration", "registration_team_id_seq", "team_id_seq"),
    ("registration", "registration_team_invite_id_seq", "team_invite_id_seq"),
    ("mix", "custom_game_player_id_seq", "player_id_seq"),
    ("draft", "draft_session_id_seq", "session_id_seq"),
    ("draft", "draft_team_id_seq", "team_id_seq"),
    ("draft", "draft_player_id_seq", "player_id_seq"),
    ("draft", "draft_pick_id_seq", "pick_id_seq"),
    ("draft", "draft_audit_event_id_seq", "audit_event_id_seq"),
)


def _rename_constraint(schema: str, table: str, old: str, new: str) -> None:
    # No ``IF EXISTS`` for constraints: a database stamped from an older chain may lack one.
    op.execute(
        f"""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = '{schema}' AND t.relname = '{table}' AND c.conname = '{old}'
            ) THEN
                ALTER TABLE {schema}.{table} RENAME CONSTRAINT {old} TO {new};
            END IF;
        END $$
        """
    )


# Sequences, indexes and constraints are renamed only where they exist: production-derived
# databases (stamped ``initial_v6``) lack a few model indexes, which ``drift01`` creates.
def upgrade() -> None:
    for schema in NEW_SCHEMAS:
        op.execute(f"CREATE SCHEMA {schema}")
    for old, schema, new in TABLES:
        op.execute(f"ALTER TABLE balancer.{old} SET SCHEMA {schema}")
        if new != old:
            op.execute(f"ALTER TABLE {schema}.{old} RENAME TO {new}")
    for schema, old, new in SEQUENCES:
        op.execute(f"ALTER SEQUENCE IF EXISTS {schema}.{old} RENAME TO {new}")
    for schema, old, new in INDEXES:
        op.execute(f"ALTER INDEX IF EXISTS {schema}.{old} RENAME TO {new}")
    for schema, table, old, new in CONSTRAINTS:
        _rename_constraint(schema, table, old, new)


def downgrade() -> None:
    for schema, table, old, new in CONSTRAINTS:
        _rename_constraint(schema, table, new, old)
    for schema, old, new in INDEXES:
        op.execute(f"ALTER INDEX IF EXISTS {schema}.{new} RENAME TO {old}")
    for schema, old, new in SEQUENCES:
        op.execute(f"ALTER SEQUENCE IF EXISTS {schema}.{new} RENAME TO {old}")
    for old, schema, new in TABLES:
        if new != old:
            op.execute(f"ALTER TABLE {schema}.{new} RENAME TO {old}")
        op.execute(f"ALTER TABLE {schema}.{old} SET SCHEMA balancer")
    for schema in NEW_SCHEMAS:
        op.execute(f"DROP SCHEMA {schema}")
