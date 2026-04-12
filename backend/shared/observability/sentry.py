"""Shared Sentry initialization helpers."""

from __future__ import annotations

from typing import Any

import sentry_sdk
from loguru import logger


def setup_sentry(
    *,
    dsn: str | None,
    environment: str,
    traces_sample_rate: float,
    profiles_sample_rate: float,
    release: str | None = None,
    http_proxy: str | None = None,
    https_proxy: str | None = None,
    proxy_headers: dict[str, str] | None = None,
) -> bool:
    """Initialize Sentry with optional proxy support."""
    if not dsn:
        return False

    init_kwargs: dict[str, Any] = {
        "dsn": dsn,
        "environment": environment,
        "traces_sample_rate": traces_sample_rate,
        "profiles_sample_rate": profiles_sample_rate,
    }
    if release:
        init_kwargs["release"] = release
    if http_proxy:
        init_kwargs["http_proxy"] = http_proxy
    if https_proxy:
        init_kwargs["https_proxy"] = https_proxy
    if proxy_headers:
        init_kwargs["proxy_headers"] = proxy_headers

    sentry_sdk.init(**init_kwargs)
    logger.info(
        "Sentry initialized "
        f"(sampling={traces_sample_rate}, http_proxy={http_proxy}, https_proxy={https_proxy})"
    )
    return True
