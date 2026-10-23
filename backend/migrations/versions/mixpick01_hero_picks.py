"""Mix hero picks (spec §11.6 R4-1, R4-8): whose answer a submission is, whose hero a pick is, and Fearless.

Revision ID: mixpick01
Revises: valorant01
Create Date: 2026-10-23 00:00:00.000000

Expand plus one key swap. ``pick_ban_submission.team_member_id`` (NULL for every team step and every existing row)
joins the submission's unique key, which stays NULLS NOT DISTINCT so the engine still answers a step once;
``pick_ban_entry.picked_for_member_id`` names the seat a picked hero is for; ``mix.custom_game.hero_fearless``
defaults to false.

The downgrade leaves nothing pre-П4 code cannot read: it deletes every room whose ruleset holds a member step or an
assignment (their entries and submissions cascade), then any member answer left -- under the old key two members of
one team would collide -- and unsets the pick presets a mix or a lobby names, and drops them from the hosts' per-game
defaults (``balancer.user_config.hero_ban_presets``; the old prefs validator refuses them). Tournament rooms hold
neither.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mixpick01"
down_revision: str | Sequence[str] | None = "valorant01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KEY = "uq_pick_ban_submission_step_team_attempt"
#: The presets whose rulesets hold member steps or an assignment (spec §11.6 R4-7).
_PICK_PRESETS = "('lol_draft', 'lol_captains', 'deadlock_bans_pick')"


def upgrade() -> None:
    op.add_column(
        "pick_ban_submission", sa.Column("team_member_id", sa.BigInteger(), nullable=True), schema="encounter"
    )
    op.create_foreign_key(
        "fk_pick_ban_submission_team_member",
        "pick_ban_submission",
        "team_member",
        ["team_member_id"],
        ["id"],
        source_schema="encounter",
        referent_schema="encounter",
        ondelete="CASCADE",
    )
    op.drop_index(_KEY, table_name="pick_ban_submission", schema="encounter")
    op.create_index(
        _KEY,
        "pick_ban_submission",
        ["session_id", "step_index", "encounter_team_id", "team_member_id", "attempt"],
        unique=True,
        schema="encounter",
        postgresql_nulls_not_distinct=True,
    )
    op.add_column(
        "pick_ban_entry", sa.Column("picked_for_member_id", sa.BigInteger(), nullable=True), schema="encounter"
    )
    op.create_foreign_key(
        "fk_pick_ban_entry_picked_for",
        "pick_ban_entry",
        "team_member",
        ["picked_for_member_id"],
        ["id"],
        source_schema="encounter",
        referent_schema="encounter",
        ondelete="SET NULL",
    )
    op.add_column(
        "custom_game",
        sa.Column("hero_fearless", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="mix",
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM encounter.pick_ban_session WHERE jsonb_path_exists("
        "ruleset_json::jsonb, '$.phases[*].steps[*] ? (@.member != null || @.action == \"assign\")')"
    )
    op.execute(f"UPDATE mix.custom_game SET hero_ban_preset = NULL WHERE hero_ban_preset IN {_PICK_PRESETS}")
    op.execute(f"UPDATE mix.lobby SET live_ban_preset = NULL WHERE live_ban_preset IN {_PICK_PRESETS}")
    op.execute(
        "UPDATE balancer.user_config SET hero_ban_presets = ("
        "SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(hero_ban_presets)"
        f" WHERE value #>> '{{}}' NOT IN {_PICK_PRESETS})"
        f" WHERE EXISTS (SELECT 1 FROM jsonb_each_text(hero_ban_presets) WHERE value IN {_PICK_PRESETS})"
    )
    op.drop_column("custom_game", "hero_fearless", schema="mix")
    op.drop_constraint("fk_pick_ban_entry_picked_for", "pick_ban_entry", schema="encounter", type_="foreignkey")
    op.drop_column("pick_ban_entry", "picked_for_member_id", schema="encounter")
    op.execute("DELETE FROM encounter.pick_ban_submission WHERE team_member_id IS NOT NULL")
    op.drop_index(_KEY, table_name="pick_ban_submission", schema="encounter")
    op.create_index(
        _KEY,
        "pick_ban_submission",
        ["session_id", "step_index", "encounter_team_id", "attempt"],
        unique=True,
        schema="encounter",
        postgresql_nulls_not_distinct=True,
    )
    op.drop_constraint(
        "fk_pick_ban_submission_team_member", "pick_ban_submission", schema="encounter", type_="foreignkey"
    )
    op.drop_column("pick_ban_submission", "team_member_id", schema="encounter")
