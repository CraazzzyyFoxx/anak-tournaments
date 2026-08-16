"""Prometheus metrics for the Twitch live-status poller (scraped on :9111).

Poll health is metrics, not ``audit_log``: the journal has a ~300 rows/day budget
(``docs/superpowers/specs/2026-08-12-platform-audit-log-design.md`` §4 NFR 4) and
a tick every 60 seconds would consume it five times over on its own. Only the
manual admin re-poll is audited.

``stream_helix_ratelimit_remaining`` is the one to alert on: the bucket is shared
with identity-service's OAuth logins, so it dropping is a sign-in outage waiting
to happen, not a stream-badge problem.
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge

STREAM_POLL_TICKS_TOTAL = Counter(
    "stream_poll_ticks_total",
    "Twitch live-status poll ticks that ran, by outcome.",
    ("status",),
)

STREAM_CHANNELS_POLLED = Gauge(
    "stream_channels_polled",
    "Distinct channels asked about in the last poll tick (globally deduped).",
)

STREAM_LIVE_CHANNELS = Gauge(
    "stream_live_channels",
    "Channels found live in the last poll tick, across all polled tournaments.",
)

STREAM_HELIX_ERRORS_TOTAL = Counter(
    "stream_helix_errors_total",
    "Twitch Helix failures by taxonomy class.",
    ("kind",),
)

STREAM_HELIX_RATELIMIT_REMAINING = Gauge(
    "stream_helix_ratelimit_remaining",
    "Ratelimit-Remaining reported by the last Helix response (shared app bucket).",
)
