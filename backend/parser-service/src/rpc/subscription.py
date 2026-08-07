"""Typed-RPC handlers for subscription-collection admin.

The subscription counterpart of ``rpc/rank.py``: collection health, the
append-only check history, per-player entitlement state and a manual re-check.
Every handler requires the global ``admin`` role, gated inline exactly as the rank
admin handlers do (there is no ``require_role`` helper in ``_common``).
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core.errors import BaseAPIException as HTTPException
from src.core import db
from src.core.config import settings
from src.schemas.admin import subscription_collection as sc_schemas
from src.services.subscription_collection import admin as subscription_admin

from . import _common as c
from ._clients import realtime_redis

_SF = db.async_session_maker


def _require_admin(data: dict) -> None:
    user = c.actor(data)
    c.require_active(user)
    if not user.has_role("admin"):
        raise HTTPException(status_code=403, detail="Role required: admin")


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.parser.subscription.stats")
    async def _stats(data: dict, msg: RabbitMessage) -> dict:
        # GET /admin/subscriptions/stats — require_role("admin").
        async def op(session: Any) -> Any:
            _require_admin(data)
            result = await subscription_admin.get_collection_stats(session)
            return sc_schemas.SubscriptionCollectionStats.model_validate(result)

        return await c.envelope(logger, "subscription.stats", op, session_factory=_SF)

    @broker.subscriber("rpc.parser.subscription.check_log")
    async def _check_log(data: dict, msg: RabbitMessage) -> dict:
        # GET /admin/subscriptions/check-log — require_role("admin").
        async def op(session: Any) -> Any:
            _require_admin(data)
            rows = await subscription_admin.list_check_log(
                session,
                state=c.q1(data, "state"),
                source=c.q1(data, "source"),
                provider=c.q1(data, "provider"),
                user_id=c.q1(data, "user_id", int),
                before_id=c.q1(data, "before_id", int),
                limit=c.q1(data, "limit", int, 50),
            )
            return [sc_schemas.SubscriptionCheckLogRead.model_validate(row) for row in rows]

        return await c.envelope(logger, "subscription.check_log", op, session_factory=_SF)

    @broker.subscriber("rpc.parser.subscription.user_collection")
    async def _user_collection(data: dict, msg: RabbitMessage) -> dict:
        # GET /admin/subscriptions/users/{user_id}/collection — require_role("admin").
        async def op(session: Any) -> Any:
            _require_admin(data)
            rows = await subscription_admin.get_user_collection_status(session, c.require_id(data))
            return [sc_schemas.SubscriptionUserCollectionRead.model_validate(row) for row in rows]

        return await c.envelope(logger, "subscription.user_collection", op, session_factory=_SF)

    @broker.subscriber("rpc.parser.subscription.collect")
    async def _collect(data: dict, msg: RabbitMessage) -> dict:
        # POST /admin/subscriptions/collect — require_role("admin").
        async def op(session: Any) -> Any:
            _require_admin(data)
            body = sc_schemas.SubscriptionCollectTriggerRequest.model_validate(c.payload(data))
            checked = await subscription_admin.trigger_collection(
                session,
                user_id=body.user_id,
                providers=body.providers,
                discord_bot_token=settings.discord_token,
                twitch_client_id=settings.twitch_client_id,
                broker=broker,
                proxy=settings.proxy_url,
                redis=realtime_redis,
            )
            return sc_schemas.SubscriptionCollectTriggerResponse(checked=checked)

        return await c.envelope(logger, "subscription.collect", op, session_factory=_SF)
