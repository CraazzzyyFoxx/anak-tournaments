"""The rule-users list must ship the full pagination envelope, not a subset.

A reply carrying only ``{total, results}`` leaves the client guessing which
page it just got, so paging controls silently render against page 1 forever.
Driven through the real subscriber; the two queries are stubbed, no DB.
"""

from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.rpc import achievements as achievements_rpc
from tests._fakes import FakeBroker, active_identity, session_factory


def test_rule_users_reply_carries_page_and_per_page(monkeypatch: pytest.MonkeyPatch) -> None:
    session = SimpleNamespace(
        scalar=AsyncMock(return_value=0),
        execute=AsyncMock(return_value=SimpleNamespace(all=lambda: [])),
    )
    monkeypatch.setattr(achievements_rpc, "_SF", session_factory(session))
    monkeypatch.setattr(achievements_rpc._rule_repo, "get", AsyncMock(return_value=SimpleNamespace(workspace_id=5)))

    broker = FakeBroker()
    achievements_rpc.register(broker, logging.getLogger("achievement-rpc-tests"))
    reply = asyncio.run(
        broker.handlers["rpc.parser.ach.rule_users"](
            {
                "identity": active_identity(),
                "workspace_id": 5,
                "rule_id": 3,
                "query": {"page": ["2"], "per_page": ["7"]},
            },
            None,
        )
    )

    assert reply["ok"], reply
    # Echoed from the request, so the client can trust what it is looking at.
    assert (reply["data"]["page"], reply["data"]["per_page"]) == (2, 7)
    assert (reply["data"]["total"], reply["data"]["results"]) == (0, [])
