"""Request/reply over RabbitMQ, decoded.

``broker.request()`` returns the whole *message* (so middlewares run and the
caller can read headers/correlation id), NOT the handler's return value -- see
the FastStream 0.5 release notes that removed the old ``publish(rpc=True)``
which did return a bare body. A caller that treats the result as the payload
gets a ``RabbitMessage`` and silently takes its "RPC unavailable" branch, which
is exactly how the Discord entity endpoints came to answer with empty lists in
production while their unit tests -- mocking ``request`` with a plain dict --
stayed green.

``request_dict`` is therefore the only sanctioned way to call an RPC handler
that answers with a JSON object: it decodes, and it returns ``None`` for
anything that is not a mapping so every call site has one obvious failure
branch instead of an ``isinstance`` check it can forget.
"""

from __future__ import annotations

from typing import Any

__all__ = ("request_dict",)


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
