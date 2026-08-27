"""Python half of the effective-rank parity check, for both every-role modes
(``all_roles`` and ``forced``).

The rule lives in two languages -- ``map_registration`` here and
``flattenRolesToMaxRank`` in
``frontend/src/app/balancer/components/workspace-helpers.ts`` -- because the
balancer payload is assembled on the client while the draft is seeded on the
server, with no shared module between them. That duplication is the accepted
cost of the current architecture, so it is pinned rather than trusted: both
sides read the same fixtures and must agree.

They agree on the effective rank itself and on every role carrying a rating.
They deliberately diverge on the per-role catalogue: the balancer flattens it to
the maximum, the draft keeps a rank the registrant stated for a role, because
the draft SHOWS the per-role number to the captain choosing a role. Both halves
of that are asserted below, so the divergence stays deliberate.

``eff_ow_rank`` has no counterpart here; the draft carries no OW rank. Only the
TS side asserts it.

TS half: frontend/src/app/balancer/components/forced-flex-parity.test.ts
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = REPO_BACKEND_ROOT.parent
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
FIXTURES = REPO_ROOT / "docs" / "superpowers" / "fixtures" / "forced-flex-eff-rank.json"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ["DEBUG"] = "false"

from shared.core.enums import HERO_TYPE_CLASSES  # noqa: E402
from src.domain.draft import rules  # noqa: E402

CASES: list[dict[str, Any]] = json.loads(FIXTURES.read_text(encoding="utf-8"))["cases"]
ALL_ROLE_VALUES = {role.slot_code for role in HERO_TYPE_CLASSES}


class _Role:
    def __init__(self, spec: dict[str, Any], priority: int) -> None:
        self.role = spec["role"]
        self.priority = priority
        self.is_primary = True
        self.is_active = spec["is_active"]
        self.rank_value = spec["rank_value"]
        self.subrole = None
        self.hero_entries = []


class _Registration:
    def __init__(self, roles: list[_Role]) -> None:
        self.roles = roles
        self.notes = None
        self.is_flex_computed = True


def _map(case: dict[str, Any]) -> dict:
    roles = [_Role(spec, index) for index, spec in enumerate(case["roles"])]
    return rules.map_registration(_Registration(roles), all_roles=True)


def test_fixtures_are_loaded() -> None:
    assert CASES, f"no cases in {FIXTURES}"


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_rank_value_matches_the_shared_expectation(case: dict[str, Any]) -> None:
    assert _map(case)["rank_value"] == case["expected"]["eff_rank"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_every_role_carries_a_rating_and_stated_ranks_survive(case: dict[str, Any]) -> None:
    """Where the draft deliberately diverges from the balancer pool.

    Both sides agree on ``eff_rank`` (asserted above) and on every role carrying
    a rating -- that is what makes a role playable. Only the balancer FLATTENS
    the per-role catalogue to it; the draft keeps the rank the registrant stated
    for a role, because it shows that number to the captain choosing the role.
    """
    expected_rank = case["expected"]["eff_rank"]
    stated = {spec["role"]: spec["rank_value"] for spec in case["roles"] if spec["rank_value"] is not None}
    expected = {} if expected_rank is None else {role: stated.get(role, expected_rank) for role in ALL_ROLE_VALUES}

    assert _map(case)["role_ranks"] == expected


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_all_three_roles_are_playable(case: dict[str, Any]) -> None:
    mapped = _map(case)

    assert {mapped["primary_role"], *mapped["secondary_roles"]} == set(HERO_TYPE_CLASSES)
