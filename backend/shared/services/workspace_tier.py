"""Workspace trust tier — the one gate check for self-service workspaces.

Lives in ``shared`` because three services read it: app-service (public
listing), analytics-service (GPU compute gate) and parser-service (deferred
achievement recompute), mirroring why ``ensure_workspace_permission`` lives in
``shared.rpc.identity``.

Pure by design: no session parameter, no query, no auto-upgrade. A workspace
leaves ``unverified`` only through ``rpc.app.workspaces.verification_set``
(superuser-only). See
``docs/superpowers/specs/2026-08-26-workspace-self-service-design.md`` §4.3.
"""

from __future__ import annotations

from typing import Any

__all__ = ("VERIFICATION_STATUSES", "is_verified_or_trusted")

# Convention, not a DB constraint (the column is a plain ``String(16)``).
VERIFICATION_STATUSES = ("unverified", "verified", "trusted")


def is_verified_or_trusted(workspace: Any) -> bool:
    """May this workspace use metered resources (GPU compute, inline
    full-history achievement recompute) and appear in the public directory?

    One bar for both since 2026-09-07: ``trusted`` is now a badge on the public
    card, not a separate admission gate (design §4.5)."""
    return workspace.verification_status in ("verified", "trusted")
