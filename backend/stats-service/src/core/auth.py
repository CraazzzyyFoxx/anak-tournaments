"""Authentication dependencies for stats-service (DB-backed + service scopes).

Re-exports the ``shared.rbac.workspace_lookup`` getters stats-service's RPC handlers call.
"""

from shared.rbac.workspace_lookup import (
    get_encounter_workspace_id as _get_encounter_workspace_id,
)
from shared.rbac.workspace_lookup import (
    get_ingest_job_workspace_id as _get_ingest_job_workspace_id,
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
    "_get_ingest_job_workspace_id",
    "require_tournament_id_permission",
)
