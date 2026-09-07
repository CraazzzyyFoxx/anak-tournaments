"""Registration-team crest upload/delete over typed RPC (base64 on the wire).

Structurally the twin of ``src/rpc/team_binary.py`` — same multipart-to-base64
transport, same S3-first delete ordering — but a separate module because it
serves a different domain behind a different gate:

* ``team_binary`` writes ``Team.image_url``, the *materialized* tournament team,
  and gates on ``team.update`` in the team's workspace (organizer staff).
* this module writes ``BalancerRegistrationTeam.image_url``, the *pre-formation*
  registered team, and gates on being that team's captain — a competitor who
  usually holds no workspace membership at all. The gate runs twice, exactly as
  ``team_binary``'s does: once here before any S3 call (``assert_may_edit_team``,
  lock-free), then authoritatively under the row lock inside ``set_team_image``.

S3 keys live under ``avatars/registration_teams/{team_id}/`` (``upload_avatar``
builds them and removes the previous file), so a re-upload never leaves orphaned
objects behind — and the prefix is disjoint from ``avatars/teams/`` even when a
registration team and its exported ``Team`` share an id.

Transport: the gateway sends the path id as ``data["team_id"]`` (matching the
sibling ``regteam_*`` subjects in ``public_rpc.py``, not ``team_binary``'s
``data["id"]``), the multipart file as ``data["content_b64"]`` +
``data["content_type"]``. The reply is the full ``RegistrationTeamRead`` the
captain's own view expects — image plus live occupancy and outstanding invites —
so the UI needs no follow-up read.

Commit semantics: ``set_team_image`` commits internally, like every other write
in ``services/registration/teams.py``, so the handlers add no extra commit.
"""

from __future__ import annotations

import base64
from typing import Any

from faststream.rabbit.annotations import RabbitMessage

from shared.clients.s3 import upload_avatar
from shared.core.errors import BaseAPIException as HTTPException
from shared.services.audit import record_admin_audit
from src.rpc._helpers import _dump, _identity, _path_int, _run
from src.rpc._s3 import get_s3
from src.services.registration import teams as team_service


def register(broker: Any, logger: Any) -> None:
    async def _gate(session: Any, data: dict[str, Any]) -> tuple[Any, int]:
        """Rehydrate the identity and refuse a non-captain before any S3 call.

        team_binary._gate runs the permission check first for the same reason:
        ``upload_avatar`` removes the previous object before storing the new one,
        so a stranger reaching S3 destroys the crest whatever the DB then says.
        """
        user = _identity(data)
        team_id = _path_int(data, "team_id")
        await team_service.teams_service.assert_may_edit_team(session, team_id=team_id, auth_user=user)
        return user, team_id

    @broker.subscriber("rpc.tournament.regteam_image_upload")
    async def _image_upload(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user, team_id = await _gate(session, data)
            file_data = base64.b64decode(data.get("content_b64", ""))
            result = await upload_avatar(
                await get_s3(),
                entity_type="registration_teams",
                entity_id=team_id,
                file_data=file_data,
                content_type=data.get("content_type", ""),
            )
            if not result.success:
                raise HTTPException(status_code=400, detail=result.error)
            # ``set_team_image`` commits, so the row goes on the session first.
            # No workspace: the gate is captaincy, not a workspace permission.
            await record_admin_audit(
                session,
                action="registration_team.image_set",
                actor=user,
                data=data,
                workspace_id=None,
                entity_type="registration_team",
                entity_id=team_id,
                after={"image_url": result.public_url, "content_type": data.get("content_type")},
            )
            team = await team_service.teams_service.set_team_image(
                session,
                team_id=team_id,
                auth_user=user,
                image_url=result.public_url,
            )
            # The captain is the only caller, so their own offers are theirs to
            # see — same shape regteam_create returns.
            return _dump(await team_service.teams_service.describe_team(session, team, include_invites=True))

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_image_delete")
    async def _image_delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user, team_id = await _gate(session, data)
            # S3 first, DB second (same order as team_binary._image_delete): a
            # failed delete leaves the row pointing at bytes that still exist,
            # whereas the reverse order could leave image_url pointing at bytes
            # that no longer do.
            s3 = await get_s3()
            await s3.delete_prefix(f"avatars/registration_teams/{team_id}/")
            await record_admin_audit(
                session,
                action="registration_team.image_clear",
                actor=user,
                data=data,
                workspace_id=None,
                entity_type="registration_team",
                entity_id=team_id,
                after={"image_url": None},
            )
            team = await team_service.teams_service.set_team_image(
                session,
                team_id=team_id,
                auth_user=user,
                image_url=None,
            )
            return _dump(await team_service.teams_service.describe_team(session, team, include_invites=True))

        return await _run(logger, op)
