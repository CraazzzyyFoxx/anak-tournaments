"""Shared admin-RPC test doubles for parser-service.

``active_identity``, ``FakeBroker``, and ``session_factory`` used to be
hand-rolled near-identically in every admin-RPC test module. One definition,
imported everywhere -- mirrors identity-service's ``tests/_fakes.py``
precedent.
"""

from __future__ import annotations

from typing import Any


def active_identity() -> dict[str, Any]:
    """A gateway identity payload for an active admin user (permissions stubbed)."""
    return {
        "user_id": 7,
        "sub": "7",
        "is_active": True,
        "is_superuser": True,
        "roles": ["admin"],
        "permissions": [],
    }


class FakeBroker:
    """Records the handler behind each subject instead of binding a queue."""

    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def subscriber(self, subject: str):
        def register(fn):
            self.handlers[subject] = fn
            return fn

        return register


def session_factory(session: Any):
    """A zero-arg callable producing a minimal async-context-manager session stand-in."""

    class _Ctx:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *exc: object) -> bool:
            return False

    return lambda: _Ctx()
