"""Read side of the platform audit log (``GET /api/v1/admin/audit``).

The journal is written by ``shared.services.audit.record_audit`` inside each
mutation's own transaction; this module only reads it. One subject serves both
surfaces the design asks for: the workspace-wide feed and the per-entity trail
on a card, which is the same query with ``entity_type``/``entity_id`` set.

The whole security weight of the feature sits in ``_scope`` +
``_filters``. Everything else here is an ordinary paginated admin list.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from faststream.rabbit import RabbitMessage

from shared.core.errors import BaseAPIException as HTTPException
from shared.core.pagination import Paginated
from shared.models.identity.auth_user import AuthUser
from shared.models.platform.audit import AuditLog
from shared.rpc.identity import ensure_workspace_permission
from shared.rpc.query import build_query_model
from src.core import db
from src.schemas.admin import audit as audit_schemas

from . import _common as c

_SF = db.async_session_maker


def _scope(user: AuthUser, workspace_id: int | None) -> int | None:
    """Resolve the single workspace this read is confined to.

    ``None`` means "no workspace predicate", and it is reachable only for a
    superuser — for anyone else an absent ``workspace_id`` is a 422, never a
    platform-wide feed. Falling back to "show everything you may see" would have
    to union the caller's workspaces, and the one row class that has no
    workspace at all (global roles, game catalog, global settings) would then
    have to be excluded by a second rule; requiring the parameter keeps the
    predicate a single equality that cannot accidentally widen.
    """
    if user.is_superuser:
        # A superuser may still narrow to one workspace by passing the param;
        # omitting it is what makes the `workspace_id IS NULL` platform rows
        # visible, and nobody else can reach that state.
        return workspace_id
    if workspace_id is None:
        raise HTTPException(status_code=422, detail="workspace_id is required")
    ensure_workspace_permission(user, workspace_id, "audit", "read")
    return workspace_id


def _filters(workspace_id: int | None, params: audit_schemas.AuditLogListParams) -> list[sa.ColumnElement[bool]]:
    """Build the WHERE clauses with the tenant scope first and unconditionally.

    ``workspace_id`` is the value ``_scope`` already authorized. It is appended
    before every other predicate because the remaining filters narrow *within*
    the scope and are never an alternative route to a row outside it:
    ``entity_type=tournament&entity_id=<someone else's tournament>`` and
    ``actor_user_id=<another workspace's admin>`` must return nothing, not that
    workspace's history. This is the only cross-tenant leak vector in the
    feature, so it is closed by construction rather than by review.
    """
    filters: list[sa.ColumnElement[bool]] = []
    if workspace_id is not None:
        filters.append(AuditLog.workspace_id == workspace_id)
    if params.entity_type is not None:
        filters.append(AuditLog.entity_type == params.entity_type)
    if params.entity_id is not None:
        filters.append(AuditLog.entity_id == params.entity_id)
    if params.action is not None:
        filters.append(AuditLog.action == params.action)
    if params.actor_user_id is not None:
        filters.append(AuditLog.actor_auth_user_id == params.actor_user_id)
    if params.search:
        pattern = f"%{params.search}%"
        filters.append(
            sa.or_(*[getattr(AuditLog, field).ilike(pattern) for field in audit_schemas.AUDIT_SEARCH_FIELDS])
        )
    return filters


def _order_by(params: audit_schemas.AuditLogListParams) -> list[sa.UnaryExpression[Any]]:
    """Primary sort key, then ``id`` in the same direction, always.

    ``created_at`` is ``func.now()`` — the transaction's *start* time — so every
    row written by one transaction carries the identical timestamp. Without a
    unique tiebreaker the database is free to return those rows in any order per
    execution, and offset pagination would then repeat one row on page 2 while
    dropping another entirely. ``id`` is unique and, within a single timestamp,
    monotonic in write order.
    """
    descending = params.descending
    column = getattr(AuditLog, params.sort)
    tiebreak = AuditLog.id.desc() if descending else AuditLog.id.asc()
    if params.sort == "id":
        return [tiebreak]
    return [column.desc() if descending else column.asc(), tiebreak]


def rows_query(workspace_id: int | None, params: audit_schemas.AuditLogListParams) -> sa.Select:
    """The page query: scoped rows plus the actor's current name.

    The join is a strict LEFT OUTER: ``actor_auth_user_id`` carries no foreign
    key by design, so the account may be gone, and an INNER join would delete
    exactly the rows the journal exists to preserve — "who deleted this account"
    would vanish along with the account. The stored ``actor_label`` snapshot
    wins when present; the join only fills rows written before a label existed.
    """
    return (
        sa.select(AuditLog, AuthUser.username)
        .outerjoin(AuthUser, AuthUser.id == AuditLog.actor_auth_user_id)
        .where(*_filters(workspace_id, params))
        .order_by(*_order_by(params))
    )


def count_query(workspace_id: int | None, params: audit_schemas.AuditLogListParams) -> sa.Select:
    """``total`` for the pager. No join: the actor name is not a filter input."""
    return sa.select(sa.func.count()).select_from(AuditLog).where(*_filters(workspace_id, params))


async def list_page(
    session: Any, workspace_id: int | None, params: audit_schemas.AuditLogListParams
) -> Paginated[audit_schemas.AuditLogRead]:
    total = await session.scalar(count_query(workspace_id, params)) or 0
    rows = (await session.execute(params.apply_pagination(rows_query(workspace_id, params)))).all()
    results = [
        audit_schemas.AuditLogRead.model_validate(row, from_attributes=True).model_copy(
            update={"actor_label": row.actor_label or username}
        )
        for row, username in rows
    ]
    return Paginated[audit_schemas.AuditLogRead](
        page=params.page, per_page=params.per_page, total=total, results=results
    )


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.audit_list")
    async def _audit_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            qp = build_query_model(audit_schemas.AuditLogListQueryParams, data.get("query"))
            params = audit_schemas.AuditLogListParams.from_query_params(qp)
            return await list_page(session, _scope(user, params.workspace_id), params)

        return await c.envelope(logger, "audit_list", op, session_factory=_SF)
