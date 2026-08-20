"""Authentication dependencies for parser-service (DB-backed + service scopes).

Re-exports ``shared.rbac.workspace_lookup`` — only the getters parser-service's
RPC handlers actually call (``rpc/bootstrap.py``, ``rpc/logs.py``,
``rpc/misc.py``). ``resolve_user_from_db`` and the team/player/stage/match/
standing getters were re-exported here too (a leftover from copying
tournament-service's superset) but never called anywhere in this service.
"""

from shared.rbac.workspace_lookup import (
    get_encounter_workspace_id as _get_encounter_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_log_record_workspace_id as _get_log_record_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_tournament_workspace_id as _get_tournament_workspace_id,
)
from shared.rbac.workspace_lookup import (
    require_tournament_id_permission,
)
from shared.rbac.workspace_lookup import (
    require_workspace_permission as _require_workspace_permission,
)

__all__ = (
    "_require_workspace_permission",
    "_get_tournament_workspace_id",
    "_get_encounter_workspace_id",
    "_get_log_record_workspace_id",
    "require_tournament_id_permission",
)
