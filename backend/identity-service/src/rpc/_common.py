"""Envelope + param helpers shared by the identity typed-RPC handlers.

Identity predates ``shared.rpc.common`` and its gateway contract is a different
shape: most methods take a flat ``data`` dict rather than the
``{payload, query, identity}`` envelope, and the caller arrives as a bearer
``data["access_token"]`` this service resolves itself instead of a gateway-
injected identity block. So these stay identity-local; the reply envelope
itself (``rpc_ok``/``rpc_error``/``status_to_code``) is the shared one.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import BaseAPIException as HTTPException
from src.core import db
from src.schemas.rpc import rpc_error, rpc_ok, status_to_code
from src.services.token_validation import token_validation

__all__ = (
    "envelope",
    "envelope_session",
    "with_active_user",
    "opt_int",
    "require_int",
    "paginated_dump",
)


def _validation_detail(exc: ValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "validation error"
    first = errors[0]
    loc = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
    msg = first.get("msg", "invalid value")
    return f"{loc}: {msg}" if loc else msg


async def envelope(
    logger: Any,
    label: str,
    op: Callable[[], Awaitable[Any]],
    *,
    failure: str = "internal error",
) -> dict:
    """Run an RPC body and map every outcome onto the reply envelope.

    One place decides how a domain error, a schema error and an unexpected crash
    each look on the wire, so no handler can drift from the mapping the gateway
    asserts on.
    """
    try:
        return rpc_ok(await op())
    except ValidationError as exc:
        return rpc_error("unprocessable", _validation_detail(exc))
    except HTTPException as exc:
        return rpc_error(status_to_code(exc.status_code), str(exc.detail))
    except Exception:  # pragma: no cover - defensive worker guard
        logger.exception(f"{label} RPC failed")
        return rpc_error("internal", failure)


async def envelope_session(
    logger: Any,
    label: str,
    op: Callable[[AsyncSession], Awaitable[Any]],
    *,
    failure: str = "internal error",
) -> dict:
    """``envelope`` with a database session scoped to the call."""

    async def run() -> Any:
        async with db.async_session_maker() as session:
            return await op(session)

    return await envelope(logger, label, run, failure=failure)


async def with_active_user(
    logger: Any,
    access_token: Any,
    op: Callable[[AsyncSession, Any], Awaitable[Any]],
    *,
    label: str = "authenticated",
) -> dict:
    """Resolve the active user from a bearer access token, run op, map errors.

    Shared by every authenticated RPC method. A missing or non-string token is
    rejected before any database work — the gateway only omits it for anonymous
    callers, so this is not an error worth a round trip.
    """
    if not access_token or not isinstance(access_token, str):
        return rpc_error("forbidden", "Not authenticated")

    async def run(session: AsyncSession) -> Any:
        user = await token_validation.resolve_active_user(session, access_token)
        return await op(session, user)

    return await envelope_session(logger, label, run)


def opt_int(data: dict, key: str) -> int | None:
    raw = data.get(key)
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{key} must be an integer")


def require_int(data: dict, key: str) -> int:
    value = opt_int(data, key)
    if value is None:
        raise HTTPException(status_code=422, detail=f"{key} is required")
    return value


def paginated_dump(res: dict) -> dict:
    """Serialize a service-layer ``{results, total, page, per_page}`` envelope.

    ``results`` holds Pydantic models; everything else is passed through (so an
    optional ``counts`` model is serialized too).
    """
    out: dict[str, Any] = {
        "results": [item.model_dump(mode="json") for item in res["results"]],
        "total": res["total"],
        "page": res["page"],
        "per_page": res["per_page"],
    }
    counts = res.get("counts")
    if counts is not None:
        out["counts"] = counts.model_dump(mode="json")
    return out
