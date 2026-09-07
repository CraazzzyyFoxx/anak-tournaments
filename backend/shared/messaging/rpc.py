"""Request/reply over RabbitMQ, decoded.

``broker.request()`` returns the whole *message* (so middlewares run and the
caller can read headers/correlation id), NOT the handler's return value -- see
the FastStream 0.5 release notes that removed the old ``publish(rpc=True)``
which did return a bare body. A caller that treats the result as the payload
gets a ``RabbitMessage`` and silently takes its "RPC unavailable" branch, which
is exactly how the Discord entity endpoints came to answer with empty lists in
production while their unit tests -- mocking ``request`` with a plain dict --
stayed green.

``request_dict`` decodes the JSON object. ``request_rpc`` additionally requires
the shared ``{ok, data, error, warnings?}`` envelope every worker is supposed
to return; a raw dict without ``ok`` is ``None`` (same as a non-object body).
"""

from __future__ import annotations

from typing import Any

from shared.schemas.rpc import RpcReply, parse_rpc

__all__ = ("request_dict", "request_rpc")


async def request_dict(
    broker: Any,
    payload: Any,
    queue: Any,
    *,
    timeout: float = 5.0,
) -> dict[str, Any] | None:
    """Send an RPC request and return the decoded object reply.

    ``None`` means "no usable answer": the peer replied with a non-object body.
    Transport failures and timeouts still raise -- a caller that wants to fall
    back must say so explicitly.
    """
    response = await broker.request(payload, queue, timeout=timeout)
    decoded = await response.decode()
    return decoded if isinstance(decoded, dict) else None


async def request_rpc(
    broker: Any,
    payload: Any,
    queue: Any,
    *,
    timeout: float = 5.0,
) -> RpcReply | None:
    """``request_dict`` plus envelope decode. ``None`` if the body is not an envelope."""
    decoded = await request_dict(broker, payload, queue, timeout=timeout)
    return parse_rpc(decoded) if decoded is not None else None
