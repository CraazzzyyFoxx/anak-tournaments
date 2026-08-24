"""Admin CRUD for users + identities + profile merge + avatar + CSV import,
relocated from parser-service. Reads of users already live in app-service.

Pure transport: every handler decodes params, applies its permission gate, and
makes one service call. No SQL and no transaction lives here — the services own
``commit()``.

Permission model: user CRUD requires the global ``user.<action>`` permission;
merge is superuser-only. Social identities are managed by **superusers only**
(add/update/verify/delete/set_primary); their per-workspace/global display
**visibility** is a lighter capability gated on ``user.read``. ``verify``
manually marks an OAuth-eligible account verified when the automatic sync
missed a real OAuth connection that proves it (see
``shared.services.social_identity.verify_social_account``); it never
fabricates verification. CSV import requires the global ``admin`` role.
Avatar + CSV are binary/multipart (base64 via the gateway binary handler).

Self-service (``me_social_*``, capability ``account.social``) lets users manage
their own player's identities, but is **hide-only**: they can set-primary
(verified accounts) and toggle global display visibility — full deletion stays
superuser-only, so the verified identity is never destroyed by its owner. The same
capability covers ``me_set_stream_visibility``, the veto on surfacing the owner's
live stream on tournament pages — a separate switch from account visibility on
purpose, so staying off a tournament page does not cost you your public handle.

The same ``_account_gate`` also covers ``me_favorites_*`` (list/add/remove a
favorite player), but those never resolve the caller's player id -- a favorite
is keyed by the caller's own ``auth_user_id`` directly, so it needs no player
of the caller's own to exist and survives that player being re-linked/merged.
"""

from __future__ import annotations

import base64
import re
from typing import Any

import httpx
from faststream.rabbit import RabbitMessage

from shared.clients.s3 import upload_avatar
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.social import SOCIAL_PROVIDERS, SocialProvider
from shared.rpc.query import build_query_model
from src import schemas
from src.core import clients, db
from src.services import user_cache
from src.services.admin.favorites import favorites as favorites_service
from src.services.admin.user import users as admin_users
from src.services.admin.user_csv import csv_import as csv_service
from src.services.admin.user_merge import merges as merge_service
from src.services.user.service import users as user_service

from . import _common as c

_SF = db.async_session_maker
_ENTITIES = ["discord", "battle_tag", "twitch"]

_SHEETS_ID_RE = re.compile(r"/spreadsheets/d/([a-zA-Z0-9_-]+)")
_GID_RE = re.compile(r"[?&#]gid=(\d+)")


def _gate(data: dict, action: str) -> Any:
    user = c.actor(data)
    c.require_active(user)
    if not user.has_permission("user", action):
        raise HTTPException(status_code=403, detail=f"Permission denied: user.{action} required")
    return user


def _account_gate(data: dict) -> Any:
    """Self-service gate: any active user may manage their own accounts unless the
    ``account.social`` capability is explicitly denied (negative RBAC)."""
    user = c.actor(data)
    c.require_active(user)
    if user.is_denied("account", "social"):
        raise HTTPException(status_code=403, detail="You are not allowed to manage your accounts")
    return user


def _sheets_to_csv_url(url: str) -> str:
    match = _SHEETS_ID_RE.search(url)
    if not match:
        raise HTTPException(status_code=400, detail="Could not extract spreadsheet ID from the provided URL.")
    spreadsheet_id = match.group(1)
    gid_match = _GID_RE.search(url)
    gid = gid_match.group(1) if gid_match else "0"
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv&gid={gid}"


async def _envelope_and_invalidate(logger: Any, label: str, op: Any, data: dict) -> dict:
    """Run a user-mutating op, then drop the subject user's read caches on success.

    Profile/identity edits (name, avatar, socials) are not driven by
    TournamentChangedEvent, so without this the subject's cached profile/heroes/
    encounters/etc. would serve stale data until ``users_cache_ttl`` elapses.
    Runs after the DB session closes and only on ``ok`` — a failed write leaves
    the cache untouched. Cross-user cosmetic staleness (this user's name/avatar
    embedded in other users' cached lists) is left to the TTL.
    """
    result = await c.envelope(logger, label, op, session_factory=_SF)
    if result.get("ok"):
        try:
            user_id = c.require_id(data)
        except HTTPException:
            user_id = None
        if user_id is not None:
            await user_cache.invalidate_user_caches(user_id)
    return result


