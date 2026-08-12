"""Read contract of the platform audit log (``rpc.app.audit_list``).

Two things are checked here, and only one of them is bookkeeping.

The bookkeeping: the subject is registered, documented and typed — each of
those fails silently otherwise (an unregistered subject is a gateway timeout, a
missing manifest entry is a generic ``object`` in the published spec).

The part that matters: the workspace scope. It is the only cross-tenant leak
vector in the feature, because the feed accepts ``entity_type``/``entity_id``
and ``actor_user_id`` — three ways to name a row directly. Those filters must
narrow *within* the authorized workspace and never reach past it. The
assertions are made against compiled SQL rather than a populated database so
they hold in a unit run and state the invariant as a predicate rather than as
an absence of rows, which a bad fixture could fake.
"""

import asyncio
import logging

import pytest
from sqlalchemy.dialects import postgresql

from shared.models.platform.audit import AuditLog
from shared.rpc.identity import rehydrate_user
from shared.rpc.query import build_query_model
from src import openapi_docs, openapi_schemas
from src.rpc import audit as audit_rpc
from src.schemas.admin import audit as audit_schemas
from tests.conftest import _CaptureBroker, build_query

_SUBJECT = "rpc.app.audit_list"

_SUPERUSER = {"user_id": 1, "is_superuser": True, "is_active": True}

# Workspace 7 organizer holding audit.read there and nothing anywhere else.
# `rbac_roles` deliberately excludes owner/admin: those roles grant every
# non-governance action in the workspace, which would make the 403 case below
# pass for the wrong reason.
_ORGANIZER = {
    "user_id": 2,
    "is_superuser": False,
    "is_active": True,
    "workspaces": [
        {"workspace_id": 7, "rbac_roles": ["member"], "rbac_permissions": [{"resource": "audit", "action": "read"}]}
    ],
}

_ORGANIZER_WITHOUT_AUDIT_READ = {
    "user_id": 3,
    "is_superuser": False,
    "is_active": True,
    "workspaces": [
        {"workspace_id": 7, "rbac_roles": ["member"], "rbac_permissions": [{"resource": "team", "action": "read"}]}
    ],
}


def _call(identity: dict, **params) -> dict:
    """Dispatch the real handler and return the RPC envelope.

    No database is touched: every case here is rejected by the scope gate before
    a statement is emitted, and an unused AsyncSession never opens a connection.
    """
    broker = _CaptureBroker()
    audit_rpc.register(broker, logging.getLogger("audit-tests"))
    handler = broker.handlers[_SUBJECT]
    return asyncio.run(handler({"identity": identity, "query": build_query(params)}, None))


def _params(**overrides) -> audit_schemas.AuditLogListParams:
    """Build list params through the same query-model path the handler uses."""
    qp = build_query_model(audit_schemas.AuditLogListQueryParams, build_query(overrides))
    return audit_schemas.AuditLogListParams.from_query_params(qp)


