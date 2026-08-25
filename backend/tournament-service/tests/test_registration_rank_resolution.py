"""Tournament rank resolution: the registration's own layer, then what it inherits.

Replaces ``test_registration_workspace_player_write.py``, which asserted a
mechanism that no longer exists -- the registration write path copying ranks into
a balancer-local player row. ``registration_role.rank_value`` is now just the
strongest of three layers, and an empty one inherits instead of reading as
"unranked".
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase, mock

from shared.domain.member_rank import ResolvedRank


def _ensure_test_env() -> None:
    for key, value in {
        "DEBUG": "true",
        "PROJECT_URL": "http://localhost",
        "RABBITMQ_URL": "amqp://guest:guest@localhost:5672",
        "REDIS_URL": "redis://localhost:6379/0",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "POSTGRES_DB": "postgres",
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
    }.items():
        os.environ.setdefault(key, value)


_ensure_test_env()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.services.registration import rank_resolution  # noqa: E402


class _Rows:
    def __init__(self, rows: list[tuple[int, int | None]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[int, int | None]]:
        return self._rows


class _Session:
    """Only what the resolver touches: the member->player scalar lookup."""

    def __init__(self, member_rows: list[tuple[int, int | None]] | None = None) -> None:
        self._rows = member_rows or []

    async def execute(self, *_args: Any, **_kwargs: Any) -> _Rows:
        return _Rows(self._rows)


def _registration(registration_id: int, roles: dict[str, int | None], *, member_id: int | None) -> SimpleNamespace:
    return SimpleNamespace(
        id=registration_id,
        workspace_member_id=member_id,
        roles=[SimpleNamespace(role=role, rank_value=value) for role, value in roles.items()],
    )


class TestResolveRegistrationRanks(IsolatedAsyncioTestCase):
    async def test_registration_value_wins_over_everything_inherited(self) -> None:
        registration = _registration(1, {"tank": 2500}, member_id=9)
        resolve = mock.AsyncMock(return_value={(9, "tank"): ResolvedRank(2500, "registration")})
        with mock.patch.object(rank_resolution.member_rank_service, "resolve", resolve):
            by_id = await rank_resolution.resolve_registration_ranks(
                _Session([(9, 77)]), [registration], workspace_id=1
            )
        self.assertEqual(by_id[1]["tank"], ResolvedRank(2500, "registration"))
        # The registration's own number is handed to the resolver as its layer
        # rather than compared against the others here.
        self.assertEqual(resolve.await_args.kwargs["registration_ranks"], {(9, "tank"): 2500})
        self.assertEqual(resolve.await_args.kwargs["order"], rank_resolution.TOURNAMENT_ORDER)

    async def test_blank_role_inherits_the_workspace_canon(self) -> None:
        """The regression this refactor exists for: a blank rank used to read as
        ``none``, which dropped a canon-ranked player out of the balancer pool."""
        registration = _registration(1, {"tank": None}, member_id=9)
        resolve = mock.AsyncMock(return_value={(9, "tank"): ResolvedRank(3200, "workspace")})
        with mock.patch.object(rank_resolution.member_rank_service, "resolve", resolve):
            by_id = await rank_resolution.resolve_registration_ranks(
                _Session([(9, 77)]), [registration], workspace_id=1
            )
        self.assertEqual(by_id[1]["tank"], ResolvedRank(3200, "workspace"))
        # A blank role contributes no registration layer, so it cannot pin itself.
        self.assertEqual(resolve.await_args.kwargs["registration_ranks"], {})

    async def test_unranked_everywhere_is_none(self) -> None:
        registration = _registration(1, {"tank": None}, member_id=9)
        resolve = mock.AsyncMock(return_value={(9, "tank"): ResolvedRank(None, "none")})
        with mock.patch.object(rank_resolution.member_rank_service, "resolve", resolve):
            by_id = await rank_resolution.resolve_registration_ranks(
                _Session([(9, 77)]), [registration], workspace_id=1
            )
        self.assertEqual(by_id[1]["tank"], ResolvedRank(None, "none"))

    async def test_no_member_anchor_answers_from_its_own_layer(self) -> None:
        """A manual registration with no identity keeps the number the organiser
        typed -- only the inherited layers need a member."""
        registration = _registration(1, {"tank": 2500, "dps": None}, member_id=None)
        resolve = mock.AsyncMock()
        with mock.patch.object(rank_resolution.member_rank_service, "resolve", resolve):
            by_id = await rank_resolution.resolve_registration_ranks(
                _Session(), [registration], workspace_id=1
            )
        resolve.assert_not_awaited()
        self.assertEqual(by_id[1]["tank"], ResolvedRank(2500, "registration"))
        self.assertEqual(by_id[1]["dps"], ResolvedRank(None, "none"))

    async def test_unknown_workspace_does_not_guess_a_tenancy(self) -> None:
        registration = _registration(1, {"tank": 2500}, member_id=9)
        resolve = mock.AsyncMock()
        with mock.patch.object(rank_resolution.member_rank_service, "resolve", resolve):
            by_id = await rank_resolution.resolve_registration_ranks(
                _Session([(9, 77)]), [registration], workspace_id=None
            )
        resolve.assert_not_awaited()
        self.assertEqual(by_id[1]["tank"], ResolvedRank(2500, "registration"))

    async def test_member_from_another_workspace_cannot_blank_the_own_layer(self) -> None:
        """The member lookup is workspace-filtered, so a cross-tenant anchor
        resolves to nothing -- and must fall back, not erase."""
        registration = _registration(1, {"tank": 2500}, member_id=9)
        resolve = mock.AsyncMock(return_value={})
        with mock.patch.object(rank_resolution.member_rank_service, "resolve", resolve):
            by_id = await rank_resolution.resolve_registration_ranks(
                _Session([]), [registration], workspace_id=1
            )
        self.assertEqual(by_id[1]["tank"], ResolvedRank(2500, "registration"))

    async def test_resolved_value_map_flattens_to_plain_ranks(self) -> None:
        registration = _registration(1, {"tank": None}, member_id=9)
        resolve = mock.AsyncMock(return_value={(9, "tank"): ResolvedRank(3200, "workspace")})
        with mock.patch.object(rank_resolution.member_rank_service, "resolve", resolve):
            values = await rank_resolution.resolved_value_map(
                _Session([(9, 77)]), registration, workspace_id=1
            )
        self.assertEqual(values, {"tank": 3200})
