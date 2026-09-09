"""Unit tests for injecting OW rank deltas into the registrations response."""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"

models = importlib.import_module("src.models")
serializers = importlib.import_module("src.services.registration.serializers")
player_sub_roles = importlib.import_module("shared.domain.player_sub_roles")
from shared.core.enums import HeroClass  # noqa: E402
from shared.domain.roster import RosterRole  # noqa: E402


def test_snapshot_role_translates_damage_to_dps() -> None:
    # The snapshot uses the canonical HeroClass name ("damage"); the registration uses "dps".
    # Translation now lives in shared and is used by shared.services.rank_snapshots.
    assert player_sub_roles.canonical_to_registration_role("damage") == "dps"
    assert player_sub_roles.canonical_to_registration_role("tank") == "tank"
    assert player_sub_roles.canonical_to_registration_role("support") == "support"


def _role_model(role: str, rank_value: int | None):
    # Transient ORM instance: unloaded `hero_entries` -> _role_top_heroes returns [].
    return models.BalancerRegistrationRole(
        role=role, subrole=None, priority=1, is_primary=True, rank_value=rank_value, is_active=True
    )


def _entry(role: str, rank: int | None):
    """The engine's verdict for that role -- the only source of a rank on the wire."""
    return RosterRole(
        role=HeroClass.from_slot_code(role),
        rank=rank,
        source="registration" if rank is not None else "none",
        is_primary=True,
        priority=1,
        subrole=None,
    )


def test_serialize_role_carries_ow_rank_value() -> None:
    out = serializers.serialize_registration_role(_role_model("dps", 500), ow_rank_value=3000, entry=_entry("dps", 500))

    assert out.rank_value == 500
    assert out.ow_rank_value == 3000


def test_serialize_role_defaults_ow_rank_to_none() -> None:
    out = serializers.serialize_registration_role(_role_model("tank", 500), entry=_entry("tank", 500))

    assert out.ow_rank_value is None


def test_a_role_the_engine_did_not_rate_is_reported_unplayable() -> None:
    """The one predicate: no resolved rank -> not active, whatever the column says."""
    out = serializers.serialize_registration_role(_role_model("tank", 500))

    assert out.rank_value is None
    assert out.rank_source == "none"
    assert out.is_active is False
    # The declared flag is still reported, because the editor toggles it.
    assert out.is_declared_active is True
