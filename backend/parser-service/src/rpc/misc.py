"""Typed-RPC handlers for the remaining parser-unique admin surface:

- OverFast metadata sync: ``POST /heroes|maps|gamemodes/update`` (superuser; the
  public reads of these entities are owned by app-service).
- Global settings CRUD (superuser) — ``src/routes/admin/settings.py``.
- Per-tournament Discord channel config — ``src/routes/admin/discord_channel.py``.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.identity import ensure_workspace_permission
from src.core import auth, db
from src.schemas.admin import settings as settings_schemas
from src.schemas.admin.discord_channel import DiscordChannelRead, DiscordChannelUpsert
from src.services.admin.discord_channel import discord_channel_service
from src.services.admin.settings import settings_service
from src.services.gamemode.service import gamemode_service
from src.services.hero.service import hero_service
from src.services.map.service import map_service

from . import _common as c

_SF = db.async_session_maker


def register(broker: Any, logger: Any) -> None:
    # ── OverFast metadata sync (superuser: global game content) ─────────────────
    def _sync_handler(queue: str, initial_create: Any, label: str) -> None:
        @broker.subscriber(queue)
        async def _sync(data: dict, msg: RabbitMessage) -> dict:
            async def op(session: Any) -> Any:
                c.require_superuser(c.actor(data))
                # The service's own `initial_create` already commits — see
                # `HeroService`/`MapService`/`GamemodeService.initial_create`.
                await initial_create(session)
                return {"success": True}

            return await c.envelope(logger, label, op, session_factory=_SF)

    _sync_handler("rpc.parser.metadata.sync_heroes", hero_service.initial_create, "metadata.sync_heroes")
    _sync_handler("rpc.parser.metadata.sync_maps", map_service.initial_create, "metadata.sync_maps")
    _sync_handler("rpc.parser.metadata.sync_gamemodes", gamemode_service.initial_create, "metadata.sync_gamemodes")

    # ── Global settings (superuser) ─────────────────────────────────────────────
    @broker.subscriber("rpc.parser.settings.list")
    async def _settings_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            rows = await settings_service.list_settings(session)
            return [settings_schemas.SettingRead.model_validate(row) for row in rows]

        return await c.envelope(logger, "settings.list", op, session_factory=_SF)

    @broker.subscriber("rpc.parser.settings.get")
    async def _settings_get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            key = data.get("key")
            if not key:
                raise HTTPException(status_code=422, detail="key is required")
            setting = await settings_service.get_setting(session, key)
            return settings_schemas.SettingRead.model_validate(setting)

        return await c.envelope(logger, "settings.get", op, session_factory=_SF)

    @broker.subscriber("rpc.parser.settings.upsert")
    async def _settings_upsert(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_superuser(user)
            key = data.get("key")
            if not key:
                raise HTTPException(status_code=422, detail="key is required")
            body = settings_schemas.SettingUpsert.model_validate(c.payload(data))
            # `settings_service.upsert_setting` already commits — no rpc-level
            # re-commit.
            setting = await settings_service.upsert_setting(
                session, key, body.value, description=body.description, updated_by=user.id
            )
            return settings_schemas.SettingRead.model_validate(setting)

        return await c.envelope(logger, "settings.upsert", op, session_factory=_SF)

    # ── Per-tournament Discord channel (require_tournament_permission) ───────────
    @broker.subscriber("rpc.parser.discord_channel.get")
    async def _discord_get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            tournament_id = c.require_id(data)
            workspace_id = await auth._get_tournament_workspace_id(session, tournament_id)
            ensure_workspace_permission(user, workspace_id, "discord_channel", "read")
            channel = await discord_channel_service.get(session, tournament_id)
            return DiscordChannelRead.model_validate(channel, from_attributes=True) if channel else None

        return await c.envelope(logger, "discord_channel.get", op, session_factory=_SF)

    @broker.subscriber("rpc.parser.discord_channel.upsert")
    async def _discord_upsert(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            tournament_id = c.require_id(data)
            workspace_id = await auth._get_tournament_workspace_id(session, tournament_id)
            ensure_workspace_permission(user, workspace_id, "discord_channel", "update")
            body = DiscordChannelUpsert.model_validate(c.payload(data))

            # `_get_tournament_workspace_id` above already raises 404 if the
            # tournament doesn't exist, so no separate existence check here.
            channel = await discord_channel_service.upsert(
                session,
                tournament_id,
                channel_id=int(body.channel_id),
                channel_name=body.channel_name,
                is_active=body.is_active,
            )
            return DiscordChannelRead.model_validate(channel, from_attributes=True)

        return await c.envelope(logger, "discord_channel.upsert", op, session_factory=_SF)

    @broker.subscriber("rpc.parser.discord_channel.delete")
    async def _discord_delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            tournament_id = c.require_id(data)
            workspace_id = await auth._get_tournament_workspace_id(session, tournament_id)
            ensure_workspace_permission(user, workspace_id, "discord_channel", "delete")
            deleted = await discord_channel_service.delete(session, tournament_id)
            if not deleted:
                raise HTTPException(status_code=404, detail="Discord channel not configured")
            return None

        return await c.envelope(logger, "discord_channel.delete", op, session_factory=_SF)
