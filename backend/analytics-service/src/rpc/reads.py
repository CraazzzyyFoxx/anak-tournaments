"""Public + authenticated read RPC subscribers (``rpc.analytics.*``).

Each handler calls a flow/query and coerces the result through the same
response model the decommissioned HTTP layer used (default
``exclude_none=False`` — none of the analytics reads set
``response_model_exclude_none``). Response schemas now live in
``src/schemas/analytics_read.py`` and ``src/schemas/ml.py`` so the contract
stays single-source and fastapi-free.

Auth: rating reads are public (gateway ``AuthNone``); ML + job reads require
a global ``analytics.read`` permission (gateway ``AuthRequired`` + the same
``has_permission`` check the legacy routes used).
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage

from shared.core.errors import BaseAPIException as HTTPException
from src.core import db, pagination
from src.core.jobs import get_active_job, job_runtime
from src.schemas.ml import (
    AnalyticsJobRow,
    AnomalyFeedbackRow,
    ExplanationRow,
    MatchQualityRow,
    MLArtifactRow,
    PerformanceRow,
    PlayerAnomalyRow,
    StandingsRow,
)
from src.services.analytics.reads import flows_service

from . import _common as c


def _req_int(data: dict[str, Any], key: str) -> int:
    value = c.q1(data, key, int)
    if value is None:
        raise HTTPException(status_code=422, detail=f"{key} is required")
    return value


def register(broker: Any, logger: Any) -> None:
    sf = db.async_session_maker

    # ── rating reads (public) ──────────────────────────────────────────

    @broker.subscriber("rpc.analytics.get_algorithm")
    async def _get_algorithm(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await flows_service.get_algorithm(session, c.require_id(data))

        return await c.envelope(logger, "get_algorithm", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.list_algorithms")
    async def _list_algorithms(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            params = pagination.PaginationParams.from_query_params(
                pagination.PaginationQueryParams(
                    page=c.q1(data, "page", int, 1),
                    per_page=c.q1(data, "per_page", int, 10),
                )
            )
            return await flows_service.get_algorithms(session, params, tournament_id=c.q1(data, "tournament_id", int))

        return await c.envelope(logger, "list_algorithms", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.get_analytics")
    async def _get_analytics(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await flows_service.get_analytics(
                session,
                _req_int(data, "tournament_id"),
                _req_int(data, "algorithm"),
                workspace_id=c.q1(data, "workspace_id", int),
            )

        return await c.envelope(logger, "get_analytics", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.get_streaks")
    async def _get_streaks(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await flows_service.get_streaks(session, _req_int(data, "tournament_id"))

        return await c.envelope(logger, "get_streaks", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.balance_quality")
    async def _balance_quality(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await flows_service.get_balance_quality(session, _req_int(data, "tournament_id"))

        return await c.envelope(logger, "balance_quality", op, session_factory=sf)

    # ── ML reads (require analytics.read) ──────────────────────────────

    @broker.subscriber("rpc.analytics.performance")
    async def _performance(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            rows = await flows_service.list_performance(
                session,
                _req_int(data, "tournament_id"),
                algorithm_id=c.q1(data, "algorithm_id", int),
            )
            return [PerformanceRow.model_validate(r, from_attributes=True) for r in rows]

        return await c.envelope(logger, "performance", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.standings")
    async def _standings(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            rows = await flows_service.list_standings(
                session,
                _req_int(data, "tournament_id"),
                algorithm_id=c.q1(data, "algorithm_id", int),
            )
            return [StandingsRow.model_validate(r, from_attributes=True) for r in rows]

        return await c.envelope(logger, "standings", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.match_quality")
    async def _match_quality(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            rows = await flows_service.list_match_quality(
                session,
                _req_int(data, "tournament_id"),
                algorithm_id=c.q1(data, "algorithm_id", int),
            )
            return [MatchQualityRow.model_validate(r, from_attributes=True) for r in rows]

        return await c.envelope(logger, "match_quality", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.player_anomalies")
    async def _player_anomalies(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            rows = await flows_service.list_player_anomalies(
                session,
                _req_int(data, "tournament_id"),
                player_id=c.q1(data, "player_id", int),
                kind=c.q1(data, "kind", str),
            )
            return [PlayerAnomalyRow.model_validate(r, from_attributes=True) for r in rows]

        return await c.envelope(logger, "player_anomalies", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.feedback_list")
    async def _feedback_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            rows = await flows_service.list_feedback(session, _req_int(data, "tournament_id"))
            return [AnomalyFeedbackRow.model_validate(r, from_attributes=True) for r in rows]

        return await c.envelope(logger, "feedback_list", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.explain")
    async def _explain(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            row = await flows_service.get_explanation(
                session,
                int(data["player_id"]),
                int(data["tournament_id"]),
                algorithm_id=c.q1(data, "algorithm_id", int),
            )
            if row is None:
                raise HTTPException(status_code=404, detail="Explanation not found")
            return ExplanationRow.model_validate(row, from_attributes=True)

        return await c.envelope(logger, "explain", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.artifacts")
    async def _artifacts(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            rows = await flows_service.list_artifacts(
                session,
                model_kind=c.q1(data, "model_kind", str),
                active_only=c.q1(data, "active_only", bool, False),
            )
            return [MLArtifactRow.model_validate(r, from_attributes=True) for r in rows]

        return await c.envelope(logger, "artifacts", op, session_factory=sf)

    # ── job reads (require analytics.read) ─────────────────────────────

    @broker.subscriber("rpc.analytics.jobs_active")
    async def _jobs_active(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            job = await get_active_job(session, c.q1(data, "workspace_id", int))
            return AnalyticsJobRow.model_validate(job, from_attributes=True) if job is not None else None

        return await c.envelope(logger, "jobs_active", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.jobs_list")
    async def _jobs_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            jobs = await job_runtime.list(
                session,
                workspace_id=c.q1(data, "workspace_id", int),
                limit=c.q1(data, "limit", int, 20),
                statuses=(("pending", "running") if c.q1(data, "active_only", c.qbool, False) else None),
            )
            return [AnalyticsJobRow.model_validate(j, from_attributes=True) for j in jobs]

        return await c.envelope(logger, "jobs_list", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.jobs_get")
    async def _jobs_get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "read")
            job = await job_runtime.get(session, c.require_id(data))

            if job is None:
                raise HTTPException(status_code=404, detail="Job not found")
            return AnalyticsJobRow.model_validate(job, from_attributes=True)

        return await c.envelope(logger, "jobs_get", op, session_factory=sf)
