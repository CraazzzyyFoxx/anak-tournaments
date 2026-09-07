"""Admin CRUD for game metadata (hero / map / gamemode), relocated from
parser-service. The public reads already live in app-service (shared CRUD read
engine); these are the superuser-only admin writes + paginated admin list. Game
metadata is global game content shared by every workspace, so it is not
delegated to workspace roles.

Pure transport: the generic ``_register_entity`` closure factory receives the
three admin services' bound methods, so a fourth catalog entity costs one call
and no new handler bodies.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core.pagination import paginated_dump
from shared.rpc.query import build_query_model
from shared.services.audit import record_admin_audit
from src import schemas
from src.core import db
from src.services.admin.gamemode import gamemodes as gamemode_service
from src.services.admin.hero import heroes as hero_service
from src.services.admin.map import maps as map_service

from . import _common as c

_SF = db.async_session_maker

# ``prefix`` is the plural RPC namespace; the audit entity_type is singular.
_ENTITY_TYPES = {"heroes": "hero", "maps": "map", "gamemodes": "gamemode"}


def _gate(data: dict) -> None:
    c.require_superuser(c.actor(data))


def register(broker: Any, logger: Any) -> None:
    def _register_entity(
        *,
        prefix: str,
        list_qp: Any,
        list_params: Any,
        create_schema: Any,
        update_schema: Any,
        read_schema: Any,
        list_fn: Any,
        create_fn: Any,
        update_fn: Any,
        delete_fn: Any,
    ) -> None:
        entity = _ENTITY_TYPES[prefix]

        @broker.subscriber(f"rpc.app.{prefix}.admin_list")
        async def _list(data: dict, msg: RabbitMessage) -> dict:
            async def op(session: Any) -> Any:
                _gate(data)
                qp = build_query_model(list_qp, data.get("query"))
                return paginated_dump(await list_fn(session, list_params.from_query_params(qp)))

            return await c.envelope(logger, f"{prefix}.admin_list", op, session_factory=_SF)

        @broker.subscriber(f"rpc.app.{prefix}.admin_create")
        async def _create(data: dict, msg: RabbitMessage) -> dict:
            async def op(session: Any) -> Any:
                _gate(data)
                body = create_schema.model_validate(c.payload(data))
                fields = body.model_dump()
                await record_admin_audit(
                    session,
                    action=f"{entity}.create",
                    actor=c.actor(data),
                    data=data,
                    workspace_id=None,
                    entity_type=entity,
                    entity_label=fields.get("name"),
                    after={k: fields[k] for k in ("name", "slug") if k in fields},
                )
                obj = await create_fn(session, body)
                return read_schema.model_validate(obj, from_attributes=True)

            return await c.envelope(logger, f"{prefix}.admin_create", op, session_factory=_SF)

        @broker.subscriber(f"rpc.app.{prefix}.admin_update")
        async def _update(data: dict, msg: RabbitMessage) -> dict:
            async def op(session: Any) -> Any:
                _gate(data)
                obj_id = c.require_id(data)
                body = update_schema.model_validate(c.payload(data))
                await record_admin_audit(
                    session,
                    action=f"{entity}.update",
                    actor=c.actor(data),
                    data=data,
                    workspace_id=None,
                    entity_type=entity,
                    entity_id=obj_id,
                    after=body.model_dump(exclude_unset=True),
                )
                obj = await update_fn(session, obj_id, body)
                return read_schema.model_validate(obj, from_attributes=True)

            return await c.envelope(logger, f"{prefix}.admin_update", op, session_factory=_SF)

        @broker.subscriber(f"rpc.app.{prefix}.admin_delete")
        async def _delete(data: dict, msg: RabbitMessage) -> dict:
            async def op(session: Any) -> Any:
                _gate(data)
                obj_id = c.require_id(data)
                await record_admin_audit(
                    session,
                    action=f"{entity}.delete",
                    actor=c.actor(data),
                    data=data,
                    workspace_id=None,
                    entity_type=entity,
                    entity_id=obj_id,
                )
                await delete_fn(session, obj_id)
                return None

            return await c.envelope(logger, f"{prefix}.admin_delete", op, session_factory=_SF)

    _register_entity(
        prefix="heroes",
        list_qp=schemas.HeroListQueryParams,
        list_params=schemas.HeroListParams,
        create_schema=schemas.HeroCreate,
        update_schema=schemas.HeroUpdate,
        read_schema=schemas.HeroRead,
        list_fn=hero_service.get_heroes,
        create_fn=hero_service.create_hero,
        update_fn=hero_service.update_hero,
        delete_fn=hero_service.delete_hero,
    )
    _register_entity(
        prefix="maps",
        list_qp=schemas.MapListQueryParams,
        list_params=schemas.MapListParams,
        create_schema=schemas.MapCreate,
        update_schema=schemas.MapUpdate,
        read_schema=schemas.MapRead,
        list_fn=map_service.get_maps,
        create_fn=map_service.create_map,
        update_fn=map_service.update_map,
        delete_fn=map_service.delete_map,
    )
    _register_entity(
        prefix="gamemodes",
        list_qp=schemas.GamemodeListQueryParams,
        list_params=schemas.GamemodeListParams,
        create_schema=schemas.GamemodeCreate,
        update_schema=schemas.GamemodeUpdate,
        read_schema=schemas.GamemodeRead,
        list_fn=gamemode_service.get_gamemodes,
        create_fn=gamemode_service.create_gamemode,
        update_fn=gamemode_service.update_gamemode,
        delete_fn=gamemode_service.delete_gamemode,
    )
