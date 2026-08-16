"""OpenAPI request/response model map for stream-service RPC subjects.

Schemas-only module consumed by the export script — see ``shared.rpc.openapi``.
Kept import-light (no broker/DB) so ``backend/scripts/export_openapi_schemas.sh``
can import it with dummy connection env.

Neither subject takes a request body, so there is no ``request=``: the public read
carries only a path id, and the re-poll carries a path id plus ``workspace_id``.
"""

from __future__ import annotations

from shared.rpc.openapi import Op, QueryParam
from src.schemas import stream as stream_schemas

OPERATIONS: dict[str, Op] = {
    # ── public read ────────────────────────────────────────────────────────
    "rpc.stream.tournament_streams": Op(response=stream_schemas.TournamentStreamsRead),
    # ── admin: force the next poll ─────────────────────────────────────────
    "rpc.stream.repoll": Op(
        response=stream_schemas.StreamRepollRead,
        query_params=(
            QueryParam(
                name="workspace_id",
                type="integer",
                required=True,
                description="Workspace the stream.update permission is checked against; must own the tournament.",
            ),
        ),
    ),
}
