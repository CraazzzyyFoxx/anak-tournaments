"""Draft seeding in a forced-flex tournament.

``flex_role.mode == "forced"`` means role does not matter, so a player's
strength -- ``rank_value`` -- is the MAXIMUM rank across all their roles. Every
role also has to CARRY a rating: in the balancer, eligibility for a role is the
presence of one (``Player.can_play`` is ``role in ratings``, and Rust mirrors it
in ``context.rs``), not the ``is_flex`` flag -- so a player ranked only on DPS
could never be placed as tank without it. Roles the registration never ranked
therefore take the maximum.

What the maximum must NOT do is overwrite a rank the registrant actually stated.
The draft shows the per-role number to the captain choosing a role, and
flattening all three turned that display into one value printed three times.

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
    def test_a_ranked_role_keeps_its_own_rank(self) -> None:
        """The draft shows this number per role, so it may not be overwritten."""
        mapped = _mapped(
            [
                _Role("dps", priority=0, is_primary=True, rank_value=3900),
                _Role("support", priority=1, is_primary=True, rank_value=2400),
            ],
            all_roles=True,
        )

        # Tank was never ranked, so it takes the maximum: eligibility is the
        # presence of a rating, and that is the only value available for it.
        assert mapped["role_ranks"] == {"dps": 3900, "support": 2400, "tank": 3900}

    def test_rank_value_is_the_max_not_the_primary_role_rank(self) -> None:
        """The bug this closes: the primary's rank won even when lower."""
        mapped = _mapped(
            [
                _Role("support", priority=0, is_primary=True, rank_value=2400),
                _Role("dps", priority=1, is_primary=True, rank_value=3900),
            ],
            all_roles=True,
        )

        assert mapped["rank_value"] == 3900

    def test_a_single_ranked_role_covers_the_other_two(self) -> None:
        """The target case: ranked on DPS only, still placeable as tank."""
        mapped = _mapped([_Role("dps", is_primary=True, rank_value=3900)], all_roles=True)

        assert mapped["role_ranks"] == dict.fromkeys(ALL_ROLE_VALUES, 3900)
        assert mapped["rank_value"] == 3900

    def test_inactive_roles_still_contribute_and_are_playable(self) -> None:
        """Sheet rows without a parsed rank arrive with is_active=False."""
        mapped = _mapped([_Role("tank", is_primary=True, is_active=False, rank_value=3100)], all_roles=True)

        assert mapped["role_ranks"] == dict.fromkeys(ALL_ROLE_VALUES, 3100)

    def test_no_ranks_at_all_yields_no_role_ranks(self) -> None:
        mapped = _mapped([_Role("dps", is_primary=True)], all_roles=True)

        assert mapped["role_ranks"] == {}
        assert mapped["rank_value"] is None

    def test_all_three_roles_are_covered_even_from_one_entry(self) -> None:
        mapped = _mapped([_Role("dps", is_primary=True, rank_value=3000)], all_roles=True)

        assert {mapped["primary_role"], *mapped["secondary_roles"]} == set(DraftRole)

    def test_sub_role_comes_from_the_first_role_by_priority(self) -> None:
        mapped = _mapped(
            [
                _Role("support", priority=0, is_primary=True, rank_value=3000, subrole="main_heal"),
                _Role("dps", priority=1, is_primary=True, rank_value=3000, subrole="hitscan"),
            ],
            all_roles=True,
        )

        assert mapped["sub_role"] == "main_heal"

    def test_is_flex_still_comes_from_the_registration(self) -> None:
        mapped = _mapped([_Role("dps", is_primary=True, rank_value=3000)], all_roles=True)

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
        assert lifecycle._all_roles_required(self._form({"flex_role": {"mode": "forced"}})) is True

    def test_optional(self) -> None:
        assert lifecycle._all_roles_required(self._form({"flex_role": {"mode": "optional"}})) is False

    def test_absent(self) -> None:
        assert lifecycle._all_roles_required(self._form({})) is False

    def test_disabled_field_wins(self) -> None:
        form = self._form({"flex_role": {"enabled": False, "mode": "forced"}})

        assert lifecycle._all_roles_required(form) is False

    def test_missing_form_fails_closed(self) -> None:
        assert lifecycle._all_roles_required(None) is False

    def test_all_roles_mode_also_requires_every_role(self) -> None:
        assert lifecycle._all_roles_required(self._form({"flex_role": {"mode": "all_roles"}})) is True


