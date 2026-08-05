"""Draft seeding in a forced-flex tournament.

``flex_role.mode == "forced"`` means role does not matter, so a player's
strength is the MAXIMUM rank across all their roles, applied to all three. That
is what makes the mode work at all: in the balancer, eligibility for a role is
the presence of a rating for it (``Player.can_play`` is ``role in ratings``, and
Rust mirrors it in ``context.rs``), not the ``is_flex`` flag -- so without
flattening, a player ranked only on DPS could never be placed as tank.

The draft's own ``rank_value`` selection is also corrected here: it used to
prefer the primary role's rank even when another role was higher.

Design: docs/superpowers/specs/2026-08-04-forced-flex-max-rank-design.md
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")
os.environ["DEBUG"] = "false"

from shared.core.enums import DraftRole  # noqa: E402
from src.services.draft import lifecycle  # noqa: E402

ALL_ROLE_VALUES = {role.value for role in DraftRole}


class _Role:
    """Minimal stand-in for a BalancerRegistrationRole row."""

    def __init__(
        self,
        role: str,
        *,
        priority: int = 0,
        is_primary: bool = False,
        is_active: bool = True,
        rank_value: int | None = None,
        subrole: str | None = None,
    ) -> None:
        self.role = role
        self.priority = priority
        self.is_primary = is_primary
        self.is_active = is_active
        self.rank_value = rank_value
        self.subrole = subrole
        self.hero_entries = []


class _Registration:
    def __init__(self, roles: list[_Role], *, notes: str | None = None, flex: bool = True) -> None:
        self.roles = roles
        self.notes = notes
        self.is_flex_computed = flex


def _mapped(roles: list[_Role], **kwargs: Any) -> dict:
    return lifecycle._map_registration(_Registration(roles), **kwargs)


class TestForcedFlexMapping:
    def test_max_rank_is_applied_to_all_three_roles(self) -> None:
        mapped = _mapped(
            [
                _Role("dps", priority=0, is_primary=True, rank_value=3900),
                _Role("support", priority=1, is_primary=True, rank_value=2400),
            ],
            forced_flex=True,
        )

        assert mapped["role_ranks"] == dict.fromkeys(ALL_ROLE_VALUES, 3900)

    def test_rank_value_is_the_max_not_the_primary_role_rank(self) -> None:
        """The bug this closes: the primary's rank won even when lower."""
        mapped = _mapped(
            [
                _Role("support", priority=0, is_primary=True, rank_value=2400),
                _Role("dps", priority=1, is_primary=True, rank_value=3900),
            ],
            forced_flex=True,
        )

        assert mapped["rank_value"] == 3900

    def test_a_single_ranked_role_covers_the_other_two(self) -> None:
        """The target case: ranked on DPS only, still placeable as tank."""
        mapped = _mapped([_Role("dps", is_primary=True, rank_value=3900)], forced_flex=True)

        assert mapped["role_ranks"] == dict.fromkeys(ALL_ROLE_VALUES, 3900)
        assert mapped["rank_value"] == 3900

    def test_inactive_roles_still_contribute_and_are_playable(self) -> None:
        """Sheet rows without a parsed rank arrive with is_active=False."""
        mapped = _mapped([_Role("tank", is_primary=True, is_active=False, rank_value=3100)], forced_flex=True)

        assert mapped["role_ranks"] == dict.fromkeys(ALL_ROLE_VALUES, 3100)

    def test_no_ranks_at_all_yields_no_role_ranks(self) -> None:
        mapped = _mapped([_Role("dps", is_primary=True)], forced_flex=True)

        assert mapped["role_ranks"] == {}
        assert mapped["rank_value"] is None

    def test_all_three_roles_are_covered_even_from_one_entry(self) -> None:
        mapped = _mapped([_Role("dps", is_primary=True, rank_value=3000)], forced_flex=True)

        assert {mapped["primary_role"], *mapped["secondary_roles"]} == set(DraftRole)

    def test_sub_role_comes_from_the_first_role_by_priority(self) -> None:
        mapped = _mapped(
            [
                _Role("support", priority=0, is_primary=True, rank_value=3000, subrole="main_heal"),
                _Role("dps", priority=1, is_primary=True, rank_value=3000, subrole="hitscan"),
            ],
            forced_flex=True,
        )

        assert mapped["sub_role"] == "main_heal"

    def test_is_flex_still_comes_from_the_registration(self) -> None:
        mapped = _mapped([_Role("dps", is_primary=True, rank_value=3000)], forced_flex=True)

        assert mapped["is_flex"] is True


class TestOptionalModeIsUnchanged:
    def test_per_role_ranks_are_preserved(self) -> None:
        mapped = _mapped(
            [
                _Role("dps", priority=0, is_primary=True, rank_value=3900),
                _Role("support", priority=1, rank_value=2400),
            ]
        )

        assert mapped["role_ranks"] == {"dps": 3900, "support": 2400}

    def test_rank_value_comes_from_the_primary_role(self) -> None:
        mapped = _mapped(
            [
                _Role("support", priority=0, is_primary=True, rank_value=2400),
                _Role("dps", priority=1, rank_value=3900),
            ]
        )

        assert mapped["rank_value"] == 2400

    def test_inactive_roles_are_dropped(self) -> None:
        mapped = _mapped(
            [
                _Role("dps", priority=0, is_primary=True, rank_value=3900),
                _Role("tank", priority=1, is_active=False, rank_value=3100),
            ]
        )

        assert mapped["role_ranks"] == {"dps": 3900}
        assert mapped["secondary_roles"] == []


class TestForcedFlexEnabledMirror:
    """The draft's mode reader must agree with the tournament-service canon."""

    @staticmethod
    def _form(built_in: dict[str, Any] | None) -> Any:
        class _Form:
            built_in_fields_json = built_in

        return _Form()

    def test_forced(self) -> None:
        assert lifecycle._forced_flex_enabled(self._form({"flex_role": {"mode": "forced"}})) is True

    def test_optional(self) -> None:
        assert lifecycle._forced_flex_enabled(self._form({"flex_role": {"mode": "optional"}})) is False

    def test_absent(self) -> None:
        assert lifecycle._forced_flex_enabled(self._form({})) is False

    def test_disabled_field_wins(self) -> None:
        form = self._form({"flex_role": {"enabled": False, "mode": "forced"}})

        assert lifecycle._forced_flex_enabled(form) is False

    def test_missing_form_fails_closed(self) -> None:
        assert lifecycle._forced_flex_enabled(None) is False
