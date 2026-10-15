from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, MagicMock

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


from pydantic import ValidationError  # noqa: E402

from src.schemas.user_prefs import UserMixPreferencesUpsert  # noqa: E402
from src.services.user_prefs import UserMixPrefsService  # noqa: E402


class UserMixPrefsServiceTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    def setUp(self) -> None:
        self.configs = MagicMock()
        self.configs.get_by_user = AsyncMock(return_value=None)
        self.configs.create = AsyncMock(side_effect=lambda _session, row: row)
        self.service = UserMixPrefsService(configs=self.configs)
        self.session = MagicMock()
        self.session.commit = AsyncMock()

    async def test_an_unset_knob_is_an_absent_key_not_a_null(self) -> None:
        """The blob is handed to the solver untouched, so a stored null would
        override the engine default with nothing."""
        config = await self.service.upsert(
            self.session,
            user_id=9,
            mix_comfort_tilt=0.75,
            role_settings=None,
            max_result_variants=None,
            open_slot_settings=None,
            points_per_win=None,
            rating_mode="points",
        )

        self.assertEqual(config.config_json, {"mix_comfort_tilt": 0.75})

    async def test_the_hosts_per_role_weights_store_as_role_settings(self) -> None:
        """The mix engine reads them off the same ``role_settings`` block the
        tournament config uses -- one shape, whoever wrote it."""
        config = await self.service.upsert(
            self.session,
            user_id=9,
            mix_comfort_tilt=None,
            role_settings={"tank": {"mix_weight": 2.5}},
            max_result_variants=None,
            open_slot_settings=None,
            points_per_win=None,
            rating_mode="points",
        )

        self.assertEqual(config.config_json, {"role_settings": {"tank": {"mix_weight": 2.5}}})

    async def test_an_account_that_saved_nothing_stores_an_empty_blob(self) -> None:
        config = await self.service.upsert(
            self.session,
            user_id=9,
            mix_comfort_tilt=None,
            role_settings=None,
            max_result_variants=None,
            open_slot_settings=None,
            points_per_win=None,
            rating_mode="points",
        )

        self.assertEqual(config.config_json, {})
        self.assertIsNone(config.points_per_win)

    async def test_the_open_slot_weight_stores_as_open_slot_settings(self) -> None:
        config = await self.service.upsert(
            self.session,
            user_id=9,
            mix_comfort_tilt=None,
            role_settings=None,
            open_slot_settings={"mix_weight": 0.5},
            max_result_variants=None,
            points_per_win=None,
            rating_mode="points",
        )
        self.assertEqual(config.config_json, {"open_slot_settings": {"mix_weight": 0.5}})

    async def test_zero_points_stores_as_unset(self) -> None:
        """ "Off" has one spelling in the column, whichever of null/0 was sent."""
        config = await self.service.upsert(
            self.session,
            user_id=9,
            mix_comfort_tilt=None,
            role_settings=None,
            max_result_variants=None,
            open_slot_settings=None,
            points_per_win=0,
            rating_mode="points",
        )

        self.assertIsNone(config.points_per_win)


class UserMixPreferencesBoundsTests(TestCase):
    """The wire bounds, which are the only thing between a typo and the solver."""

    #: Every key is required, so each case below overrides one of these.
    _UNSET = {
        "mix_comfort_tilt": None,
        "role_settings": None,
        "max_result_variants": None,
        "open_slot_settings": None,
        "points_per_win": None,
        "rating_mode": "points",
    }

    def _validate(self, **overrides: object) -> UserMixPreferencesUpsert:
        return UserMixPreferencesUpsert.model_validate({**self._UNSET, **overrides})

    def test_an_unknown_knob_is_rejected_rather_than_stored(self) -> None:
        with self.assertRaises(ValidationError):
            self._validate(population_size=200)

    def test_a_missing_key_is_rejected_rather_than_defaulted(self) -> None:
        """A PUT is a full replacement: a client that forgets a key must not
        silently clear it."""
        with self.assertRaises(ValidationError):
            UserMixPreferencesUpsert.model_validate(
                {key: value for key, value in self._UNSET.items() if key != "points_per_win"}
            )

    def test_result_variants_above_the_solver_ceiling_are_rejected(self) -> None:
        self._validate(max_result_variants=100)
        with self.assertRaises(ValidationError):
            self._validate(max_result_variants=101)

    def test_a_tilt_outside_the_zero_to_one_trade_off_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            self._validate(mix_comfort_tilt=1.5)

    def test_unknown_roles_and_open_slots_are_not_role_settings(self) -> None:
        for code in ("healer", "flex"):
            with self.subTest(code=code), self.assertRaises(ValidationError):
                self._validate(role_settings={code: {"mix_weight": 2.0}})

    def test_a_tournament_only_role_weight_is_rejected(self) -> None:
        """A host sets the mix weight; ``impact`` and the line weights are the
        operator's, and must not reach the solver through a preferences PUT."""
        with self.assertRaises(ValidationError):
            self._validate(role_settings={"tank": {"mix_weight": 2.0, "impact": 3.0}})

    def test_points_above_the_ceiling_are_rejected(self) -> None:
        """A fat-fingered 10000 would wreck the host's whole rank book in one
        recorded match."""
        with self.assertRaises(ValidationError):
            self._validate(points_per_win=1001)

    def test_negative_points_are_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            self._validate(points_per_win=-1)

    def test_an_unknown_rating_mode_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            self._validate(rating_mode="elo")