class TestAllRolesModeKeepsThePriority:
    """``all_roles`` differs from ``forced`` in exactly one respect.

    Both make every role playable and carrying a rating, because balancer
    eligibility demands one per role. Only ``forced`` also forces every role
    primary. Under ``all_roles`` the registrant's single priority role survives,
    which is what keeps a real balance-versus-comfort trade-off alive: a forced
    tournament has zero discomfort everywhere and the solver's second objective
    collapses to sub-role collisions.
    """

    def test_the_priority_role_becomes_primary(self) -> None:
        mapped = lifecycle._map_registration(
            _Registration(
                [
                    _Role("tank", priority=0, is_primary=True, rank_value=3300),
                    _Role("dps", priority=1, rank_value=2800),
                    _Role("support", priority=2, rank_value=3000),
                ],
                flex=False,
            ),
            all_roles=True,
        )

        assert mapped["primary_role"] == DraftRole.TANK
        assert set(mapped["secondary_roles"]) == {DraftRole.DPS, DraftRole.SUPPORT}

    def test_is_flex_stays_false_for_a_priority_registrant(self) -> None:
        """``is_flex`` is the registration's own fact, not the mode's."""
        mapped = lifecycle._map_registration(
            _Registration([_Role("tank", is_primary=True, rank_value=3300)], flex=False),
            all_roles=True,
        )

        assert mapped["is_flex"] is False

    def test_every_role_is_rated_without_losing_the_stated_ranks(self) -> None:
        mapped = lifecycle._map_registration(
            _Registration(
                [
                    _Role("tank", priority=0, is_primary=True, rank_value=2800),
                    _Role("dps", priority=1, rank_value=3900),
                ],
                flex=False,
            ),
            all_roles=True,
        )

        # Support is unrated and takes the maximum; tank keeps the 2800 the
        # registrant stated, which is what the draft shows on the tank row.
        assert mapped["role_ranks"] == {"tank": 2800, "dps": 3900, "support": 3900}
        assert mapped["rank_value"] == 3900


class TestDiscomfortDivergesFromTheBalancer:
    """Witness for a pre-existing mirror that ``all_roles`` makes visible.

    The draft and the balancer both encode "how much does this role hurt", in
    separate code. For a registrant with one priority role and two playable
    others, measured:

    | role     | balancer | draft |
    |----------|----------|-------|
    | priority |        0 |     0 |
    | other    |      100 |  1000 |
    | other    |      200 |  1000 |

    The draft penalises a non-priority role 5-10x harder because
    ``preference_order`` carries only the primary role (``rpc/draft.py``), while
    the balancer builds a full ordering from ``priority`` (``player_loader``). It
    also hands the two non-priority roles DIFFERENT penalties, from row order the
    registrant never expressed.

    ``forced`` hid this: every role is primary there, so discomfort is nil on
    both sides. This test does not assert the desired behaviour -- it pins the
    current divergence so closing it becomes a deliberate, visible change. See
    docs/superpowers/specs/2026-08-04-code-mirrors-registry.md, class D.
    """

    def test_draft_penalises_non_priority_roles_uniformly_and_harder(self) -> None:
        from src.services.draft import suggestions as sug

        player = sug.FitPlayer(
            player_id=1,
            rank_value=3300,
            playable_roles=frozenset(DraftRole),
            preference_order=(DraftRole.TANK,),
            is_flex=False,
            rank_by_role=dict.fromkeys(DraftRole, 3300),
        )

        assert sug.role_discomfort(player, DraftRole.TANK) == 0
        assert sug.role_discomfort(player, DraftRole.DPS) == 1000
        assert sug.role_discomfort(player, DraftRole.SUPPORT) == 1000

    def test_balancer_penalises_them_by_position_instead(self) -> None:
        from src.services.balancer.algorithm.entities import Player

        mask = {"Tank": 1, "Damage": 2, "Support": 2}
        player = Player(
            "x",
            {"Tank": 3300, "Damage": 3300, "Support": 3300},
            ["Tank", "Damage", "Support"],
            "u",
            mask,
            is_flex=False,
        )

        assert player.get_discomfort("Tank") == 0
        assert player.get_discomfort("Damage") == 100
        assert player.get_discomfort("Support") == 200
