"""Human-readable docs (summary + description) for stream-service RPC subjects,
merged into the gateway's OpenAPI by the export script. Keyed by RPC subject.
Prose only — types live in openapi_schemas.py. The gateway appends the RPC subject
footer itself.
"""

from __future__ import annotations

DOCS: dict[str, dict] = {
    "rpc.stream.tournament_streams": {
        "summary": "Get tournament streams",
        "description": (
            "Returns the tournament's stream block: official broadcast links from its typed links "
            "(included whether or not they are on air) and the participant channels that are live "
            "right now. Public; a hidden tournament answers 404 for an ineligible viewer. Twitch "
            "channels report live true/false; YouTube and other hosts report live null, meaning "
            "there is no live detection for them rather than offline."
        ),
    },
    "rpc.stream.repoll": {
        "summary": "Re-poll tournament streams",
        "description": (
            "Clears the live-status poll cursor so the next scheduler heartbeat polls immediately "
            "(202 Accepted — no poll runs inline). Requires stream-update permission on the "
            "workspace that owns the tournament, and is recorded in the audit log."
        ),
    },
}
