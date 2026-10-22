"""``workspace_member_changed``: app-service's membership event drops every listed user's cached RBAC."""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from loguru import logger  # noqa: E402

from shared.messaging.config import WORKSPACE_MEMBER_CHANGED_QUEUE  # noqa: E402
from shared.schemas.events import WorkspaceMemberChangedEvent  # noqa: E402
from src.rpc import workspace_member_events  # noqa: E402
from tests._fakes import CapturingBroker  # noqa: E402


def test_drops_the_cached_rbac_of_every_listed_user(monkeypatch) -> None:
    invalidate = AsyncMock()
    monkeypatch.setattr(workspace_member_events.session_cache, "invalidate_rbac", invalidate)
    broker = CapturingBroker()
    workspace_member_events.register(broker, logger)
    event = WorkspaceMemberChangedEvent(workspace_id=7, auth_user_ids=[3, 11], change="owner_transferred")

    asyncio.run(broker.handlers[WORKSPACE_MEMBER_CHANGED_QUEUE](event.model_dump(mode="json"), SimpleNamespace()))

    assert [call.args for call in invalidate.await_args_list] == [(3,), (11,)]


def test_the_rpc_drops_the_same_users_and_answers(monkeypatch) -> None:
    # app-service waits on this right after committing, so the actor's next
    # request already sees the change; the queued copy is only the fallback.
    invalidate = AsyncMock()
    monkeypatch.setattr(workspace_member_events.session_cache, "invalidate_rbac", invalidate)
    broker = CapturingBroker()
    workspace_member_events.register(broker, logger)
    event = WorkspaceMemberChangedEvent(workspace_id=7, auth_user_ids=[42], change="added")

    handler = broker.handlers["rpc.identity.workspace_member_changed"]
    reply = asyncio.run(handler(event.model_dump(mode="json"), SimpleNamespace()))

    assert reply == {"ok": True, "data": None}
    assert [call.args for call in invalidate.await_args_list] == [(42,)]
    assert asyncio.run(handler({"auth_user_ids": "nope"}, SimpleNamespace()))["ok"] is False
