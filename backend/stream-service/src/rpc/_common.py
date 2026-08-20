"""Shared helpers for the stream-svc typed-RPC handlers.

Re-exports ``shared.rpc.common`` — the gateway envelope/param-decoding
plumbing is identical across every typed-RPC service and lives there as the
single source of truth. Only the helpers these two subjects need are kept:
neither handler takes a JSON body, so there is no ``payload``, and permissions
are workspace-scoped (``shared.rpc.identity.ensure_workspace_permission``)
rather than global, so there is no local ``require_permission``.
"""

from __future__ import annotations

from functools import partial

from shared.rpc.common import (
    actor,
    dump,
    optional_actor,
    q,
    q1,
    require_active,
    require_path_int,
    require_query_int,
)
from shared.rpc.common import (
    envelope as _envelope,
)

__all__ = (
    "q",
    "q1",
    "actor",
    "optional_actor",
    "require_active",
    "require_path_int",
    "require_query_int",
    "dump",
    "envelope",
)

envelope = partial(_envelope, service="stream")
