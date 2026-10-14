"""The generic admin catalog CRUD (D85): registration, OpenAPI tables, and the module-driven checks (no DB)."""

import asyncio
import logging
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from shared.core.errors import BaseAPIException
from shared.disciplines import DISCIPLINES
from src import openapi_docs, openapi_schemas, schemas
from src.rpc import metadata_admin as metadata_admin_rpc
from src.services.admin import catalog as catalog_module
from src.services.admin.catalog import CatalogAdminService, check_class, check_parent, kind_spec, to_read
from tests.conftest import _CaptureBroker

_SUBJECTS = (
    "rpc.app.catalog.admin_list",
    "rpc.app.catalog.admin_create",
    "rpc.app.catalog.admin_update",
    "rpc.app.catalog.admin_delete",
)


def test_exactly_the_four_catalog_subjects_are_registered() -> None:
    broker = _CaptureBroker()
    metadata_admin_rpc.register(broker, logging.getLogger("catalog-admin-tests"))
    assert set(broker.handlers) == set(_SUBJECTS)


@pytest.mark.parametrize("subject", _SUBJECTS)
def test_every_subject_is_documented(subject: str) -> None:
    assert openapi_docs.DOCS[subject]["summary"]


@pytest.mark.parametrize("subject", ("rpc.app.catalog.admin_create", "rpc.app.catalog.admin_update"))
def test_every_write_is_typed(subject: str) -> None:
    assert openapi_schemas.OPERATIONS[subject].request is not None


def test_an_unknown_discipline_or_an_undeclared_kind_is_not_found() -> None:
    with pytest.raises(BaseAPIException) as unknown:
        kind_spec("chess", "character")
    assert unknown.value.status_code == 404
    with pytest.raises(BaseAPIException) as no_modes:
        kind_spec("lol", "mode")
    assert no_modes.value.status_code == 404
    assert kind_spec("overwatch", "mode") is DISCIPLINES["overwatch"]


def test_a_character_class_is_the_modules_to_allow() -> None:
    overwatch, lol = DISCIPLINES["overwatch"], DISCIPLINES["lol"]
    check_class(overwatch, "character", {"class": "tank"})
    check_class(lol, "character", {"class": "Mage"})
    check_class(overwatch, "map", {})  # only characters carry a class
    for spec, attrs in ((overwatch, {"class": "flex"}), (overwatch, {"class": "Mage"}), (overwatch, {})):
        with pytest.raises(BaseAPIException) as refused:
            check_class(spec, "character", attrs)
        assert refused.value.status_code == 422


def test_a_map_of_a_game_with_modes_needs_one_and_nothing_else_has_a_parent() -> None:
    overwatch, lol = DISCIPLINES["overwatch"], DISCIPLINES["lol"]
    check_parent(overwatch, "map", 7)
    check_parent(lol, "map", None)
    for spec, kind, parent_id in ((overwatch, "map", None), (lol, "map", 7), (overwatch, "character", 7)):
        with pytest.raises(BaseAPIException) as refused:
            check_parent(spec, kind, parent_id)
        assert refused.value.status_code == 422


def test_the_attrs_filter_must_be_a_json_object() -> None:
    assert schemas.CatalogEntityListQueryParams(attrs='{"class": "tank"}').attrs == '{"class": "tank"}'
    for bad in ("[1]", "not json"):
        with pytest.raises(ValidationError):
            schemas.CatalogEntityListQueryParams(attrs=bad)


@pytest.mark.parametrize("field", ["name", "slug", "attrs", "active"])
def test_patch_rejects_explicit_null_for_non_null_fields(field: str) -> None:
    with pytest.raises(ValidationError):
        schemas.CatalogEntityUpdate.model_validate({field: None})


def test_patch_can_clear_nullable_fields_and_omitted_fields_stay_omitted() -> None:
    assert schemas.CatalogEntityUpdate().model_dump(exclude_unset=True) == {}
    assert schemas.CatalogEntityUpdate(image_path=None, parent_id=None).model_dump(exclude_unset=True) == {
        "image_path": None,
        "parent_id": None,
    }


@pytest.fixture
def catalog_repo(monkeypatch: pytest.MonkeyPatch):
    from src import models

    row = models.CatalogEntity(
        id=901,
        discipline="overwatch",
        kind="character",
        slug="ana",
        name="Ana",
        attrs={"class": "support", "color": "#718ab3", "nested": {"old": True}},
        aliases=["Ана"],
        active=True,
        parent_id=None,
        image_path=None,
        created_at=datetime(2026, 10, 14, tzinfo=UTC),
        parent=None,
    )
    repo = AsyncMock()
    repo.get.return_value = row
    repo.get_by.return_value = None

    async def create(_session, entity):
        entity.id = 902
        entity.created_at = datetime(2026, 10, 14, tzinfo=UTC)
        entity.parent = None
        repo.get.return_value = entity

    async def update_fields(_session, entity, changes):
        for field, value in changes.items():
            setattr(entity, field, value)

    repo.create.side_effect = create
    repo.update_fields.side_effect = update_fields
    monkeypatch.setattr(catalog_module, "CatalogEntityRepository", lambda *args, **kwargs: repo)
    return repo


def test_create_rejects_an_overlong_derived_slug_without_truncation(catalog_repo) -> None:
    with pytest.raises(BaseAPIException) as refused:
        asyncio.run(
            CatalogAdminService().create(
                AsyncMock(),
                "overwatch",
                "character",
                schemas.CatalogEntityCreate(name="a" * 65, attrs={"class": "support"}),
            )
        )
    assert refused.value.status_code == 422
    catalog_repo.create.assert_not_awaited()


