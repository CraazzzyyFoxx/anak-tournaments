"""RPC reply envelope shared by every headless service reached over RabbitMQ.

Every RPC handler returns this envelope; the gateway maps ``error.code`` to an
HTTP status. A single shape keeps the Go side simple and preserves each domain's
HTTP contract status codes.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

# Error codes -> HTTP status are mapped on the gateway side:
#   unauthorized->401, forbidden->403, bad_request->400, not_found->404,
#   conflict->409, gone->410, unprocessable->422, payload_too_large->413,
#   rate_limited->429, unavailable->503, internal->500
#
# Both sides degrade safely: an unknown code becomes 500 on the gateway, which is
# what every code here did before it was added.
ERROR_CODES = frozenset(
    {
        "unauthorized",
        "forbidden",
        "bad_request",
        "not_found",
        "conflict",
        "gone",
        "unprocessable",
        "payload_too_large",
        "rate_limited",
        # A dependency the worker needs is down and the operation deliberately
        # fails closed rather than running unmetered. Distinct from ``internal``
        # because the correct client behaviour is "retry shortly", not "give up".
        "unavailable",
        "internal",
    }
)


def rpc_ok(data: Any) -> dict[str, Any]:
    return {"ok": True, "data": data}


# Recognized ``details`` keys (anything else the gateway passes through verbatim):
#   retry_after -> int seconds; the gateway re-emits it as the HTTP Retry-After
#     header, which a RabbitMQ worker has no way to set itself.
#   fields -> list of {"field": str|null, "msg": str, "code": str}; the per-item
#     machine codes that a flattened human ``message`` cannot carry.
def rpc_error(code: str, message: str, details: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Error envelope. ``message`` stays human; machine data rides ``details``.

    An empty ``details`` is omitted rather than sent as ``{}``/``null``: the
    gateway reads presence as "there is structured data here", so an always-present
    empty object would make every plain error look like it carried some.
    """
    error: dict[str, Any] = {"code": code, "message": message}
    if details:
        error["details"] = dict(details)
    return {"ok": False, "error": error}


def status_to_code(http_status: int) -> str:
    """Map a FastAPI HTTPException status to an envelope error code."""
    return {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        410: "gone",
        413: "payload_too_large",
        422: "unprocessable",
        429: "rate_limited",
        503: "unavailable",
    }.get(http_status, "internal")
