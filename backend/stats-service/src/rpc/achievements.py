"""Typed-RPC handlers for the achievement engine + rules admin, gated by the workspace ``achievement.<action>`` permission.

The public achievement reads (catalogue, a user's earned achievements, earners) are ``achievement_reads.py``.
``export`` returns the JSON payload as data; the frontend builds its own download.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared import quota
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.pagination import paginated_dump
from shared.models.achievements.achievement import AchievementOverrideAction
from shared.rpc.identity import ensure_workspace_permission
from shared.rpc.query import build_query_model
from src import schemas
from src.core import clients as _clients
from src.core import db
from src.services.achievement import import_export
from src.services.achievement.rule_service import achievement_rule_service

from . import _common as c

_SF = db.async_session_maker


def _require_ws(data: dict, action: str) -> tuple[Any, int]:
    """Rehydrate identity + enforce the workspace-scoped achievement permission."""
    user = c.actor(data)
    c.require_active(user)
    workspace_id = c.require_path_int(data, "workspace_id")
    ensure_workspace_permission(user, workspace_id, "achievement", action)
    return user, workspace_id


def require_discipline(data: dict) -> str:
    """The request's explicit discipline: JSON body first, then ``?discipline=``; absent is a 422, never a default."""
    body = data.get("payload")
    value = body.get("discipline") if isinstance(body, dict) else None
    if value is None:
        raw = (data.get("query") or {}).get("discipline")
        value = (raw[0] if isinstance(raw, list) and raw else raw) or None
    if not isinstance(value, str) or not value:
        raise HTTPException(status_code=422, detail="discipline is required")
    return value


