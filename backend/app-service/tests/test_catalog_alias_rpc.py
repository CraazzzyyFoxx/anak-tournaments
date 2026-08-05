"""Unit tests for the catalog alias-miss admin RPC (no DB required).

Registration and the OpenAPI tables are checked because both fail silently: an
unregistered subject only shows up as a gateway timeout, and a subject missing
from ``OPERATIONS`` degrades to a generic ``object`` in the published manifest.
"""

import logging

import pytest
from pydantic import ValidationError

from src import openapi_docs, openapi_schemas
from src.rpc import catalog_aliases as catalog_aliases_rpc
from src.schemas.admin import catalog_alias as alias_schemas
from tests.conftest import _CaptureBroker

_SUBJECTS = (
    "rpc.app.catalog_aliases.misses_list",
    "rpc.app.catalog_aliases.attach",
    "rpc.app.catalog_aliases.dismiss",
)


def _register() -> _CaptureBroker:
    broker = _CaptureBroker()
    catalog_aliases_rpc.register(broker, logging.getLogger("catalog-alias-tests"))
    return broker


def test_exactly_the_three_subjects_are_registered() -> None:
    assert set(_register().handlers) == set(_SUBJECTS)


@pytest.mark.parametrize("subject", _SUBJECTS)
def test_every_subject_is_documented(subject: str) -> None:
    assert subject in openapi_docs.DOCS
    assert openapi_docs.DOCS[subject]["summary"]


@pytest.mark.parametrize("subject", _SUBJECTS)
def test_every_subject_is_typed(subject: str) -> None:
    # Missing here => generic `object` in gateway/internal/openapi/schemas.json.
    assert subject in openapi_schemas.OPERATIONS


def test_the_list_operation_publishes_its_filters_as_query_params() -> None:
    op = openapi_schemas.OPERATIONS["rpc.app.catalog_aliases.misses_list"]
    assert op.query is alias_schemas.CatalogAliasMissListQueryParams
    assert {"entity_type", "include_resolved", "page", "per_page"} <= set(op.query.model_fields)


def test_the_attach_operation_publishes_its_request_body() -> None:
    assert openapi_schemas.OPERATIONS["rpc.app.catalog_aliases.attach"].request is alias_schemas.CatalogAliasAttach


def test_attach_requires_entity_type_id_and_alias() -> None:
    with pytest.raises(ValidationError):
        alias_schemas.CatalogAliasAttach.model_validate({"entity_type": "hero"})
    with pytest.raises(ValidationError):
        alias_schemas.CatalogAliasAttach.model_validate({"entity_type": "hero", "entity_id": 1})
    with pytest.raises(ValidationError):
        alias_schemas.CatalogAliasAttach.model_validate({"entity_id": 1, "alias": "Ана"})


def test_attach_rejects_an_unknown_entity_type() -> None:
    with pytest.raises(ValidationError):
        alias_schemas.CatalogAliasAttach.model_validate({"entity_type": "tournament", "entity_id": 1, "alias": "x"})


@pytest.mark.parametrize("blank", ["", " ", "\t\n"])
def test_attach_rejects_a_blank_alias(blank: str) -> None:
    # A blank alias would attach nothing yet still answer ok:true.
    with pytest.raises(ValidationError):
        alias_schemas.CatalogAliasAttach.model_validate({"entity_type": "map", "entity_id": 1, "alias": blank})


def test_attach_strips_the_alias_so_the_handler_never_has_to() -> None:
    model = alias_schemas.CatalogAliasAttach.model_validate(
        {"entity_type": "map", "entity_id": 1, "alias": "  King's Row  "}
    )
    assert model.alias == "King's Row"


def test_attach_rejects_an_alias_longer_than_the_column() -> None:
    with pytest.raises(ValidationError):
        alias_schemas.CatalogAliasAttach.model_validate(
            {"entity_type": "hero", "entity_id": 1, "alias": "x" * (alias_schemas.ALIAS_MAX_LENGTH + 1)}
        )


def test_a_miss_carries_the_tournament_the_admin_ui_links_to() -> None:
    # Joined from log_processing.record, not stored: the record id alone is not
    # addressable in the admin UI.
    fields = alias_schemas.CatalogAliasMissRead.model_fields
    assert "last_log_tournament_id" in fields
    assert fields["last_log_tournament_id"].get_default() is None
