"""Guards for the forced-flex tournament mode's role normalization.

``flex_role.mode == "forced"`` describes a tournament where role does not
matter. It is a fact about ROLES, so it is normalized once at write time on both
role-write paths: every submitted role becomes primary and the missing roles are
backfilled, which makes ``is_flex_computed`` hold for every registration no
matter the entry point (public form, admin panel, API key, Google Sheets sync).

The max-rank policy is deliberately NOT here: it is a fact about RANKS, derived
at read time, because the public form submits no ranks at all and the rank
autofill would overwrite anything flattened into the rows.

Design: docs/superpowers/specs/2026-08-04-forced-flex-max-rank-design.md
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from typing import Any

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

_common = importlib.import_module("src.services.registration._common")
_service = importlib.import_module("src.services.registration.service")


def _form(built_in_fields: dict[str, Any] | None) -> Any:
    class _Form:
        built_in_fields_json = built_in_fields

    return _Form()


def _role(role: str, **kwargs: Any) -> Any:
    return _common.models.BalancerRegistrationRole(role=role, **kwargs)


class TestForcedFlexEnabled:
    def test_absent_key_is_optional(self) -> None:
        assert _common.forced_flex_enabled(_form({})) is False

    def test_absent_mode_is_optional(self) -> None:
        assert _common.forced_flex_enabled(_form({"flex_role": {"enabled": True}})) is False

    def test_explicit_optional(self) -> None:
        assert _common.forced_flex_enabled(_form({"flex_role": {"mode": "optional"}})) is False

    def test_forced(self) -> None:
        assert _common.forced_flex_enabled(_form({"flex_role": {"mode": "forced"}})) is True

    def test_forced_ignored_when_the_field_is_disabled(self) -> None:
        """``enabled: false`` bans flex outright, so it wins over the mode."""
        form = _form({"flex_role": {"enabled": False, "mode": "forced"}})

        assert _common.forced_flex_enabled(form) is False

    def test_missing_form_is_optional(self) -> None:
        """Fail closed: an unreadable form must not silently inflate ranks."""
        assert _common.forced_flex_enabled(None) is False

    def test_empty_built_in_fields_json_is_optional(self) -> None:
        assert _common.forced_flex_enabled(_form(None)) is False

    def test_non_dict_config_is_optional(self) -> None:
        assert _common.forced_flex_enabled(_form({"flex_role": "forced"})) is False


class TestApplyForcedFlex:
    def test_promotes_every_role_to_primary(self) -> None:
        entries = [_role("dps", is_primary=True), _role("tank", is_primary=False)]

        result = _common.apply_forced_flex(entries)

        assert all(entry.is_primary for entry in result)

    def test_backfills_the_missing_roles(self) -> None:
        result = _common.apply_forced_flex([_role("dps", is_primary=True)])

        assert {entry.role for entry in result} == {"tank", "dps", "support"}

    def test_keeps_the_submitted_order_and_renumbers_priority(self) -> None:
        entries = [_role("support", priority=0), _role("tank", priority=1)]

        result = _common.apply_forced_flex(entries)

        assert [entry.role for entry in result[:2]] == ["support", "tank"]
        assert [entry.priority for entry in result] == [0, 1, 2]

    def test_does_not_touch_is_active_or_rank(self) -> None:
        """The max-rank policy is derived at read time; rows stay honest."""
        entries = [_role("dps", is_primary=True, is_active=False, rank_value=3500)]

        result = _common.apply_forced_flex(entries)

        dps = next(entry for entry in result if entry.role == "dps")
        assert dps.is_active is False
        assert dps.rank_value == 3500

    def test_backfilled_roles_carry_no_rank(self) -> None:
        result = _common.apply_forced_flex([_role("dps", rank_value=3500)])

        assert [entry.rank_value for entry in result if entry.role != "dps"] == [None, None]

    def test_backfilled_roles_carry_no_subrole(self) -> None:
        result = _common.apply_forced_flex([_role("dps", subrole="hitscan")])

        assert [entry.subrole for entry in result if entry.role != "dps"] == [None, None]

    def test_is_idempotent(self) -> None:
        once = _common.apply_forced_flex([_role("dps", is_primary=True)])
        twice = _common.apply_forced_flex(once)

        assert [(entry.role, entry.priority, entry.is_primary) for entry in twice] == [
            (entry.role, entry.priority, entry.is_primary) for entry in once
        ]

    def test_a_full_submission_is_unchanged_apart_from_is_primary(self) -> None:
        entries = [_role("tank", priority=0), _role("dps", priority=1), _role("support", priority=2)]

        result = _common.apply_forced_flex(entries)

        assert len(result) == 3
        assert [entry.role for entry in result] == ["tank", "dps", "support"]

    def test_empty_input_yields_all_three_roles(self) -> None:
        """A forced-flex tournament has no notion of a registration without roles."""
        result = _common.apply_forced_flex([])

        assert {entry.role for entry in result} == {"tank", "dps", "support"}
        assert all(entry.is_primary for entry in result)


class TestWritePathsHonourForcedFlex:
    """Both role-write funnels must normalize, not just the admin one.

    ``build_registration_roles`` (public form) and ``replace_registration_roles``
    (admin panel + Google Sheets) are independent implementations; the former's
    docstring calls itself a mirror of the latter but nothing keeps them in
    step. A registration created through either one has to come out flex.
    """

    class _PublicRole:
        def __init__(self, role: str, is_primary: bool = False, subrole: str | None = None) -> None:
            self.role = role
            self.is_primary = is_primary
            self.subrole = subrole
            self.top_heroes = None

    def test_public_path_forced(self) -> None:
        entries = _service.build_registration_roles(
            [self._PublicRole("dps", is_primary=True)],
            forced_flex=True,
        )

        assert {entry.role for entry in entries} == {"tank", "dps", "support"}
        assert all(entry.is_primary for entry in entries)

    def test_public_path_optional_is_unchanged(self) -> None:
        entries = _service.build_registration_roles([self._PublicRole("dps", is_primary=True)])

        assert [entry.role for entry in entries] == ["dps"]

    def test_public_path_keeps_the_submitted_subrole(self) -> None:
        entries = _service.build_registration_roles(
            [self._PublicRole("dps", is_primary=True, subrole="hitscan")],
            forced_flex=True,
        )

        dps = next(entry for entry in entries if entry.role == "dps")
        assert dps.subrole == "hitscan"

    def test_admin_path_forced(self) -> None:
        registration = _common.models.BalancerRegistration()
        registration.roles = []

        _common.replace_registration_roles(
            registration,
            [{"role": "support", "is_primary": False, "rank_value": 2900}],
            forced_flex=True,
        )

        assert {entry.role for entry in registration.roles} == {"tank", "dps", "support"}
        assert all(entry.is_primary for entry in registration.roles)

    def test_admin_path_preserves_rank_and_is_active(self) -> None:
        """The rank policy is derived at read time; the row keeps what it was given."""
        registration = _common.models.BalancerRegistration()
        registration.roles = []

        _common.replace_registration_roles(
            registration,
            [{"role": "support", "is_primary": False, "rank_value": 2900}],
            forced_flex=True,
        )

        support = next(entry for entry in registration.roles if entry.role == "support")
        assert support.rank_value == 2900
        assert support.is_active is True
        assert [e.rank_value for e in registration.roles if e.role != "support"] == [None, None]

    def test_admin_path_optional_is_unchanged(self) -> None:
        registration = _common.models.BalancerRegistration()
        registration.roles = []

        _common.replace_registration_roles(
            registration,
            [{"role": "support", "is_primary": False, "rank_value": 2900}],
        )

        assert [entry.role for entry in registration.roles] == ["support"]
        assert registration.roles[0].is_primary is False

    def test_admin_path_reuses_existing_rows(self) -> None:
        """Re-syncing must not orphan the row a rank was already attached to."""
        registration = _common.models.BalancerRegistration()
        existing = _common.models.BalancerRegistrationRole(role="dps", rank_value=4100)
        registration.roles = [existing]

        _common.replace_registration_roles(
            registration,
            [{"role": "dps", "is_primary": True, "rank_value": 4100}],
            forced_flex=True,
        )

        dps = next(entry for entry in registration.roles if entry.role == "dps")
        assert dps is existing
        assert dps.rank_value == 4100
