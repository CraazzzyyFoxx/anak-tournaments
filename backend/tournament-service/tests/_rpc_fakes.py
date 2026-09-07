"""Shared RPC-handler test doubles: a capture-only broker + a stub session maker.

Seven suites across the admin/registration RPC surface (admin match/encounter
serialization, invite preview, pick-ban slot upsert, registration audit,
registration/team image upload, registration status, team image upload) each
carried their own byte-identical copy of ``_CapturingBroker`` -- a FastStream
broker stand-in that records the decorated handler per subject instead of
binding a real queue -- plus, in most of them, an identical ``_FakeSessionMaker``
stub for services whose ``db.async_session_maker`` never needs a populated
session (the service call itself is separately stubbed/mocked).

One definition, imported everywhere -- mirrors app-service's ``_CaptureBroker``/
``RpcHarness`` (see ``app-service/tests/conftest.py``) and this suite's own
``tests/_subscription_fakes.py`` precedent.

A suite that needs a *populated* session (e.g. ``test_registration_audit.py``'s
audit-trail assertions) keeps its own fake session and passes it in via
``FakeSessionMaker(session)`` -- only the maker's ``__call__``/``__aenter__``/
``__aexit__`` plumbing is shared, not the session itself.

``make_identity`` factors out the gateway-identity envelope's constant
baseline (``user_id``/``is_superuser``/``is_active``/empty top-level
``roles``/``permissions``) that every one of these suites repeated verbatim,
varying only the per-scenario ``workspaces`` RBAC grant.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any


class CapturingBroker:
    """Records the handler behind each subject instead of binding a queue."""

    def __init__(self) -> None:
        self.handlers: dict[str, Any] = {}

    def subscriber(self, subject: str, *args: Any, **kwargs: Any):
        def register(fn):
            self.handlers[subject] = fn
            return fn

        return register


class FakeSessionMaker:
    """Stands in for ``db.async_session_maker``.

    Defaults to handing back a ``SimpleNamespace`` whose only member is a no-op
    ``add`` -- fine when the services under test are themselves stubbed/mocked,
    so the session object only has to exist and swallow the audit row every
    mutating handler stages on it. Pass an explicit ``session`` when the handler
    actually reads/writes through it.
    """

    def __init__(self, session: Any | None = None) -> None:
        self._session = session if session is not None else SimpleNamespace(add=lambda _row: None)

    def __call__(self) -> "FakeSessionMaker":
        return self

    async def __aenter__(self) -> Any:
        return self._session

    async def __aexit__(self, *exc: object) -> bool:
        return False


def make_identity(*, workspaces: list[dict] | None = None, **overrides: Any) -> dict[str, Any]:
    """A gateway-shaped identity envelope, defaulting to a non-superuser with no grants.

    ``workspaces`` is the usual per-scenario RBAC grant list; any other field
    (``user_id``, ``username``, ``is_superuser``, ...) can be overridden by
    keyword.
    """
    base: dict[str, Any] = {
        "user_id": 7,
        "is_superuser": False,
        "is_active": True,
        "roles": [],
        "permissions": [],
        "workspaces": workspaces or [],
    }
    base.update(overrides)
    return base
