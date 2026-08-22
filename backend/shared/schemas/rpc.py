"""RPC reply envelope shared by every headless service reached over RabbitMQ.

Every RPC handler returns this envelope; the gateway maps ``error.code`` to an
HTTP status. A single shape keeps the Go side simple and preserves each domain's
HTTP contract status codes.
"""

from __future__ import annotations

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


def rpc_error(code: str, message: str) -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, "message": message}}


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
