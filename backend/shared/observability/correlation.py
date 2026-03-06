"""Correlation ID middleware for request tracing across services.

Automatically extracts or generates X-Request-ID headers and propagates them
through the entire request chain for distributed tracing.
"""

import uuid
from contextvars import ContextVar
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Context variable to store correlation ID for the current request
correlation_id_ctx: ContextVar[str | None] = ContextVar("correlation_id", default=None)


def get_correlation_id() -> str | None:
    """Get the correlation ID for the current request context.

    Returns:
        Correlation ID string, or None if not in a request context
    """
    return correlation_id_ctx.get()


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Middleware to extract/generate correlation IDs for request tracing.

    - Extracts X-Request-ID from incoming request headers
    - Generates a new UUID if not present
    - Stores in ContextVar for access throughout the request
    - Adds X-Request-ID to response headers
    - Automatically included in structured logs

    Example:
        ```python
        from shared.observability import CorrelationIdMiddleware

        app.add_middleware(CorrelationIdMiddleware)
        ```
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        """Process request with correlation ID tracking."""
        # Extract correlation ID from header or generate new one
        correlation_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

        # Store in context for access in handlers and logging
        correlation_id_ctx.set(correlation_id)

        # Process request
        response = await call_next(request)

        # Add correlation ID to response headers
        response.headers["X-Request-ID"] = correlation_id

        return response
