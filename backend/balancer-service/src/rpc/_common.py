"""Shared helpers for the balancer-service typed-RPC handlers.

The gateway envelope/param-decoding plumbing this shares with the other
typed-RPC services (``q``/``q1``/``payload``/``actor``/``require_active``/
``require_id``/``dump``/``require_path_int``) now lives in
``shared.rpc.common``, the single source of truth. Everything below that is
genuinely balancer-local: API-key-vs-workspace-RBAC admin gating, the
dict-detail ``_detail_message`` variant the job API needs, and the
session-less ``call`` envelope (the job API uses the Redis-backed job store +
broker, not a SQLAlchemy session).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import ValidationError

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.identity.auth_user import AuthUser
from shared.rpc.common import (
    actor,
    dump,
    payload,
    q,
    q1,
    require_active,
    require_id,
)
from shared.rpc.common import (
    require_path_int as path_int,
)
from shared.rpc.identity import MissingIdentityError, ensure_workspace_permission
from shared.schemas.rpc import rpc_error, rpc_ok, status_to_code

__all__ = (
    "q",
    "q1",
    "payload",
    "actor",
    "is_api_key_identity",
    "require_workspace_permission",
    "require_active",
    "active_actor",
    "require_admin_panel",
    "require_id",
    "path_int",
    "dump",
    "envelope",
    "call",
)


def is_api_key_identity(data: dict[str, Any]) -> bool:
    return (data.get("identity") or {}).get("credential_type") == "api_key"


def require_workspace_permission(
    data: dict[str, Any], user: AuthUser, workspace_id: int, resource: str, action: str
) -> None:
    """Imperative form of ``src/core/auth.py::_require_workspace_permission``.

    API keys are rejected from balancer admin endpoints (same 403 as the HTTP
    dependency), then the workspace RBAC is checked.
    """
    if is_api_key_identity(data):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API keys cannot access balancer admin endpoints",
        )
    ensure_workspace_permission(user, workspace_id, resource, action)


def active_actor(data: dict[str, Any]) -> AuthUser:
    """Rehydrate identity and enforce the active check.

    Every authenticated balancer/draft endpoint resolves through
    ``get_current_active_user``, so handlers use this instead of bare ``actor``.
    """
    user = actor(data)
    require_active(user)
    return user


def require_admin_panel(user: AuthUser) -> None:
    """Mirror the admin balancer router-level ``require_admin_panel_access()`` gate.

    Same check + same 403 detail as ``shared.core.auth``'s dependency so the error
    body is byte-identical to the HTTP service.
    """
    if not user.has_admin_panel_access():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin panel access requires a non-read permission",
        )


def _detail_message(exc: HTTPException) -> str:
    """Flatten an HTTPException detail into a clean string.

    ``ApiHTTPException`` carries ``detail`` as a ``list[{msg, code}]``; the gateway
    emits ``{"detail": "<string>"}`` either way, so join the ``msg`` fields. Dict
    details (the job API uses ``{"code": ..., "max_*": ...}``) are passed through
    as-is so the structured error survives.
    """
    detail = exc.detail
    if isinstance(detail, list):
        msgs = [str(d.get("msg")) for d in detail if isinstance(d, dict) and d.get("msg")]
        return "; ".join(msgs) if msgs else "error"
    if isinstance(detail, dict):
        import json

        return json.dumps(detail)
    return str(detail)


def _map_error(logger: Any, label: str, exc: Exception) -> dict[str, Any]:
    if isinstance(exc, MissingIdentityError):
        return rpc_error("unauthorized", str(exc) or "Not authenticated")
    if isinstance(exc, HTTPException):
        return rpc_error(status_to_code(exc.status_code), _detail_message(exc))
    if isinstance(exc, ValidationError):
        return rpc_error("unprocessable", str(exc))
    logger.exception("balancer rpc failed: %s", label)
    return rpc_error("internal", "internal error")


async def envelope(
    logger: Any,
    label: str,
    op: Callable[[Any], Awaitable[Any]],
    *,
    session_factory: Callable[[], Any],
    exclude_none: bool = False,
) -> dict[str, Any]:
    """Run ``op`` inside a DB session and wrap the result/exception in the envelope."""
    try:
        async with session_factory() as session:
            return rpc_ok(dump(await op(session), exclude_none))
    except Exception as exc:  # noqa: BLE001 — mapped to the envelope below
        return _map_error(logger, label, exc)


async def call(
    logger: Any,
    label: str,
    op: Callable[[], Awaitable[Any]],
    *,
    exclude_none: bool = False,
) -> dict[str, Any]:
    """Run a session-less ``op`` and wrap the result/exception in the envelope.

    For handlers that don't touch the DB (the job API uses the Redis-backed job
    store + broker, not a SQLAlchemy session).
    """
    try:
        return rpc_ok(dump(await op(), exclude_none))
    except Exception as exc:  # noqa: BLE001 — mapped to the envelope below
        return _map_error(logger, label, exc)
