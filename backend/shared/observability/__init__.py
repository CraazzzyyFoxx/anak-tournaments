"""Observability utilities for microservices.

This module provides:
- Structured logging with Loguru
- Correlation ID middleware for request tracing
- OpenTelemetry distributed tracing
- Enhanced health checks for dependencies
- Shared time middleware
"""

from .logging import setup_logging, get_logger
from .correlation import CorrelationIdMiddleware, get_correlation_id
from .tracing import setup_tracing, instrument_fastapi, instrument_sqlalchemy
from .health import check_postgres, check_redis, check_rabbitmq
from .time_middleware import TimeMiddleware

__all__ = [
    "setup_logging",
    "get_logger",
    "CorrelationIdMiddleware",
    "get_correlation_id",
    "setup_tracing",
    "instrument_fastapi",
    "instrument_sqlalchemy",
    "check_postgres",
    "check_redis",
    "check_rabbitmq",
    "TimeMiddleware",
]