def _compiled(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


# --- manifest wiring ------------------------------------------------------


def test_the_subject_is_registered() -> None:
    broker = _CaptureBroker()
    audit_rpc.register(broker, logging.getLogger("audit-tests"))
    assert set(broker.handlers) == {_SUBJECT}


def test_the_subject_is_documented() -> None:
    assert openapi_docs.DOCS[_SUBJECT]["summary"]


def test_the_subject_is_typed() -> None:
    # Missing here => generic `object` in gateway/internal/openapi/schemas.json.
    assert openapi_schemas.OPERATIONS[_SUBJECT].query is audit_schemas.AuditLogListQueryParams


def test_the_filter_set_is_exactly_the_designed_ten() -> None:
    # The design cut this from eleven filters to five plus pagination; a
    # reinstated date range or `source` select should fail here first.
    assert set(audit_schemas.AuditLogListQueryParams.model_fields) == {
        "workspace_id",
        "entity_type",
        "entity_id",
        "action",
        "actor_user_id",
        "page",
        "per_page",
        "sort",
        "order",
        "search",
        # Inherited from PaginationQueryParams, not part of the documented set.
        "entities",
        "only_count",
    }


def test_the_read_model_carries_every_stored_column() -> None:
    stored = {column.key for column in AuditLog.__table__.columns}
    assert stored <= set(audit_schemas.AuditLogRead.model_fields)


# --- the scope gate -------------------------------------------------------


def test_a_non_superuser_without_workspace_id_is_rejected_not_shown_everything() -> None:
    envelope = _call(_ORGANIZER)
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "unprocessable"  # 422


def test_a_non_superuser_without_audit_read_is_forbidden() -> None:
    envelope = _call(_ORGANIZER_WITHOUT_AUDIT_READ, workspace_id=7)
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "forbidden"  # 403


def test_a_non_superuser_cannot_read_a_workspace_they_are_not_in() -> None:
    envelope = _call(_ORGANIZER, workspace_id=8)
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "forbidden"


def test_a_superuser_may_omit_the_workspace() -> None:
    assert audit_rpc._scope(rehydrate_user(_SUPERUSER), None) is None


def test_a_superuser_may_still_narrow_to_one_workspace() -> None:
    assert audit_rpc._scope(rehydrate_user(_SUPERUSER), 7) == 7


# --- the scope is not bypassable ------------------------------------------


def test_an_entity_filter_narrows_within_the_scope_it_does_not_replace_it() -> None:
    # entity_type+entity_id names a row directly. Pointed at another tenant's
    # tournament it must return nothing, so both predicates have to survive.
    sql = _compiled(audit_rpc.rows_query(7, _params(entity_type="tournament", entity_id=999)))
    assert "audit_log.workspace_id = 7" in sql
    assert "audit_log.entity_type = 'tournament'" in sql
    assert "audit_log.entity_id = 999" in sql


def test_an_actor_filter_narrows_within_the_scope_it_does_not_replace_it() -> None:
    # Same for "show me what that admin did": scoped, or it is a tenant leak.
    sql = _compiled(audit_rpc.rows_query(7, _params(actor_user_id=4242)))
    assert "audit_log.workspace_id = 7" in sql
    assert "audit_log.actor_auth_user_id = 4242" in sql


def test_a_search_term_narrows_within_the_scope_it_does_not_replace_it() -> None:
    sql = _compiled(audit_rpc.rows_query(7, _params(search="delete")))
    assert "audit_log.workspace_id = 7" in sql
    # ``literal_binds`` renders the LIKE wildcards through the DBAPI paramstyle,
    # which doubles them ('%%delete%%'). Assert on the column list instead: what
    # matters is that every search field is OR-ed inside the scoped query, not
    # how the driver escapes a percent sign.
    for field in audit_schemas.AUDIT_SEARCH_FIELDS:
        assert f"audit_log.{field} ILIKE" in sql, field
    assert sql.count("ILIKE") == len(audit_schemas.AUDIT_SEARCH_FIELDS)


def test_the_count_query_carries_the_same_scope_as_the_page_query() -> None:
    # A total computed without the scope would leak the size of other tenants'
    # history through the pager even with an empty results array.
    sql = _compiled(audit_rpc.count_query(7, _params(entity_type="tournament", entity_id=999)))
    assert "audit_log.workspace_id = 7" in sql
    assert "audit_log.entity_id = 999" in sql


# --- platform rows: superuser only ----------------------------------------


def test_the_superuser_feed_has_no_workspace_predicate_so_platform_rows_show() -> None:
    # No WHERE at all: nothing to exclude the `workspace_id IS NULL` rows, which
    # is how "platform events are superuser-only" is expressed — by who reaches
    # this branch, not by a second rule.
    assert "WHERE" not in _compiled(audit_rpc.rows_query(None, _params()))


def test_the_organizer_feed_excludes_platform_rows() -> None:
    # `workspace_id = 7` is never true for NULL, which is the whole mechanism:
    # no separate "hide the platform rows" rule exists to forget.
    sql = _compiled(audit_rpc.rows_query(7, _params()))
    assert "audit_log.workspace_id = 7" in sql
    assert "audit_log.workspace_id IS NULL" not in sql


# --- ordering -------------------------------------------------------------


def test_the_default_order_is_created_at_then_id_both_descending() -> None:
    # created_at is the transaction START time, so rows written by one
    # transaction share it; without the id tiebreaker offset pagination would
    # repeat a row on one page and drop another.
    sql = _compiled(audit_rpc.rows_query(7, _params()))
    assert sql.split("ORDER BY")[1].strip().startswith("audit_log.created_at DESC, audit_log.id DESC")


def test_ascending_order_keeps_the_id_tiebreaker_in_the_same_direction() -> None:
    sql = _compiled(audit_rpc.rows_query(7, _params(order="asc")))
    assert sql.split("ORDER BY")[1].strip().startswith("audit_log.created_at ASC, audit_log.id ASC")


@pytest.mark.parametrize("field", audit_schemas.AUDIT_SORT_FIELDS)
def test_every_sortable_column_still_ends_on_the_id_tiebreaker(field: str) -> None:
    order_by = _compiled(audit_rpc.rows_query(7, _params(sort=field))).split("ORDER BY")[1]
    assert order_by.strip().endswith("audit_log.id DESC")


def test_an_unknown_sort_column_is_rejected_rather_than_silently_ignored() -> None:
    envelope = _call(_ORGANIZER, workspace_id=7, sort="hashed_password")
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "unprocessable"


# --- actor name backfill --------------------------------------------------


def test_the_actor_name_join_is_left_outer_so_a_deleted_account_keeps_its_rows() -> None:
    # An INNER join would erase exactly the history the journal exists for:
    # "who deleted this account" would vanish with the account. `user` is a
    # reserved word, so PostgreSQL renders the table as auth."user".
    sql = _compiled(audit_rpc.rows_query(7, _params()))
    assert 'LEFT OUTER JOIN auth."user"' in sql
    assert "INNER JOIN" not in sql
