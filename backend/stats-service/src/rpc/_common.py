"""Shared helpers for the stats-service typed-RPC handlers.

Re-exports ``shared.rpc.common`` — the gateway envelope/param-decoding
plumbing is identical across every typed-RPC service and lives there as the
single source of truth.
"""

from __future__ import annotations

from functools import partial

from shared.rpc.common import (
    actor,
    dump,
    identity_user_id,
    optional_actor,
    payload,
    q,
    q1,
    qbool,
    require_active,
    require_id,
    require_path_int,
    require_query_int,
    require_superuser,
)
from shared.rpc.common import (
    envelope as _envelope,
)

__all__ = (
    "identity_user_id",
    "q",
    "q1",
    "qbool",
    "payload",
    "actor",
    "optional_actor",
    "require_active",
    "require_superuser",
    "require_id",
    "require_path_int",
    "require_query_int",
    "dump",
    "envelope",
)

envelope = partial(_envelope, service="stats")
