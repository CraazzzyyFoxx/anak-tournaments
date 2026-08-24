"""Unit tests for `aliases` on the catalog admin CRUD surface (no DB required).

Pins the two things the parser depends on: every write schema can carry aliases,
every read schema hands them back, and the cleaning rule is one shared function
rather than three copies that drift apart.
"""

from shared import catalog_aliases as shared_aliases
from src import schemas
from src.services.admin import gamemode as gamemode_service
from src.services.admin import hero as hero_service
from src.services.admin import map as map_service

_WRITE_SCHEMAS = (
    schemas.HeroCreate,
    schemas.HeroUpdate,
    schemas.MapCreate,
    schemas.MapUpdate,
    schemas.GamemodeCreate,
    schemas.GamemodeUpdate,
)

_READ_SCHEMAS = (schemas.HeroRead, schemas.MapRead, schemas.GamemodeRead)


def test_every_create_and_update_schema_accepts_aliases() -> None:
    for schema in _WRITE_SCHEMAS:
        assert "aliases" in schema.model_fields, f"{schema.__name__} must accept aliases"


def test_omitting_aliases_writes_nothing() -> None:
    # exclude_unset is what the update services key off: an absent `aliases`
    # must not blank an entity's existing list.
    for schema in (schemas.HeroUpdate, schemas.MapUpdate, schemas.GamemodeUpdate):
        assert "aliases" not in schema().model_dump(exclude_unset=True)


def test_every_read_schema_exposes_aliases_and_defaults_to_empty() -> None:
    for schema in _READ_SCHEMAS:
        assert "aliases" in schema.model_fields, f"{schema.__name__} must expose aliases"
        assert schema.model_fields["aliases"].get_default(call_default_factory=True) == []


def test_aliases_are_stripped_deduped_and_order_preserving() -> None:
    assert shared_aliases.normalize_aliases(["  Ана ", "", "アナ", "Ана", "   "]) == ["Ана", "アナ"]


def test_normalizing_nothing_yields_an_empty_list() -> None:
    assert shared_aliases.normalize_aliases([]) == []
    assert shared_aliases.normalize_aliases(["", "  ", "\t\n"]) == []


def test_all_three_services_share_one_normalizer() -> None:
    # The point of putting it in `shared`: three admin services cannot drift.
    for service in (hero_service, map_service, gamemode_service):
        assert service.normalize_aliases is shared_aliases.normalize_aliases


def test_the_canonical_name_is_never_stored_as_its_own_alias() -> None:
    # Production picked up `Assault -> ["Осада", "Assault"]` from an admin edit:
    # the lookup already matches on `name`, so the entity's own name in `aliases`
    # is dead weight, and catalias0001 skips exactly those pairs when seeding.
    assert shared_aliases.normalize_aliases(["Осада", "Assault"], canonical="Assault") == ["Осада"]
    assert shared_aliases.normalize_aliases([" Assault "], canonical="Assault") == []
    # Without a canonical name nothing is dropped — the seed path relies on that.
    assert shared_aliases.normalize_aliases(["Осада", "Assault"]) == ["Осада", "Assault"]


def test_the_gamemode_serializer_carries_every_column() -> None:
    """Regression: the serializer used to enumerate fields, so `aliases` silently
    fell back to the schema default and the API served `[]` over real data.

    The admin editor reads through this payload, so an empty list there means the
    next save wipes the aliases the log parser resolves gamemode names through.
    """
    from types import SimpleNamespace

    from src.services.read_registry import _gamemode_read

    row = SimpleNamespace(
        to_dict=lambda: {
            "id": 1,
            "slug": "assault",
            "name": "Assault",
            "image_path": "assault.svg",
            "description": "2CP",
            "aliases": ["Осада"],
        }
    )
    assert _gamemode_read(row).aliases == ["Осада"]