@pytest.mark.parametrize("schema", [schemas.CatalogEntityCreate, schemas.CatalogEntityUpdate])
def test_explicit_slug_length_is_checked(schema) -> None:
    with pytest.raises(ValidationError):
        schema(name="Ana", slug="a" * 65)


def test_a_short_explicit_slug_allows_a_long_name_and_rename_keeps_it(catalog_repo) -> None:
    service, session = CatalogAdminService(), AsyncMock()
    entity = asyncio.run(
        service.create(
            session,
            "overwatch",
            "character",
            schemas.CatalogEntityCreate(name="a" * 128, slug="a" * 64, attrs={"class": "support"}),
        )
    )
    assert entity.slug == "a" * 64
    entity = asyncio.run(
        service.update(session, "overwatch", "character", entity.id, schemas.CatalogEntityUpdate(name="b" * 128))
    )
    assert entity.slug == "a" * 64


def test_patch_attrs_merges_keys_but_replaces_present_values_shallowly(catalog_repo) -> None:
    service, session = CatalogAdminService(), AsyncMock()
    entity = asyncio.run(
        service.update(
            session,
            "overwatch",
            "character",
            901,
            schemas.CatalogEntityUpdate(attrs={"color": "#ffffff"}),
        )
    )
    assert entity.attrs == {"class": "support", "color": "#ffffff", "nested": {"old": True}}
    entity = asyncio.run(
        service.update(
            session,
            "overwatch",
            "character",
            901,
            schemas.CatalogEntityUpdate(attrs={"class": "tank", "nested": {"new": True}}),
        )
    )
    assert entity.attrs == {"class": "tank", "color": "#ffffff", "nested": {"new": True}}


def test_generic_create_and_patch_normalize_aliases_and_reads_return_them(catalog_repo) -> None:
    service, session = CatalogAdminService(), AsyncMock()
    entity = asyncio.run(
        service.create(
            session,
            "overwatch",
            "character",
            schemas.CatalogEntityCreate(
                name="Ana", attrs={"class": "support"}, aliases=["  Ана ", "", "アナ", "Ана", " Ana "]
            ),
        )
    )
    assert to_read(entity).aliases == ["Ана", "アナ"]
    entity = asyncio.run(
        service.update(session, "overwatch", "character", entity.id, schemas.CatalogEntityUpdate(active=False))
    )
    assert entity.aliases == ["Ана", "アナ"]
    entity = asyncio.run(
        service.update(
            session,
            "overwatch",
            "character",
            entity.id,
            schemas.CatalogEntityUpdate(aliases=["アナ", " Ана ", "アナ", "Ana", "  "]),
        )
    )
    assert to_read(entity).aliases == ["アナ", "Ана"]
    entity = asyncio.run(
        service.update(session, "overwatch", "character", entity.id, schemas.CatalogEntityUpdate(aliases=[]))
    )
    assert to_read(entity).aliases == []


def test_alias_normalization_preserves_exact_matching_and_handles_empty_input() -> None:
    from shared.catalog_aliases import normalize_aliases

    assert normalize_aliases([]) == []
    assert normalize_aliases(["", "  ", "\t\n"]) == []
    assert normalize_aliases(["Осада", "Assault"]) == ["Осада", "Assault"]
    assert normalize_aliases(["Осада", " Assault "], canonical="Assault") == ["Осада"]
    assert normalize_aliases([" Assault "], canonical="Assault") == []
    assert normalize_aliases(["Ana", "ana", " ANA "]) == ["Ana", "ana", "ANA"]


def test_attach_resolves_only_the_target_entity_discipline_and_kind(catalog_repo) -> None:
    from shared.repository import CatalogAliasMissRepository
    from src.services.admin.catalog_aliases import CatalogAliasService

    session = AsyncMock()
    service = CatalogAliasService(entities=catalog_repo, misses=CatalogAliasMissRepository())
    asyncio.run(service.attach(session, schemas.CatalogAliasAttach(entity_id=901, alias="  アナ ")))
    assert catalog_repo.get.return_value.aliases == ["Ана", "アナ"]
    statement = session.execute.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "UPDATE catalog.alias_miss" in sql
    assert "alias_miss.discipline = 'overwatch'" in sql
    assert "alias_miss.kind = 'character'" in sql
    assert "alias_miss.raw_name = 'アナ'" in sql
    assert "resolved_at=now()" in sql
    session.commit.assert_awaited_once()


def test_catalog_rpc_rejects_non_superuser_and_bad_patch_with_422(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.conftest import RpcHarness
    from tests.test_admin_list_envelope_extras import _NoSession

    monkeypatch.setattr(metadata_admin_rpc, "_SF", _NoSession)
    harness = RpcHarness().register(metadata_admin_rpc)
    path = {"discipline": "overwatch", "kind": "character", "id": 901}
    refused = harness.call_sync("rpc.app.catalog.admin_list", {**path, "identity": {"user_id": 1, "is_active": True}})
    assert refused["error"]["code"] == "forbidden"
    for field in ("name", "slug", "attrs", "active"):
        reply = harness.call_sync(
            "rpc.app.catalog.admin_update",
            {**path, "identity": {"user_id": 1, "is_active": True, "is_superuser": True}, "payload": {field: None}},
        )
        assert reply["error"]["code"] == "unprocessable", reply
