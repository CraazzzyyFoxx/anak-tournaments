"""Authentication dependencies for tournament-service.

The ``get_*_workspace_id`` resolvers and ``require_*`` helpers below are the
cross-module authorization contract: RPC handlers resolve the workspace from
the actual object being acted on (never from a client-supplied field) and then
check the caller's permission in that workspace.

Re-exports ``shared.rbac.workspace_lookup`` — parser-service's and (until this
consolidation) analytics-service's ``core/auth.py`` reimplemented the same
getters under leading-underscore names.
"""

from shared.rbac.workspace_lookup import (
    get_encounter_workspace_id,
    get_match_workspace_id,
    get_player_sub_role_workspace_id,
    get_player_workspace_id,
    get_registration_workspace_id,
    get_stage_item_input_workspace_id,
    get_stage_item_workspace_id,
    get_stage_workspace_id,
    get_standing_workspace_id,
    get_team_workspace_id,
    get_tournament_link_workspace_id,
    get_tournament_workspace_id,
    require_encounter_ids_permission,
    require_tournament_id_permission,
    require_workspace_permission,
)

__all__ = (
    "require_workspace_permission",
    "get_tournament_workspace_id",
    "get_team_workspace_id",
    "get_player_workspace_id",
    "get_player_sub_role_workspace_id",
    "get_stage_workspace_id",
    "get_stage_item_workspace_id",
    "get_stage_item_input_workspace_id",
    "get_encounter_workspace_id",
    "get_match_workspace_id",
    "get_standing_workspace_id",
    "get_registration_workspace_id",
    "get_tournament_link_workspace_id",
    "require_tournament_id_permission",
    "require_encounter_ids_permission",
)
