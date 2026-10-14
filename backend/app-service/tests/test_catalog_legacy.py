"""The public lookup of an old catalog id (D84), behind the site's redirect of old links (no DB)."""

import asyncio
import logging
from types import SimpleNamespace

import pytest

from shared.core.errors import BaseAPIException
from src import openapi_docs, openapi_schemas
from src.rpc import catalog_legacy as catalog_legacy_rpc
from src.services import catalog_legacy
from tests.conftest import _CaptureBroker

SUBJECT = "rpc.app.catalog.legacy"


def test_the_lookup_is_registered_documented_and_typed() -> None:
    broker = _CaptureBroker()
    catalog_legacy_rpc.register(broker, logging.getLogger("catalog-legacy-tests"))
    assert set(broker.handlers) == {SUBJECT}
    assert openapi_docs.DOCS[SUBJECT]["summary"]
    assert SUBJECT in openapi_schemas.OPERATIONS


@pytest.mark.parametrize(
    ("kind", "legacy_id"),
    [
        ("tournament", "5"),
        ("hero", "abc"),
        ("hero", ""),
        ("hero", "0"),
        ("hero", "-1"),
        ("hero", "²"),
        ("hero", "١٢"),
        ("hero", str(2**63)),
        pytest.param("hero", "9" * 4301, id="too-many-digits"),
    ],
)
def test_anything_but_an_old_hero_map_or_gamemode_id_is_not_found(kind: str, legacy_id: str) -> None:
    with pytest.raises(BaseAPIException) as missing:
        asyncio.run(catalog_legacy.resolve(None, kind, legacy_id))
    assert missing.value.status_code == 404


def test_an_old_id_answers_with_the_entity_it_became(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _get(_session, legacy_kind: str, legacy_id: int):
        assert (legacy_kind, legacy_id) == ("map", 12)
        return SimpleNamespace(id=905, discipline="overwatch", kind="map", slug="ilios")

    monkeypatch.setattr(catalog_legacy._entities, "get_by_legacy_id", _get)
    found = asyncio.run(catalog_legacy.resolve(None, "map", "12"))
    assert found.model_dump() == {"entity_id": 905, "discipline": "overwatch", "kind": "map", "slug": "ilios"}


@pytest.mark.parametrize(
    ("kind", "legacy_id", "entity_kind", "slug"),
    [("hero", 1, "character", "ana"), ("gamemode", 2**63 - 1, "mode", "control")],
)
def test_valid_identifier_bounds_reach_the_lookup(
    monkeypatch: pytest.MonkeyPatch, kind: str, legacy_id: int, entity_kind: str, slug: str
) -> None:
    async def _get(_session, legacy_kind: str, id: int):
        assert (legacy_kind, id) == (kind, legacy_id)
        return SimpleNamespace(id=906, discipline="overwatch", kind=entity_kind, slug=slug)

    monkeypatch.setattr(catalog_legacy._entities, "get_by_legacy_id", _get)
    found = asyncio.run(catalog_legacy.resolve(None, kind, str(legacy_id)))
    assert found.model_dump() == {"entity_id": 906, "discipline": "overwatch", "kind": entity_kind, "slug": slug}


def test_an_unmapped_numeric_id_is_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _get(_session, legacy_kind: str, legacy_id: int):
        return None

    monkeypatch.setattr(catalog_legacy._entities, "get_by_legacy_id", _get)
    with pytest.raises(BaseAPIException) as missing:
        asyncio.run(catalog_legacy.resolve(None, "hero", "950"))
    assert missing.value.status_code == 404
