"""Python half of the forced-flex effective-rank parity check.

The rule lives in two languages -- ``_map_registration`` here and
``flattenRolesToMaxRank`` in
``frontend/src/app/balancer/components/workspace-helpers.ts`` -- because the
balancer payload is assembled on the client while the draft is seeded on the
server, with no shared module between them. That duplication is the accepted
cost of the current architecture, so it is pinned rather than trusted: both
sides read the same fixtures and must agree.

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

CASES: list[dict[str, Any]] = json.loads(FIXTURES.read_text(encoding="utf-8"))["cases"]
ALL_ROLE_VALUES = {role.value for role in DraftRole}


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
    return lifecycle._map_registration(_Registration(roles), all_roles=True)


def test_fixtures_are_loaded() -> None:
    assert CASES, f"no cases in {FIXTURES}"


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_rank_value_matches_the_shared_expectation(case: dict[str, Any]) -> None:
    assert _map(case)["rank_value"] == case["expected"]["eff_rank"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_every_role_carries_the_effective_rank(case: dict[str, Any]) -> None:
    expected_rank = case["expected"]["eff_rank"]
    expected = {} if expected_rank is None else dict.fromkeys(ALL_ROLE_VALUES, expected_rank)

    assert _map(case)["role_ranks"] == expected


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_all_three_roles_are_playable(case: dict[str, Any]) -> None:
    mapped = _map(case)

    assert {mapped["primary_role"], *mapped["secondary_roles"]} == set(DraftRole)
