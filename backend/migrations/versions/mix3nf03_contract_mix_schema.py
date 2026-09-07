"""Contract pickup-mix storage to the normalized schema.

Revision ID: mix3nf03
Revises: mix3nf02
Create Date: 2026-08-29 00:20:00.000000

Run only in the coordinated maintenance window after mix3nf02 succeeds and the
new application artifact is ready to deploy.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "mix3nf03"
down_revision: str | Sequence[str] | None = "mix3nf02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "custom_game_player",
        "participation",
        nullable=False,
        server_default="pool",
        schema="balancer",
    )
    op.alter_column(
        "custom_game_player",
        "role_selection_mode",
        nullable=False,
        server_default="all_ranked",
        schema="balancer",
    )
    op.create_check_constraint(
        "ck_custom_game_player_participation",
        "custom_game_player",
        "participation IN ('must_play', 'pool', 'benched')",
        schema="balancer",
    )
    op.create_check_constraint(
        "ck_custom_game_player_role_selection_mode",
        "custom_game_player",
        "role_selection_mode IN ('all_ranked', 'explicit')",
        schema="balancer",
    )
    op.create_check_constraint(
        "ck_custom_game_status",
        "custom_game",
        "status IN ('draft', 'balanced', 'completed', 'cancelled')",
        schema="balancer",
    )
    op.create_check_constraint(
        "ck_custom_game_points_per_win",
        "custom_game",
        "points_per_win IS NULL OR points_per_win BETWEEN 1 AND 1000",
        schema="balancer",
    )

    op.alter_column("team", "match_id", nullable=False, schema="casual")
    op.alter_column("team", "side", nullable=False, schema="casual")
    op.alter_column("team", "score", nullable=False, schema="casual")
    op.alter_column("player", "display_name_snapshot", nullable=False, schema="casual")
    op.create_unique_constraint("uq_casual_team_match_side", "team", ["match_id", "side"], schema="casual")
    op.create_check_constraint("ck_casual_team_side", "team", "side IN ('home', 'away')", schema="casual")
    op.create_check_constraint("ck_casual_team_score", "team", "score >= 0", schema="casual")

    op.drop_index("ix_casual_match_workspace_id", table_name="match", schema="casual")
    op.drop_index("ix_casual_team_workspace_id", table_name="team", schema="casual")
    op.drop_column("match", "workspace_id", schema="casual")
    op.drop_column("match", "home_team_id", schema="casual")
    op.drop_column("match", "away_team_id", schema="casual")
    op.drop_column("match", "home_score", schema="casual")
    op.drop_column("match", "away_score", schema="casual")
    op.drop_column("team", "workspace_id", schema="casual")

    op.drop_column("custom_game_player", "team_index", schema="balancer")
    op.drop_column("custom_game_player", "is_active", schema="balancer")
    op.drop_column("custom_game_player", "must_play", schema="balancer")
    op.drop_column("custom_game_player", "roles_json", schema="balancer")
    op.drop_column("custom_game", "co_host_user_ids", schema="balancer")
    op.drop_column("custom_game", "config_json", schema="balancer")
    op.drop_column("custom_game", "result_json", schema="balancer")
    op.drop_column("custom_game", "outcome_json", schema="balancer")


def downgrade() -> None:
    raise NotImplementedError(
        "mix3nf03 removes duplicated legacy columns; restore a pre-maintenance backup or roll forward"
    )
