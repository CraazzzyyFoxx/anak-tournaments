"""Unit tests for the catalog alias-miss admin RPC (no DB required).

Registration and the OpenAPI tables are checked because both fail silently: an
unregistered subject only shows up as a gateway timeout, and a subject missing
from ``OPERATIONS`` degrades to a generic ``object`` in the published manifest.
"""

import asyncio
import logging
from uuid import uuid4

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import CatalogAliasMissRepository
from shared.testing.db import real_db_sessionmaker
from src import models, openapi_docs, openapi_schemas, schemas
from src.rpc import catalog_aliases as catalog_aliases_rpc
from src.services.admin.catalog_aliases import CatalogAliasService
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
    assert op.query is schemas.CatalogAliasMissListQueryParams
    assert {"kind", "discipline", "include_resolved", "page", "per_page"} <= set(op.query.model_fields)


def test_the_attach_operation_publishes_its_request_body() -> None:
    assert openapi_schemas.OPERATIONS["rpc.app.catalog_aliases.attach"].request is schemas.CatalogAliasAttach


def test_attach_requires_entity_id_and_alias() -> None:
    with pytest.raises(ValidationError):
        schemas.CatalogAliasAttach.model_validate({})
    with pytest.raises(ValidationError):
        schemas.CatalogAliasAttach.model_validate({"entity_id": 1})


def test_attach_rejects_a_non_positive_entity_id() -> None:
    with pytest.raises(ValidationError):
        schemas.CatalogAliasAttach.model_validate({"entity_id": 0, "alias": "x"})


@pytest.mark.parametrize("blank", ["", " ", "\t\n"])
def test_attach_rejects_a_blank_alias(blank: str) -> None:
    # A blank alias would attach nothing yet still answer ok:true.
    with pytest.raises(ValidationError):
        schemas.CatalogAliasAttach.model_validate({"entity_id": 1, "alias": blank})


def test_attach_strips_the_alias_so_the_handler_never_has_to() -> None:
    model = schemas.CatalogAliasAttach.model_validate({"entity_id": 1, "alias": "  King's Row  "})
    assert model.alias == "King's Row"


def test_attach_rejects_an_alias_longer_than_the_column() -> None:
    with pytest.raises(ValidationError):
        schemas.CatalogAliasAttach.model_validate({"entity_id": 1, "alias": "x" * (schemas.ALIAS_MAX_LENGTH + 1)})


_KINDS = ("character", "map", "mode", "stat", "event", "role")


@pytest.mark.parametrize("kind", _KINDS)
def test_the_queue_filters_and_reads_all_six_diagnostic_kinds(kind: str) -> None:
    assert schemas.CatalogAliasMissListQueryParams(kind=kind).kind == kind
    assert schemas.CatalogAliasMissListParams(kind=kind).kind == kind
    row = {
        "id": 1,
        "discipline": "overwatch",
        "kind": kind,
        "raw_name": "x",
        "occurrences": 1,
        "first_seen_at": "2026-10-15T12:00:00Z",
        "last_seen_at": "2026-10-15T12:00:00Z",
    }
    assert schemas.CatalogAliasMissRead.model_validate(row).kind == kind


def test_the_queue_rejects_a_kind_outside_the_six() -> None:
    with pytest.raises(ValidationError):
        schemas.CatalogAliasMissListQueryParams(kind="hero")


def test_nonentity_misses_are_listable_dismissable_and_never_attach_targets() -> None:
    """Real rows under one rolled-back outer transaction (the service's own commits only release a savepoint)."""

    async def case() -> None:
        tag = uuid4().hex[:8]
        async with real_db_sessionmaker() as sessionmaker:
            async with sessionmaker.kw["bind"].connect() as conn:
                outer = await conn.begin()
                session = AsyncSession(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
                try:
                    hero = models.CatalogEntity(
                        discipline="overwatch", kind="character", slug=f"qa-{tag}", name=f"QA {tag}", attrs={}
                    )
                    session.add(hero)
                    await session.flush()
                    repo, service = CatalogAliasMissRepository(), CatalogAliasService()
                    name = f"shared-name-{tag}"
                    for kind in _KINDS:
                        await repo.record_miss(session, "overwatch", kind, [name])
                    await repo.record_miss(session, "lol", "stat", [name])

                    async def listing(**filters):
                        params = schemas.CatalogAliasMissListParams(discipline="overwatch", **filters)
                        page = await service.list_misses(session, params)
                        return sorted(row.kind for row in page["results"] if row.raw_name == name)

                    assert await listing() == sorted(_KINDS)
                    for kind in _KINDS:
                        assert await listing(kind=kind) == [kind]

                    # Attaching an alias is addressed to an entity: it closes only that entity's discipline/kind miss.
                    await service.attach(session, schemas.CatalogAliasAttach(entity_id=hero.id, alias=name))
                    assert hero.aliases == [name]
                    assert await listing() == sorted(kind for kind in _KINDS if kind != "character")
                    assert await listing(include_resolved=True) == sorted(_KINDS)

                    # A nonentity row is closed by dismissing it, which touches no entity or definition.
                    stat = await session.scalar(
                        sa.select(models.CatalogAliasMiss).where(
                            models.CatalogAliasMiss.discipline == "overwatch",
                            models.CatalogAliasMiss.kind == "stat",
                            models.CatalogAliasMiss.raw_name == name,
                        )
                    )
                    await service.dismiss(session, stat.id)
                    assert "stat" not in await listing()
                    assert (
                        await session.scalar(
                            sa.select(sa.func.count())
                            .select_from(models.CatalogEntity)
                            .where(models.CatalogEntity.slug == name)
                        )
                        == 0
                    )
                    foreign = await service.list_misses(
                        session, schemas.CatalogAliasMissListParams(discipline="lol", kind="stat")
                    )
                    assert [row.resolved_at for row in foreign["results"] if row.raw_name == name] == [None]
                finally:
                    await session.close()
                    await outer.rollback()

    asyncio.run(case())
