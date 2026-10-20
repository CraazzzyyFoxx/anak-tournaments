"""The Redis channel namespace for realtime frames.

Topic STRINGS are built by ``shared.services.realtime.Scope`` — the one place
their format lives. This module holds only the channel prefix the gateway's
``PSUBSCRIBE realtime:*`` binds to (``gateway/internal/events/events.go``): a
transport detail, not part of any topic.
"""

from __future__ import annotations

__all__ = ("REALTIME_CHANNEL_PREFIX", "realtime_channel")

REALTIME_CHANNEL_PREFIX = "realtime:"


def realtime_channel(topic: str) -> str:
    return f"{REALTIME_CHANNEL_PREFIX}{topic}"
