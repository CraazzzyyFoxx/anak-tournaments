"""Light mutation RPC subscribers (``rpc.analytics.*``).

Bespoke, non-job mutations: manual shift override (``POST /analytics/shift``) and
anomaly-feedback upsert (``POST /v2/player-anomalies/feedback``). Heavier compute
lives behind job-control (``jobs_control.py``). Wired from ``serve_rpc.py``.

Auth: all require a global ``analytics.update`` permission (gateway
``AuthRequired`` + ``has_permission``).
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage

from src import schemas
from src.core import db
from src.schemas.ml import AnomalyFeedbackBody, AnomalyFeedbackRow
from src.services.analytics.reads import flows_service

from . import _common as c


def register(broker: Any, logger: Any) -> None:
    sf = db.async_session_maker

    @broker.subscriber("rpc.analytics.shift")
    async def _shift(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_permission(c.actor(data), "analytics", "update")
            body = schemas.PlayerShiftUpdate.model_validate(c.payload(data))
            # change_shift commits internally (AnalyticsReadService.change_shift).
            return await flows_service.change_shift(session, body.player_id, body.shift)

        return await c.envelope(logger, "shift", op, session_factory=sf)

    @broker.subscriber("rpc.analytics.feedback_submit")
    async def _feedback_submit(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_permission(user, "analytics", "update")
            body = AnomalyFeedbackBody.model_validate(c.payload(data))
            reviewer_id = int(user.id) if getattr(user, "id", None) is not None else None
            row = await flows_service.upsert_feedback(
                session,
                tournament_id=body.tournament_id,
                player_id=body.player_id,
                kind=body.kind,
                verdict=body.verdict,
                note=body.note,
                reviewer_user_id=reviewer_id,
            )
            await session.refresh(row)
            response = AnomalyFeedbackRow(
                id=int(row.id),
                tournament_id=row.tournament_id,
                player_id=row.player_id,
                kind=row.kind,
                verdict=row.verdict,
                reviewer_user_id=row.reviewer_user_id,
                note=row.note,
            )
            await session.commit()
            return response

        return await c.envelope(logger, "feedback_submit", op, session_factory=sf)
