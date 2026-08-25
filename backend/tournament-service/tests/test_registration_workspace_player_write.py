"""Registration write path attaches workspace_player and resolves ranks."""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase, mock

from shared.domain.workspace_player import ResolvedRank


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

from src import models  # noqa: E402
from src.services.registration import lifecycle as reg_lifecycle  # noqa: E402
from src.services.registration import rank_autofill  # noqa: E402
from src.services.registration import serializers  # noqa: E402
from src.services.registration import workspace_player as workspace_players  # noqa: E402


class _Savepoint:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Session:
    def __init__(self) -> None:
        self.info: dict = {}
        self.added: list[Any] = []
        self.commits = 0

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, obj: Any) -> None:
        return None

    async def scalar(self, *_args: Any, **_kwargs: Any) -> Any:
        return 1

    def begin_nested(self) -> _Savepoint:
        return _Savepoint()


async def _noop(*_args: Any, **_kwargs: Any) -> None:
    return None


def _wp(**fields: Any) -> SimpleNamespace:
    return SimpleNamespace(id=9, player_id=None, **fields)


class TestCreateAttachesAndDoesNotPin(IsolatedAsyncioTestCase):
    async def test_create_attaches_and_leaves_overridden_at_none(self) -> None:
        session = _Session()
        wp = _wp()
        upsert = mock.AsyncMock(return_value=wp)
        set_ranks = mock.AsyncMock(return_value={})
        resolve = mock.AsyncMock(return_value={})
        with (
            mock.patch.object(reg_lifecycle.lifecycle_service, "ensure_unique_battle_tag", _noop),
            mock.patch.object(
                reg_lifecycle.lifecycle_service.common, "get_registration_form", mock.AsyncMock(return_value=None)
            ),
            mock.patch.object(reg_lifecycle, "enqueue_registration_approved", _noop),
            mock.patch.object(
                reg_lifecycle.lifecycle_service,
                "get_registration_by_id",
                mock.AsyncMock(side_effect=lambda _s, _i: session.added[0]),
            ),
            mock.patch.object(workspace_players.workspace_player_service, "upsert", upsert),
            mock.patch.object(workspace_players.workspace_player_service, "set_ranks", set_ranks),
            mock.patch.object(workspace_players, "resolved_value_map", resolve),
        ):
            registration = await reg_lifecycle.lifecycle_service.create_manual_registration(
                session,
                tournament_id=7,
                display_name="P",
                battle_tag="Player#1234",
                smurf_tags_json=None,
                discord_nick=None,
                twitch_nick=None,
                notes=None,
                admin_notes=None,
                roles=[],
            )
        assert registration.workspace_player_id == 9
        assert registration.balancer_profile_overridden_at is None
        upsert.assert_awaited()
        set_ranks.assert_not_awaited()

    async def test_create_with_ranks_keeps_role_rank_and_skips_canon(self) -> None:
        session = _Session()
        wp = _wp()
        set_ranks = mock.AsyncMock(return_value={"tank": 2500})
        with (
            mock.patch.object(reg_lifecycle.lifecycle_service, "ensure_unique_battle_tag", _noop),
            mock.patch.object(
                reg_lifecycle.lifecycle_service.common, "get_registration_form", mock.AsyncMock(return_value=None)
            ),
            mock.patch.object(reg_lifecycle, "enqueue_registration_approved", _noop),
            mock.patch.object(
                reg_lifecycle.lifecycle_service,
                "get_registration_by_id",
                mock.AsyncMock(side_effect=lambda _s, _i: session.added[0]),
            ),
            mock.patch.object(workspace_players.workspace_player_service, "upsert", mock.AsyncMock(return_value=wp)),
            mock.patch.object(workspace_players.workspace_player_service, "set_ranks", set_ranks),
            mock.patch.object(workspace_players, "resolved_value_map", mock.AsyncMock(return_value={"tank": 2500})),
        ):
            registration = await reg_lifecycle.lifecycle_service.create_manual_registration(
                session,
                tournament_id=7,
                display_name="P",
                battle_tag="Player#1234",
                smurf_tags_json=None,
                discord_nick=None,
                twitch_nick=None,
                notes=None,
                admin_notes=None,
                roles=[{"role": "tank", "rank_value": 2500, "is_active": True, "is_primary": True, "priority": 0}],
            )
        set_ranks.assert_not_awaited()
        assert registration.roles[0].rank_value == 2500
        assert registration.balancer_profile_overridden_at is None


    async def test_create_without_battle_tag_keeps_role_rank(self) -> None:
        session = _Session()
        set_ranks = mock.AsyncMock(return_value={})
        with (
            mock.patch.object(reg_lifecycle.lifecycle_service, "ensure_unique_battle_tag", _noop),
            mock.patch.object(
                reg_lifecycle.lifecycle_service.common, "get_registration_form", mock.AsyncMock(return_value=None)
            ),
            mock.patch.object(reg_lifecycle, "enqueue_registration_approved", _noop),
            mock.patch.object(
                reg_lifecycle.lifecycle_service,
                "get_registration_by_id",
                mock.AsyncMock(side_effect=lambda _s, _i: session.added[0]),
            ),
            mock.patch.object(workspace_players.workspace_player_service, "upsert", mock.AsyncMock()),
            mock.patch.object(workspace_players.workspace_player_service, "set_ranks", set_ranks),
            mock.patch.object(workspace_players, "resolved_value_map", mock.AsyncMock(return_value={"tank": 2500})),
        ):
            registration = await reg_lifecycle.lifecycle_service.create_manual_registration(
                session,
                tournament_id=7,
                display_name="P",
                battle_tag=None,
                smurf_tags_json=None,
                discord_nick=None,
                twitch_nick=None,
                notes=None,
                admin_notes=None,
                roles=[{"role": "tank", "rank_value": 2500, "is_active": True, "is_primary": True, "priority": 0}],
            )
        set_ranks.assert_not_awaited()
        assert registration.workspace_player_id is None
        assert registration.roles[0].rank_value == 2500

