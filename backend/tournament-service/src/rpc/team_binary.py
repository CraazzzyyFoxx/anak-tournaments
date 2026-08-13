"""Team logo upload/delete over typed RPC (binary body, base64 on the wire).

Mirrors ``app-service/src/rpc/users_admin.py``'s ``avatar_upload`` /
``avatar_delete`` pair, retargeted at tournament teams: the gateway's multipart
``file`` arrives as ``data["content_b64"]`` + ``data["content_type"]``, the
permission gate is workspace-scoped (``team.update`` on the workspace resolved
from the team's tournament) rather than a global permission, and the reply is the
same full ``TeamRead`` the generic admin CRUD returns for a team — so the caller
gets ``image_url`` plus the hydrated tournament/roster/captain in one round trip.

S3 keys live under ``avatars/teams/{team_id}/`` (``upload_avatar`` builds them and
removes the previous file), so a re-upload never leaves orphaned objects behind.

Commit semantics: ``team_service.set_team_image`` commits internally (like every
other write in ``services/admin/team.py``), so the handlers add no extra commit.
"""

from __future__ import annotations

import base64
from typing import Any

from faststream.rabbit.annotations import RabbitMessage

from shared.clients.s3 import upload_avatar
from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.identity import ensure_workspace_permission
from src.core import auth
from src.rpc._helpers import _dump, _identity, _require_id, _run
from src.rpc._s3 import get_s3
from src.services.admin import team as team_service
from src.services.team import flows as team_flows

#: Same entity set ``registry._ser_team`` hydrates, so the upload/delete replies
#: are byte-for-byte the shape the admin CRUD subjects return for a team.
_TEAM_ENTITIES = ["tournament", "players", "players.user", "captain"]


async def _gate(session: Any, data: dict[str, Any]) -> int:
    """Rehydrate the identity, resolve the team's workspace, require team.update."""
    user = _identity(data)
    team_id = _require_id(data)
    ws_id = await auth.get_team_workspace_id(session, team_id)
    ensure_workspace_permission(user, ws_id, "team", "update")
    return team_id


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.tournament.teams.image_upload")
    async def _image_upload(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            team_id = await _gate(session, data)
            file_data = base64.b64decode(data.get("content_b64", ""))
            result = await upload_avatar(
                await get_s3(),
                entity_type="teams",
                entity_id=team_id,
                file_data=file_data,
                content_type=data.get("content_type", ""),
            )
            if not result.success:
                raise HTTPException(status_code=400, detail=result.error)
            team = await team_service.set_team_image(session, team_id, result.public_url)
            return _dump(await team_flows.to_pydantic(session, team, _TEAM_ENTITIES))

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.teams.image_delete")
    async def _image_delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            team_id = await _gate(session, data)
            # S3 first, DB second (same order as users_admin._avatar_delete): a
            # failed delete leaves the row pointing at bytes that still exist,
            # whereas the reverse order could leave image_url pointing at bytes
            # that no longer do.
            s3 = await get_s3()
            await s3.delete_prefix(f"avatars/teams/{team_id}/")
            team = await team_service.set_team_image(session, team_id, None)
            return _dump(await team_flows.to_pydantic(session, team, _TEAM_ENTITIES))

        return await _run(logger, op)
