"""Guards protecting tournament write-paths from conflicting draft state.

Shared by the duplicated admin update paths in tournament-service and
parser-service (mid-extraction write-path, CG-O6).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from shared.core import http_status as status
from shared.core.enums import DraftStatus
from shared.core.errors import BaseAPIException
from shared.models.balancer.draft import DraftSession

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

__all__ = (
    "assert_no_active_draft_session",
    "has_unfinished_draft_session",
    "unfinished_draft_session_status",
)

_TERMINAL_DRAFT_STATUSES = (DraftStatus.CANCELLED, DraftStatus.COMPLETED)


async def unfinished_draft_session_status(session: AsyncSession, tournament_id: int) -> str | None:
    """Status of the tournament's in-flight draft session, or ``None`` if there is none.

    The single place this SELECT lives. The guard needs the status to name the
    blocker in its error message; the read-side ``roster_locked_by_draft`` flag
    only needs its presence -- so the query returns the status and callers that
    want a boolean go through :func:`has_unfinished_draft_session`.
    """
    return await session.scalar(
        select(DraftSession.status)
        .where(
            DraftSession.tournament_id == tournament_id,
            DraftSession.status.notin_(_TERMINAL_DRAFT_STATUSES),
        )
        .limit(1)
    )


async def has_unfinished_draft_session(session: AsyncSession, tournament_id: int) -> bool:
    """Whether a draft session is in flight, i.e. whether the roster shape is locked."""
    return await unfinished_draft_session_status(session, tournament_id) is not None


async def assert_no_active_draft_session(
    session: AsyncSession, tournament_id: int, *, change: str = "team formation"
) -> None:
    """Raise a business error when the tournament has an in-flight draft session.

    Changing ``team_formation`` -- or the roster shape the draft is picking into
    -- while a draft is in flight would orphan the session (SK-O2), so callers
    invoke this before applying such a change. ``change`` names the edit in the
    error message; its default keeps the original ``team_formation`` wording for
    the callers that predate the parameter.
    """
    active_status = await unfinished_draft_session_status(session, tournament_id)
    if active_status is not None:
        raise BaseAPIException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cannot change {change} while a draft session is active "
                f"(status: {active_status}). Cancel or complete the draft first."
            ),
        )