def register(broker: Any, logger: Any) -> None:
    # ── User CRUD ───────────────────────────────────────────────────────────
    @broker.subscriber("rpc.app.users.admin_list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data, "read")
            qp = build_query_model(schemas.UserListQueryParams, data.get("query"))
            res = await admin_users.get_users(session, schemas.UserListParams.from_query_params(qp))
            results = [user_service.to_read(user, _ENTITIES).model_dump(mode="json") for user in res["results"]]
            return {
                "results": results,
                "total": res["total"],
                "page": res["page"],
                "per_page": res["per_page"],
            }

        return await c.envelope(logger, "users.admin_list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.admin_create")
    async def _create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data, "create")
            created = await admin_users.create_user(session, schemas.UserCreate.model_validate(c.payload(data)))
            return user_service.to_read(created, _ENTITIES)

        return await c.envelope(logger, "users.admin_create", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.admin_update")
    async def _update(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data, "update")
            updated = await admin_users.update_user(
                session, c.require_id(data), schemas.UserAdminUpdate.model_validate(c.payload(data))
            )
            return user_service.to_read(updated, _ENTITIES)

        return await _envelope_and_invalidate(logger, "users.admin_update", op, data)

    @broker.subscriber("rpc.app.users.admin_delete")
    async def _delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data, "delete")
            await admin_users.delete_user(session, c.require_id(data))
            return None

        return await _envelope_and_invalidate(logger, "users.admin_delete", op, data)

    # ── Profile merge (superuser) ─────────────────────────────────────────────
    @broker.subscriber("rpc.app.users.merge_preview")
    async def _merge_preview(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            return await merge_service.preview_merge(
                session, schemas.UserMergePreviewRequest.model_validate(c.payload(data))
            )

        return await c.envelope(logger, "users.merge_preview", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.merge_execute")
    async def _merge_execute(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_superuser(user)
            return await merge_service.execute_merge(
                session,
                schemas.UserMergeExecuteRequest.model_validate(c.payload(data)),
                operator_auth_user_id=user.id,
            )

        return await c.envelope(logger, "users.merge_execute", op, session_factory=_SF)

    # ── Social identities (unified, generic) ──────────────────────────────────
    async def _refresh_user(session: Any, user_id: int) -> Any:
        user = await admin_users.get_user_or_404(session, user_id)
        return user_service.to_read(user, _ENTITIES)

    def _validate_social_create(payload: schemas.SocialAccountCreate) -> None:
        if payload.provider not in SOCIAL_PROVIDERS:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {payload.provider}")
        if not payload.username.strip():
            raise HTTPException(status_code=400, detail="username is required")
        if payload.provider == SocialProvider.BATTLENET and "#" not in payload.username:
            raise HTTPException(status_code=400, detail="Invalid BattleTag format. Expected 'Name#1234'.")

    @broker.subscriber("rpc.app.users.social_add")
    async def _social_add(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            user_id = c.require_id(data)
            payload = schemas.SocialAccountCreate.model_validate(c.payload(data))
            _validate_social_create(payload)
            await admin_users.add_social_account(
                session,
                user_id=user_id,
                provider=payload.provider,
                username=payload.username,
                url=payload.url,
            )
            return await _refresh_user(session, user_id)

        return await _envelope_and_invalidate(logger, "users.social_add", op, data)

    @broker.subscriber("rpc.app.users.social_update")
    async def _social_update(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            user_id = c.require_id(data)
            payload = schemas.SocialAccountUpdate.model_validate(c.payload(data))
            await admin_users.update_social_account(
                session,
                user_id=user_id,
                account_id=int(data["account_id"]),
                username=payload.username,
                url=payload.url,
            )
            return await _refresh_user(session, user_id)

        return await _envelope_and_invalidate(logger, "users.social_update", op, data)

    @broker.subscriber("rpc.app.users.social_verify")
    async def _social_verify(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            user_id = c.require_id(data)
            await admin_users.verify_social_account(
                session, user_id=user_id, account_id=int(data["account_id"])
            )
            return await _refresh_user(session, user_id)

        return await _envelope_and_invalidate(logger, "users.social_verify", op, data)

    @broker.subscriber("rpc.app.users.social_delete")
    async def _social_delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            user_id = c.require_id(data)
            await admin_users.delete_social_account(
                session, user_id=user_id, account_id=int(data["account_id"])
            )
            return await _refresh_user(session, user_id)

        return await _envelope_and_invalidate(logger, "users.social_delete", op, data)

    @broker.subscriber("rpc.app.users.social_set_primary")
    async def _social_set_primary(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            user_id = c.require_id(data)
            await admin_users.set_social_primary(session, user_id=user_id, account_id=int(data["account_id"]))
            return await _refresh_user(session, user_id)

        return await _envelope_and_invalidate(logger, "users.social_set_primary", op, data)

    @broker.subscriber("rpc.app.users.social_set_visibility")
    async def _social_set_visibility(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            # Display visibility (per-workspace / global) is a lighter capability than
            # editing identities: anyone with ``user.read`` may configure it.
            _gate(data, "read")
            user_id = c.require_id(data)
            payload = schemas.SocialVisibilityUpdate.model_validate(c.payload(data))
            await admin_users.set_social_visibility(
                session,
                user_id=user_id,
                account_id=int(data["account_id"]),
                workspace_id=payload.workspace_id,
                visible=payload.visible,
            )
            return await _refresh_user(session, user_id)

        return await _envelope_and_invalidate(logger, "users.social_set_visibility", op, data)

    # ── Self-service: a user manages their OWN player's social accounts ───────
    # Adding is OAuth-only (handled by identity-service link flow); here we only
    # list / set-primary (verified only) / remove. Gated on the account.social
    # capability (deny-aware), NOT superuser.
    @broker.subscriber("rpc.app.users.me_social_list")
    async def _me_social_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _account_gate(data)
            player_id = await admin_users.resolve_my_player_id_or_none(session, user.id)
            if player_id is None:
                # Belt-and-suspenders after the iwrefac09 backfill: a self-listing
                # endpoint must not 404 just because the caller has no linked
                # player. Return an empty list (My Account then renders the empty
                # state + link buttons) instead of crashing. id=0 is a "no player"
                # sentinel; both callers read only ``.social_accounts``.
                return schemas.UserRead(id=0, name="", social_accounts=[])
            return await _refresh_user(session, player_id)

        return await c.envelope(logger, "users.me_social_list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.me_social_set_primary")
    async def _me_social_set_primary(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _account_gate(data)
            player_id = await admin_users.resolve_my_player_id(session, user.id)
            await admin_users.set_own_social_primary(
                session, player_id=player_id, account_id=int(data["account_id"])
            )
            await user_cache.invalidate_user_caches(player_id)
            return await _refresh_user(session, player_id)

        return await c.envelope(logger, "users.me_social_set_primary", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.me_social_set_visibility")
    async def _me_social_set_visibility(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _account_gate(data)
            player_id = await admin_users.resolve_my_player_id(session, user.id)
            # The request body arrives under ``data["payload"]`` (gateway convention),
            # not the top level — read it via ``c.payload`` like the admin handler.
            visible = bool(c.payload(data).get("visible", True))
            await admin_users.set_own_social_visibility(
                session, player_id=player_id, account_id=int(data["account_id"]), visible=visible
            )
            await user_cache.invalidate_user_caches(player_id)
            return await _refresh_user(session, player_id)

        return await c.envelope(logger, "users.me_social_set_visibility", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.me_set_stream_visibility")
    async def _me_set_stream_visibility(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            # No capability beyond "this is my account": refusing to be broadcast is
            # not a privilege. Deliberately NOT folded into
            # ``me_social_set_visibility`` — that one hides the handle from the public
            # profile too, and having to disappear from your own profile to stay off a
            # tournament page is the bug this endpoint exists to fix.
            user = _account_gate(data)
            player_id = await admin_users.resolve_my_player_id(session, user.id)
            payload = schemas.StreamVisibilityUpdate.model_validate(c.payload(data))
            await admin_users.set_stream_visible(session, player_id, visible=payload.visible)
            await user_cache.invalidate_user_caches(player_id)
            return await _refresh_user(session, player_id)

        return await c.envelope(logger, "users.me_set_stream_visibility", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.me_favorites_list")
    async def _me_favorites_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _account_gate(data)
            return await favorites_service.list_for(session, user.id)

        return await c.envelope(logger, "users.me_favorites_list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.me_favorite_add")
    async def _me_favorite_add(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _account_gate(data)
            return await favorites_service.add(session, auth_user_id=user.id, player_id=c.require_id(data))

        return await c.envelope(logger, "users.me_favorite_add", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.me_favorite_remove")
    async def _me_favorite_remove(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _account_gate(data)
            return await favorites_service.remove(session, auth_user_id=user.id, player_id=c.require_id(data))

        return await c.envelope(logger, "users.me_favorite_remove", op, session_factory=_SF)

    # ── Avatar (binary base64) ────────────────────────────────────────────────
    @broker.subscriber("rpc.app.users.avatar_upload")
    async def _avatar_upload(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data, "update")
            user_id = c.require_id(data)
            # 404 before anything reaches S3, so a bad id never leaves an orphan object.
            await admin_users.get_user_or_404(session, user_id)
            file_data = base64.b64decode(data.get("content_b64", ""))
            result = await upload_avatar(
                clients.s3_client,
                entity_type="players",
                entity_id=user_id,
                file_data=file_data,
                content_type=data.get("content_type") or "application/octet-stream",
            )
            if not result.success:
                raise HTTPException(status_code=400, detail=result.error)
            player_user = await admin_users.set_avatar(session, user_id=user_id, avatar_url=result.public_url)
            return user_service.to_read(player_user, _ENTITIES)

        return await _envelope_and_invalidate(logger, "users.avatar_upload", op, data)

    @broker.subscriber("rpc.app.users.avatar_delete")
    async def _avatar_delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data, "update")
            user_id = c.require_id(data)
            await admin_users.get_user_or_404(session, user_id)
            await clients.s3_client.delete_prefix(f"avatars/players/{user_id}/")
            player_user = await admin_users.set_avatar(session, user_id=user_id, avatar_url=None)
            return user_service.to_read(player_user, _ENTITIES)

        return await _envelope_and_invalidate(logger, "users.avatar_delete", op, data)

    # ── CSV / Google-Sheets bulk import (user.create) ─────────────────────────
    @broker.subscriber("rpc.app.users.csv_import")
    async def _csv_import(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data, "create")

            content_b64 = data.get("content_b64")
            sheet_url = c.q1(data, "sheet_url") or data.get("sheet_url")
            if content_b64:
                lines = base64.b64decode(content_b64).decode("utf-8").split("\n")
                filename = data.get("filename") or "upload.csv"
            elif sheet_url:
                csv_url = _sheets_to_csv_url(sheet_url)
                async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                    resp = await client.get(csv_url)
                if resp.status_code != 200:
                    raise HTTPException(
                        status_code=400, detail=f"Failed to fetch Google Sheet (HTTP {resp.status_code})."
                    )
                lines = resp.text.split("\n")
                filename = sheet_url
            else:
                raise HTTPException(status_code=400, detail="Provide either a CSV file upload or a Google Sheets URL.")

            await csv_service.bulk_create_users_from_csv(
                session,
                filename,
                lines,
                c.q1(data, "start_row", int, 0),
                battle_tag_row=c.require_query_int(data, "battle_tag_row"),
                discord_row=c.require_query_int(data, "discord_row"),
                twitch_row=c.require_query_int(data, "twitch_row"),
                smurf_row=c.require_query_int(data, "smurf_row"),
                delimiter=c.q1(data, "delimiter", str, ","),
                has_discord=c.q1(data, "has_discord", c.qbool, True),
                has_smurf=c.q1(data, "has_smurf", c.qbool, True),
                has_twitch=c.q1(data, "has_twitch", c.qbool, True),
            )
            return {"success": True}

        return await c.envelope(logger, "users.csv_import", op, session_factory=_SF)
