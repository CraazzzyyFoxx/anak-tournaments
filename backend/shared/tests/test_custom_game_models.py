from __future__ import annotations

import sqlalchemy as sa

from shared import models
from shared.core import enums


class TestMixEnums:
    def test_participation_has_exactly_three_valid_states(self):
        assert {state.value for state in enums.MixParticipation} == {"must_play", "pool", "benched"}

    def test_role_selection_distinguishes_inherited_and_explicit_roles(self):
        assert {mode.value for mode in enums.MixRoleSelectionMode} == {"all_ranked", "explicit"}

    def test_self_signup_has_exactly_three_modes(self):
        assert {mode.value for mode in enums.MixSelfSignup} == {"closed", "pool", "benched"}


class TestCustomGameModel:
    def test_known_settings_are_not_stored_in_one_config_bag(self):
        columns = models.CustomGame.__table__.columns
        # The solver document is the lobby's, not the mix's: two lobbies of one
        # mix hold two independent matchups.
        assert "balance_result_json" not in columns
        assert "selected_variant_index" not in columns
        assert "next_map_id" not in columns
        assert "config_json" not in columns
        assert "result_json" not in columns
        assert "outcome_json" not in columns
        assert "co_host_user_ids" not in columns

    def test_everything_about_one_match_lives_on_the_lobby(self):
        columns = models.CustomGameLobby.__table__.columns
        assert {
            "custom_game_id",
            "lobby_index",
            "balance_result_json",
            "balance_result_version",
            "selected_variant_index",
            "next_map_id",
            "next_map_kind",
            "balanced_at",
        } <= set(columns.keys())
        assert [column.name for column in models.CustomGameLobby.__table__.primary_key] == [
            "custom_game_id",
            "lobby_index",
        ]

    def test_self_service_switches_are_columns_with_a_closed_default(self):
        # The signup mode decides *where* a self-signed player lands, so it is
        # one column with three states rather than a bool plus an enum -- there
        # is no valid "closed + benched" pair to represent.
        columns = models.CustomGame.__table__.columns
        assert columns["self_signup"].server_default.arg == "closed"
        assert columns["self_role_edit"].server_default.arg == "false"
        checks = {
            constraint.name: str(constraint.sqltext)
            for constraint in models.CustomGame.__table__.constraints
            if isinstance(constraint, sa.CheckConstraint)
        }
        assert "closed" in checks["ck_custom_game_self_signup"]
        assert "pool" in checks["ck_custom_game_self_signup"]
        assert "benched" in checks["ck_custom_game_self_signup"]

    def test_what_the_host_configures_is_not_on_the_mix(self):
        # Solver and points knobs belong to the host; the mix's format is its own
        # roster.team_format row and its Discord target belongs to the workspace.
        columns = models.CustomGame.__table__.columns
        assert "points_per_win" not in columns
        assert "discord_channel_id" not in columns
        user_columns = models.UserBalancerConfig.__table__.columns
        assert "role_slots_json" not in user_columns
        assert "custom_game_id" in models.RosterTeamFormat.__table__.columns
        assert "points_per_win" in user_columns

    def test_lineup_state_is_one_enum_like_column(self):
        columns = models.CustomGamePlayer.__table__.columns
        assert "participation" in columns
        assert "role_selection_mode" in columns
        assert "is_flex" in columns
        assert "is_active" not in columns
        assert "must_play" not in columns
        assert "roles_json" not in columns
        assert "team_index" not in columns

    def test_repeating_groups_have_relational_models(self):
        assert models.CustomGameCoHost.__table__.schema == "mix"
        assert models.CustomGamePlayerRole.__table__.schema == "mix"
        assert models.CustomGameTeamName.__table__.schema == "mix"
        assert not hasattr(models, "CustomGameRoleSlot")

    def test_co_host_grant_addresses_a_login_not_a_roster_row(self):
        # Membership is RBAC, so a co-host can hold write access here without a
        # `workspace_member` row -- the same identity `host_user_id` uses.
        columns = models.CustomGameCoHost.__table__.columns
        assert "workspace_member_id" not in columns
        assert next(iter(columns["user_id"].foreign_keys)).target_fullname == "auth.user.id"

    def test_player_role_priority_is_unique_per_player(self):
        constraints = models.CustomGamePlayerRole.__table__.constraints
        unique_columns = {
            tuple(column.name for column in constraint.columns)
            for constraint in constraints
            if isinstance(constraint, sa.UniqueConstraint)
        }
        assert ("custom_game_player_id", "priority") in unique_columns