def register(broker: Any, logger: Any) -> None:  # noqa: C901 - one subscriber per route, mechanical
    # ``_require_ws`` resolves the scope from ``data`` (the path/query slot); the two calculate routes carry it in the
    # payload / on the tournament, so they gate inline instead.
    @broker.subscriber("rpc.stats.ach.calculate")
    async def _calculate(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            payload = schemas.AchievementCalculateRequest.model_validate(c.payload(data) or {})
            if payload.workspace_id is None:
                raise HTTPException(
                    status_code=400, detail="workspace_id is required for global achievement calculation"
                )
            ensure_workspace_permission(user, payload.workspace_id, "achievement", "update")
            # A full-workspace engine run: every enabled rule's condition tree
            # evaluated over the whole history, all of it CPU on this worker.
            await quota.charge(user, "parser.ach.calculate", workspace_id=payload.workspace_id)
            return await achievement_rule_service.calculate(
                session, workspace_id=payload.workspace_id, tournament_id=None, payload=payload
            )

        return await c.envelope(logger, "ach.calculate", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.calculate_tournament")
    async def _calculate_tournament(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            tournament_id = c.require_path_int(data, "tournament_id")
            payload = schemas.AchievementCalculateRequest.model_validate(c.payload(data) or {})
            workspace_id = await achievement_rule_service.calculation_workspace(
                session, tournament_id=tournament_id, workspace_id=payload.workspace_id
            )
            ensure_workspace_permission(user, workspace_id, "achievement", "update")
            # Same engine, one tournament's slice of history — still a CPU-bound
            # sweep over every rule.
            await quota.charge(user, "parser.ach.calculate_tournament", workspace_id=workspace_id)
            return await achievement_rule_service.calculate(
                session, workspace_id=workspace_id, tournament_id=tournament_id, payload=payload
            )

        return await c.envelope(logger, "ach.calculate_tournament", op, session_factory=_SF)

    # ── rules: reference + validation ──────────────────────────────────────────
    @broker.subscriber("rpc.stats.ach.condition_types")
    async def _condition_types(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "read")
            return await achievement_rule_service.condition_types(
                session, workspace_id=workspace_id, discipline=require_discipline(data)
            )

        return await c.envelope(logger, "ach.condition_types", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.validate")
    async def _validate(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "read")
            body = schemas.ConditionTreeValidateRequest.model_validate(c.payload(data))
            return await achievement_rule_service.validate_tree(session, workspace_id=workspace_id, body=body)

        return await c.envelope(logger, "ach.validate", op, session_factory=_SF)

    # ── rules: seed / reset ────────────────────────────────────────────────────
    @broker.subscriber("rpc.stats.ach.seed")
    async def _seed(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "create")
            return await achievement_rule_service.seed(
                session, workspace_id=workspace_id, discipline=require_discipline(data)
            )

        return await c.envelope(logger, "ach.seed", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.reset")
    async def _reset(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "update")
            return await achievement_rule_service.reset(
                session, workspace_id=workspace_id, discipline=require_discipline(data)
            )

        return await c.envelope(logger, "ach.reset", op, session_factory=_SF)

    # ── rules: CRUD ────────────────────────────────────────────────────────────
    @broker.subscriber("rpc.stats.ach.list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "read")
            qp = build_query_model(schemas.AchievementRuleListQueryParams, data.get("query"))
            return paginated_dump(
                await achievement_rule_service.list_rules(
                    session,
                    workspace_id=workspace_id,
                    params=schemas.AchievementRuleListParams.from_query_params(qp),
                )
            )

        return await c.envelope(logger, "ach.list", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.export")
    async def _export(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user, workspace_id = _require_ws(data, "read")
            discipline = require_discipline(data)
            # Dumps every rule of the workspace's discipline, condition trees and all — an
            # unbounded read whose size grows with the rule set.
            await quota.charge(user, "parser.ach.export", workspace_id=workspace_id)
            return await import_export.export_rules(session, workspace_id=workspace_id, discipline=discipline)

        return await c.envelope(logger, "ach.export", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.import")
    async def _import(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user, workspace_id = _require_ws(data, "create")
            # v1 envelopes and ``hero_id`` fail validation here, whatever the request shape.
            body = schemas.AchievementRuleExportEnvelope.model_validate(c.payload(data))
            # Each imported rule copies its image through S3 and writes a rule row,
            # so the batch is priced by how many rules it carries.
            await quota.charge(user, "parser.ach.import", workspace_id=workspace_id, item_count=len(body.rules))
            return await import_export.import_envelope(
                session, _clients.s3_client, user=user, workspace_id=workspace_id, body=body
            )

        return await c.envelope(logger, "ach.import", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.get")
    async def _get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "read")
            rule = await achievement_rule_service.get_rule(
                session, workspace_id=workspace_id, rule_id=c.require_path_int(data, "rule_id")
            )
            return schemas.AchievementRuleRead.model_validate(rule, from_attributes=True)

        return await c.envelope(logger, "ach.get", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.create")
    async def _create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "create")
            body = schemas.AchievementRuleCreate.model_validate(c.payload(data))
            rule = await achievement_rule_service.create_rule(
                session, workspace_id=workspace_id, rule_data=body.model_dump()
            )
            return schemas.AchievementRuleRead.model_validate(rule, from_attributes=True)

        return await c.envelope(logger, "ach.create", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.update")
    async def _update(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "update")
            rule_id = c.require_path_int(data, "rule_id")
            body = schemas.AchievementRuleUpdate.model_validate(c.payload(data))
            rule = await achievement_rule_service.update_rule(
                session, workspace_id=workspace_id, rule_id=rule_id, update_data=body.model_dump(exclude_unset=True)
            )
            return schemas.AchievementRuleRead.model_validate(rule, from_attributes=True)

        return await c.envelope(logger, "ach.update", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.delete")
    async def _delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "delete")
            await achievement_rule_service.delete_rule(
                session, workspace_id=workspace_id, rule_id=c.require_path_int(data, "rule_id")
            )
            return None

        return await c.envelope(logger, "ach.delete", op, session_factory=_SF)

    # ── rules: evaluation ──────────────────────────────────────────────────────
    @broker.subscriber("rpc.stats.ach.evaluate")
    async def _evaluate(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "update")
            body = schemas.EvaluateRequest.model_validate(c.payload(data))
            return await achievement_rule_service.evaluate(session, workspace_id=workspace_id, body=body)

        return await c.envelope(logger, "ach.evaluate", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.runs")
    async def _runs(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "read")
            return await achievement_rule_service.list_runs(session, workspace_id=workspace_id)

        return await c.envelope(logger, "ach.runs", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.rule_users")
    async def _rule_users(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "read")
            return await achievement_rule_service.rule_users(
                session,
                workspace_id=workspace_id,
                rule_id=c.require_path_int(data, "rule_id"),
                page=c.q1(data, "page", int, 1),
                per_page=c.q1(data, "per_page", int, 30),
                tournament_id=c.q1(data, "tournament_id", int),
                sort=c.q1(data, "sort", str, "count"),
                order=c.q1(data, "order", str, "desc"),
            )

        return await c.envelope(logger, "ach.rule_users", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.test")
    async def _test(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "update")
            return await achievement_rule_service.test_rule(
                session,
                workspace_id=workspace_id,
                rule_id=c.require_path_int(data, "rule_id"),
                tournament_id=c.q1(data, "tournament_id", int),
            )

        return await c.envelope(logger, "ach.test", op, session_factory=_SF)

    # ── library ────────────────────────────────────────────────────────────────
    @broker.subscriber("rpc.stats.ach.lib_workspaces")
    async def _lib_workspaces(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user, workspace_id = _require_ws(data, "read")
            return await import_export.library_workspaces(
                session, user=user, workspace_id=workspace_id, discipline=require_discipline(data)
            )

        return await c.envelope(logger, "ach.lib_workspaces", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.lib_list")
    async def _lib_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user, workspace_id = _require_ws(data, "read")
            discipline = require_discipline(data)
            return await import_export.library_rules(
                session,
                user=user,
                workspace_id=workspace_id,
                source_workspace_id=c.require_query_int(data, "source_workspace_id"),
                discipline=discipline,
            )

        return await c.envelope(logger, "ach.lib_list", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.lib_import")
    async def _lib_import(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user, workspace_id = _require_ws(data, "create")
            body = schemas.AchievementLibraryImportRequest.model_validate(c.payload(data))
            # Copies rules across workspaces: an S3 image copy and a rule write per
            # slug pulled out of the source library.
            await quota.charge(user, "parser.ach.lib_import", workspace_id=workspace_id)
            return await import_export.import_from_library(
                session, _clients.s3_client, user=user, workspace_id=workspace_id, body=body
            )

        return await c.envelope(logger, "ach.lib_import", op, session_factory=_SF)

    # ── overrides ──────────────────────────────────────────────────────────────
    @broker.subscriber("rpc.stats.ach.overrides_list")
    async def _overrides_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "read")
            return await achievement_rule_service.list_overrides(
                session, workspace_id=workspace_id, discipline=require_discipline(data)
            )

        return await c.envelope(logger, "ach.overrides_list", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.override_create")
    async def _override_create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user, workspace_id = _require_ws(data, "update")
            body = schemas.OverrideCreate.model_validate(c.payload(data))
            return await achievement_rule_service.create_rule_override(
                session,
                workspace_id=workspace_id,
                rule_id=body.achievement_rule_id,
                user_id=body.user_id,
                granted_by=user.id,
                tournament_id=body.tournament_id,
                match_id=body.match_id,
                action=AchievementOverrideAction(body.action),
                reason=body.reason,
            )

        return await c.envelope(logger, "ach.override_create", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ach.override_delete")
    async def _override_delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _user, workspace_id = _require_ws(data, "update")
            await achievement_rule_service.delete_workspace_override(
                session, workspace_id=workspace_id, override_id=c.require_path_int(data, "override_id")
            )
            return None

        return await c.envelope(logger, "ach.override_delete", op, session_factory=_SF)
