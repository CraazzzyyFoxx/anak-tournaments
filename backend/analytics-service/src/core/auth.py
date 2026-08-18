"""Authentication dependencies for analytics-service (DB-backed + service scopes).

This file used to be a literal, unedited copy of parser-service's
``core/auth.py`` — its docstring even still said "parser-service" before this
consolidation. Re-exports ``shared.rbac.workspace_lookup``, the single source
of truth both services (and tournament-service, under different names) drew
from.
"""

from shared.rbac.workspace_lookup import (
    get_encounter_workspace_id as _get_encounter_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_log_record_workspace_id as _get_log_record_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_match_workspace_id as _get_match_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_player_sub_role_workspace_id as _get_player_sub_role_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_player_workspace_id as _get_player_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_stage_item_input_workspace_id as _get_stage_item_input_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_stage_item_workspace_id as _get_stage_item_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_stage_workspace_id as _get_stage_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_standing_workspace_id as _get_standing_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_team_workspace_id as _get_team_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_tournament_workspace_id as _get_tournament_workspace_id,
)
from shared.rbac.workspace_lookup import (
    require_encounter_ids_permission,
    require_tournament_id_permission,
)
from shared.rbac.workspace_lookup import (
    require_workspace_permission as _require_workspace_permission,
)
from shared.rbac.workspace_lookup import (
    resolve_user_from_db as _resolve_user_from_db,
)

__all__ = (
    "_resolve_user_from_db",
    "_require_workspace_permission",
    "_get_tournament_workspace_id",
    "_get_team_workspace_id",
    "_get_player_workspace_id",
    "_get_player_sub_role_workspace_id",
    "_get_stage_workspace_id",
    "_get_stage_item_workspace_id",
    "_get_stage_item_input_workspace_id",
    "_get_encounter_workspace_id",
    "_get_match_workspace_id",
    "_get_standing_workspace_id",
    "_get_log_record_workspace_id",
    "require_tournament_id_permission",
    "require_encounter_ids_permission",
)
