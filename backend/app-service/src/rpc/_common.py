"""Shared helpers for the app-service typed-RPC handlers.

Re-exports ``shared.rpc.common`` — the gateway envelope/param-decoding
plumbing is identical across every typed-RPC service and lives there as the
single source of truth. ``require_discipline``/``optional_discipline`` and ``gate_tournament``
(which wraps ``shared.services.tournament.visibility``) are app-service local.
"""

from __future__ import annotations

from functools import partial
from typing import Any

from shared.core import http_status as status
from shared.core.errors import ApiExc, ApiHTTPException
from shared.core.errors import BaseAPIException as HTTPException
from shared.disciplines import DISCIPLINES
from shared.rpc.common import (
    actor,
    dump,
    identity_user_id,
    optional_actor,
    payload,
    q,
    q1,
    q_workspace_id,
    q_workspace_scope,
    qbool,
    require_active,
    require_id,
    require_permission,
    require_query_int,
    require_superuser,
)
from shared.rpc.common import (
    envelope as _envelope,
)
from shared.services.tournament.visibility import ensure_tournament_viewable

__all__ = (
    "identity_user_id",
    "q",
    "q1",
    "q_workspace_scope",
    "q_workspace_id",
    "qbool",
    "payload",
    "actor",
    "optional_actor",
    "gate_tournament",
    "require_active",
    "require_superuser",
    "require_permission",
    "require_id",
    "require_query_int",
    "dump",
    "require_discipline",
    "optional_discipline",
    "envelope",
)

envelope = partial(_envelope, service="app")


#: ``?discipline=all`` (old links, an explicit "every game") reads as no parameter (spec §4.1).
_ALL = "all"


def _installed(raw: str) -> str:
    if raw not in DISCIPLINES:
        raise ApiHTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=[ApiExc(code="discipline_not_installed", msg=f"Discipline {raw!r} is not installed")],
        )
    return raw


def require_discipline(data: dict[str, Any], *, in_path: bool = False) -> str:
    """The request's explicit game, from ``?discipline=`` or the route's ``{discipline}`` segment.

    Absent is a 422 and a code no module declares is a 404 ``discipline_not_installed``: a stats read never falls back
    to a default game and never reads another game's facts under a bogus label.
    """
    raw = data.get("discipline") if in_path else q1(data, "discipline", str, None)
    if not isinstance(raw, str) or not raw.strip():
        raise HTTPException(status_code=422, detail="discipline is required")
    return _installed(raw)


def optional_discipline(data: dict[str, Any], *, in_path: bool = False) -> str | None:
    """A list read's optional game (spec §8.1): absent, empty or ``all`` is every game (``None``).

    Any other value must be an installed game: an unknown code is the same 404 ``discipline_not_installed`` as
    :func:`require_discipline`, never every game's rows under a bogus label.
    """
    raw = data.get("discipline") if in_path else q1(data, "discipline", str, None)
    if not isinstance(raw, str) or not raw.strip() or raw == _ALL:
        return None
    return _installed(raw)


async def gate_tournament(session: Any, data: dict[str, Any], tournament_id: int | None) -> None:
    """404 a hidden tournament for an ineligible viewer.

    No-op when ``tournament_id`` is None (a cross-tournament read with no single
    tournament to gate). The route must be AuthOptional so identity reaches here.
    """
    if tournament_id is None:
        return
    await ensure_tournament_viewable(session, optional_actor(data), int(tournament_id))
