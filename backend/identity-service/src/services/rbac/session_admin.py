from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import pagination
from src import models, schemas
from src.services.rbac_policy import RbacPolicy, rbac_policy
from src.services.sessions import SessionService, sessions

_SESSION_SORT_KEYS = frozenset({"login_at", "last_seen_at", "expires_at", "status"})


def _sort_session_summaries(
    summaries: Sequence[dict],
    sort: str,
    order: pagination.SortOrder | str,
) -> list[dict]:
    """Stable-sort aggregated session summaries by a whitelisted key.

    Logical sessions are aggregated from refresh tokens in Python, so sorting
    happens here (not in SQL). Falls back to ``last_seen_at`` for unknown keys.
    """
    key_name = sort if sort in _SESSION_SORT_KEYS else "last_seen_at"
    reverse = order == pagination.SortOrder.DESC or order == "desc"
    _min_dt = datetime.min.replace(tzinfo=UTC)

    if key_name == "status":

        def key(summary: dict) -> tuple:
            return (summary.get("status") or "",)
    else:

        def key(summary: dict) -> tuple:
            return (summary.get(key_name) or _min_dt,)

    return sorted(summaries, key=key, reverse=reverse)


class SessionAdminService:
    """The superuser session inventory across every auth account."""

    def __init__(
        self,
        *,
        policy: RbacPolicy = rbac_policy,
        session_reader: SessionService = sessions,
    ) -> None:
        self._policy = policy
        self._sessions = session_reader

    async def list_auth_sessions(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
        params: schemas.SessionListParams,
    ) -> dict:
        """List logical auth sessions across all users (superuser only, paginated).

        Aggregation/status derivation stay in Python; sort + pagination are applied
        to the aggregated summaries, and ``total`` reflects the filtered set.
        """
        self._policy.require_superuser(current_user)
        summaries = await self._sessions.list_all_sessions(
            session,
            user_id=params.user_id,
            search=params.search,
            status=params.status,
        )
        summaries = _sort_session_summaries(summaries, params.sort, params.order)
        total = len(summaries)
        page_items = params.paginate_data(summaries)
        return pagination.paginated_dict(
            [schemas.AdminSessionRead.model_validate(summary) for summary in page_items], total, params
        )


session_admin = SessionAdminService()