class TestUpdatePinAndFollow(IsolatedAsyncioTestCase):
    def _registration(self) -> models.BalancerRegistration:
        registration = models.BalancerRegistration(
            id=1, tournament_id=7, status="approved", battle_tag="Player#1234", balancer_status="incomplete"
        )
        registration.tournament = SimpleNamespace(workspace_id=1)
        registration.roles = [models.BalancerRegistrationRole(role="tank", is_active=True, rank_value=None)]
        registration.workspace_player_id = 9
        return registration

    async def _update(self, registration: models.BalancerRegistration, **overrides: Any) -> mock.AsyncMock:
        payload: dict[str, Any] = {
            "display_name": None,
            "battle_tag": None,
            "smurf_tags_json": None,
            "discord_nick": None,
            "twitch_nick": None,
            "notes": None,
            "admin_notes": None,
            "status_value": None,
            "balancer_status_value": None,
            "roles": None,
            **overrides,
        }
        set_ranks = mock.AsyncMock(return_value={"tank": 3000})
        with (
            mock.patch.object(
                reg_lifecycle.lifecycle_service, "get_registration_by_id", mock.AsyncMock(return_value=registration)
            ),
            mock.patch.object(reg_lifecycle.lifecycle_service.common, "_register_registration_changed", lambda *_a, **_k: None),
            mock.patch.object(
                reg_lifecycle.lifecycle_service.common, "get_registration_form", mock.AsyncMock(return_value=None)
            ),
            mock.patch.object(workspace_players.workspace_player_service, "upsert", mock.AsyncMock(return_value=_wp())),
            mock.patch.object(workspace_players.workspace_player_service, "set_ranks", set_ranks),
            mock.patch.object(workspace_players, "resolved_value_map", mock.AsyncMock(return_value={"tank": 3000})),
        ):
            await reg_lifecycle.lifecycle_service.update_registration_profile(_Session(), registration.id, **payload)
        return set_ranks

    async def test_unpinned_patch_writes_role_rank_and_skips_canon(self) -> None:
        registration = self._registration()
        set_ranks = await self._update(
            registration,
            roles=[{"role": "tank", "rank_value": 3000, "is_active": True, "is_primary": True, "priority": 0}],
        )
        set_ranks.assert_not_awaited()
        assert registration.balancer_profile_overridden_at is None
        assert registration.roles[0].rank_value == 3000

    async def test_pinned_patch_sets_role_rank_and_skips_canon(self) -> None:
        registration = self._registration()
        set_ranks = await self._update(
            registration,
            pin=True,
            roles=[{"role": "tank", "rank_value": 3100, "is_active": True, "is_primary": True, "priority": 0}],
        )
        set_ranks.assert_not_awaited()
        assert registration.balancer_profile_overridden_at is not None
        assert registration.roles[0].rank_value == 3100

    async def test_notes_alone_do_not_pin(self) -> None:
        registration = self._registration()
        set_ranks = await self._update(registration, admin_notes="hi")
        set_ranks.assert_not_awaited()
        assert registration.balancer_profile_overridden_at is None
        assert registration.admin_notes == "hi"

    async def test_clear_pin_clears_flag_and_keeps_role_ranks(self) -> None:
        registration = self._registration()
        registration.balancer_profile_overridden_at = datetime.now(UTC)
        registration.roles[0].rank_value = 3100
        set_ranks = await self._update(registration, clear_pin=True)
        set_ranks.assert_not_awaited()
        assert registration.balancer_profile_overridden_at is None
        assert registration.roles[0].rank_value == 3100

    async def test_update_without_battle_tag_keeps_role_rank(self) -> None:
        registration = self._registration()
        registration.battle_tag = None
        registration.workspace_player_id = None
        set_ranks = await self._update(
            registration,
            roles=[{"role": "tank", "rank_value": 3000, "is_active": True, "is_primary": True, "priority": 0}],
        )
        set_ranks.assert_not_awaited()
        assert registration.workspace_player_id is None
        assert registration.roles[0].rank_value == 3000


