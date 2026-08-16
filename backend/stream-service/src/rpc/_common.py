"""Shared helpers for the stream-svc typed-RPC handlers.

Mirrors the analytics/app-service ``src/rpc/_common.py`` envelope and param
helpers so both stream subjects decode the gateway request the same way
(``data["<path param>"]`` / ``data["query"][k]=[...]`` / ``data["identity"]``)
and emit the one ``{ok,data,error}`` envelope the gateway understands.

Only the helpers these two subjects need are kept: neither handler takes a JSON
body, so there is no ``payload``, and permissions are workspace-scoped
(``shared.rpc.identity.ensure_workspace_permission``) rather than global, so
there is no local ``require_permission``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import ValidationError

from shared.core.errors import BaseAPIException as HTTPException
from shared.models.identity.auth_user import AuthUser
from shared.rpc.identity import MissingIdentityError, rehydrate_user, rehydrate_user_optional
from shared.schemas.rpc import rpc_error, rpc_ok, status_to_code


def q(data: dict[str, Any], key: str) -> list[str] | None:
    vals = (data.get("query") or {}).get(key)
    if vals is None:
        return None
    return vals if isinstance(vals, list) else [vals]


def q1(data: dict[str, Any], key: str, cast: Callable[[str], Any] = str, default: Any = None) -> Any:
    vals = q(data, key)
    if not vals:
        return default
    try:
        return cast(vals[0])
    except (TypeError, ValueError):
        return default


def actor(data: dict[str, Any]) -> AuthUser:
    """Rehydrate the gateway-injected identity into a transient AuthUser.

    Raises ``MissingIdentityError`` if the gateway did not inject identity
    (the envelope helper maps that to ``unauthorized``).
    """
    return rehydrate_user(data.get("identity"))


def optional_actor(data: dict[str, Any]) -> AuthUser | None:
    """Rehydrate identity for ``AuthNone``/``AuthOptional`` reads; None when anonymous.

    The public stream read is reachable without a token, so the viewer passed to
    ``assert_tournament_viewable`` is legitimately ``None`` — that is what makes
    a hidden tournament 404 for an outsider.
    """
    return rehydrate_user_optional(data.get("identity"))


def require_active(user: AuthUser) -> None:
    """Mirror ``get_current_active_user``: reject inactive users with 403."""
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Inactive user")


def require_path_int(data: dict[str, Any], key: str) -> int:
    """Read a ``RouteSpec.Path`` param, which the gateway copies to the body by name.

    Distinct from ``require_query_int``: ``{tournament_id}`` arrives as
    ``data["tournament_id"]``, not under ``data["query"]``.
    """
    try:
        return int(data[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{key} is required") from exc


def require_query_int(data: dict[str, Any], key: str) -> int:
    value = q1(data, key, int)
    if value is None:
        raise HTTPException(status_code=422, detail=f"{key} is required")
    return value


def dump(obj: Any, exclude_none: bool) -> Any:
    if obj is None:
        return None
    if isinstance(obj, list):
        return [dump(x, exclude_none) for x in obj]
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=exclude_none)
    return obj


def _detail_message(exc: HTTPException) -> str:
    """Flatten an HTTPException detail into a clean string.

    ``ApiHTTPException`` carries ``detail`` as a ``list[{msg, code}]``; the
    gateway emits ``{"detail": "<string>"}`` either way, so join the ``msg``
    fields instead of leaking a Python list repr. The HTTP status survives via
    ``status_to_code(exc.status_code)``.
    """
    detail = exc.detail
    if isinstance(detail, list):
        msgs = [str(d.get("msg")) for d in detail if isinstance(d, dict) and d.get("msg")]
        return "; ".join(msgs) if msgs else "error"
    return str(detail)


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
    except MissingIdentityError as exc:
        return rpc_error("unauthorized", str(exc) or "Not authenticated")
    except HTTPException as exc:
        return rpc_error(status_to_code(exc.status_code), _detail_message(exc))
    except ValidationError as exc:
        return rpc_error("unprocessable", str(exc))
    except Exception:  # pragma: no cover - defensive worker guard
        logger.exception("stream rpc failed: %s", label)
        return rpc_error("internal", "internal error")
