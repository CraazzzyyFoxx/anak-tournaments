"""An admin list handler must ship every key its service computed (no DB required).

These handlers used to rebuild the envelope as a literal 4-key dict, so any key
the service added past ``{results, total, page, per_page}`` was silently dropped
on the wire -- the failure mode is a UI rendering an empty facet, not an error.
Driven through the real subscriber so the serializer, not a stand-in, is tested.
"""

import logging
from typing import Any

import pytest

from src.rpc import catalog_aliases as catalog_aliases_rpc
from src.rpc import metadata_admin as metadata_admin_rpc
from tests.conftest import RpcHarness

_SUPERUSER = {"identity": {"user_id": 1, "is_superuser": True, "is_active": True}}


class _NoSession:
    """The service call is stubbed, so the handler's session is never used."""

    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *exc: Any) -> bool:
        return False


@pytest.fixture
def no_db(monkeypatch: pytest.MonkeyPatch) -> None:
    for module in (catalog_aliases_rpc, metadata_admin_rpc):
        monkeypatch.setattr(module, "_SF", _NoSession)


def _harness(*modules: Any) -> RpcHarness:
    harness = RpcHarness()
    harness.logger = logging.getLogger("admin-list-envelope-tests")
    return harness.register(*modules)


def test_alias_miss_list_keeps_a_key_the_service_added(monkeypatch: pytest.MonkeyPatch, no_db: None) -> None:
    async def _list_misses(_session: Any, params: Any) -> dict:
        return {
            "results": [],
            "total": 0,
            "page": params.page,
            "per_page": params.per_page,
            "entity_type_counts": {"hero": 3},
        }

    monkeypatch.setattr(catalog_aliases_rpc.alias_service, "list_misses", _list_misses)

    reply = _harness(catalog_aliases_rpc).call_sync("rpc.app.catalog_aliases.misses_list", dict(_SUPERUSER))

    assert reply["ok"], reply
    assert reply["data"]["entity_type_counts"] == {"hero": 3}
    assert {"results", "total", "page", "per_page"} <= set(reply["data"])


def test_metadata_admin_list_keeps_a_key_the_service_added(monkeypatch: pytest.MonkeyPatch, no_db: None) -> None:
    # One handler serves every kind.
    async def _list(_session: Any, _discipline: str, _kind: str, params: Any) -> dict:
        return {"results": [], "total": 0, "page": params.page, "per_page": params.per_page, "counts": {"active": 2}}

    monkeypatch.setattr(metadata_admin_rpc.catalog_service, "list", _list)

    reply = _harness(metadata_admin_rpc).call_sync(
        "rpc.app.catalog.admin_list", {**_SUPERUSER, "discipline": "overwatch", "kind": "character"}
    )

    assert reply["ok"], reply
    assert reply["data"]["counts"] == {"active": 2}
    assert {"results", "total", "page", "per_page"} <= set(reply["data"])