class TestAutofillApplyDoesNotPin(IsolatedAsyncioTestCase):
    async def test_apply_attaches_identity_and_leaves_role_rank(self) -> None:
        registration = models.BalancerRegistration(
            id=1, tournament_id=7, status="approved", battle_tag="P#1", balancer_status="incomplete"
        )
        role = models.BalancerRegistrationRole(role="tank", is_active=True, rank_value=2800)
        registration.roles = [role]
        set_ranks = mock.AsyncMock(return_value={"tank": 2800})
        session = _Session()
        with (
            mock.patch.object(workspace_players.workspace_player_service, "upsert", mock.AsyncMock(return_value=_wp())),
            mock.patch.object(workspace_players.workspace_player_service, "set_ranks", set_ranks),
        ):
            wp = await workspace_players.attach_workspace_player(session, registration, workspace_id=1)
        assert wp.id == 9
        assert registration.workspace_player_id == 9
        assert registration.balancer_profile_overridden_at is None
        assert role.rank_value == 2800
        set_ranks.assert_not_awaited()

    async def test_apply_loop_writes_role_rank_not_canon(self) -> None:
        registration = SimpleNamespace(
            id=1,
            tournament_id=7,
            status="approved",
            battle_tag="P#1",
            battle_tag_normalized="p#1",
            display_name="P",
            workspace_member_id=None,
            workspace_member=None,
            balancer_status="incomplete",
            balancer_profile_overridden_at=None,
            roles=[SimpleNamespace(role="tank", is_active=True, rank_value=None, priority=0)],
            exclude_reason=None,
        )
        service = rank_autofill.RankAutofillService()
        set_ranks = mock.AsyncMock(return_value={"tank": 2800})
        tournament = SimpleNamespace(id=7, workspace_id=1, division_grid_version=None, start_date=None)
        with (
            mock.patch.object(service.rank_sources, "_load_tournament_for_autofill", mock.AsyncMock(return_value=tournament)),
            mock.patch.object(
                service.rank_sources, "_load_rank_autofill_registrations", mock.AsyncMock(return_value=[registration])
            ),
            mock.patch.object(service.rank_sources, "_load_main_battle_tags_by_key", mock.AsyncMock(return_value={})),
            mock.patch.object(workspace_players.workspace_player_service, "upsert", mock.AsyncMock(return_value=_wp())),
            mock.patch.object(workspace_players.workspace_player_service, "set_ranks", set_ranks),
            mock.patch.object(workspace_players, "resolved_value_map", mock.AsyncMock(return_value={"tank": 2800})),
            mock.patch.object(service.common, "_register_registration_changed", lambda *_a, **_k: None),
            mock.patch.object(rank_autofill, "build_registration_rank_autofill_plan") as plan,
        ):
            plan.return_value = (
                {"registration_id": 1, "roles": [], "status": "will_update"},
                [(registration.roles[0], SimpleNamespace(rank_value=2800))],
            )
            await service.autofill_registration_ranks_from_parsed(_Session(), 7, apply=True, allow_partial=True)
        assert registration.balancer_profile_overridden_at is None
        assert registration.roles[0].rank_value == 2800
        set_ranks.assert_not_awaited()


class TestSerializeStoredRank(IsolatedAsyncioTestCase):
    def test_serialize_uses_registration_rank(self) -> None:
        role = models.BalancerRegistrationRole(
            role="tank", subrole=None, priority=0, is_primary=True, rank_value=3200, is_active=True
        )
        payload = serializers.serialize_registration_role(role)
        assert payload.rank_value == 3200
        assert payload.rank_source == "override"


class TestResolveKeepsRoleRank(IsolatedAsyncioTestCase):
    async def test_no_workspace_player_keeps_role_rank(self) -> None:
        registration = models.BalancerRegistration(id=1, tournament_id=7, battle_tag=None)
        registration.roles = [models.BalancerRegistrationRole(role="tank", is_active=True, rank_value=2500)]
        registration.workspace_player_id = None
        with mock.patch.object(
            workspace_players.workspace_player_service, "resolve_ranks", mock.AsyncMock(return_value={})
        ) as resolve:
            by_id = await workspace_players.resolve_registration_ranks(_Session(), [registration])
        resolve.assert_not_awaited()
        assert by_id[1]["tank"].value == 2500
        assert by_id[1]["tank"].source == "override"

    async def test_attached_player_does_not_read_mix_canon(self) -> None:
        registration = models.BalancerRegistration(id=1, tournament_id=7, battle_tag="P#1")
        registration.roles = [models.BalancerRegistrationRole(role="tank", is_active=True, rank_value=2500)]
        registration.workspace_player_id = 9
        with mock.patch.object(
            workspace_players.workspace_player_service, "resolve_ranks", mock.AsyncMock(return_value={
                (9, "tank"): ResolvedRank(9999, "canon"),
            })
        ) as resolve:
            by_id = await workspace_players.resolve_registration_ranks(_Session(), [registration])
        resolve.assert_not_awaited()
        assert by_id[1]["tank"].value == 2500
