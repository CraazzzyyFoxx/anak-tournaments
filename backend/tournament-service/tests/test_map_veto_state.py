from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

from datetime import UTC, datetime  # noqa: E402

from shared.core.enums import MapPickSide, MapPoolEntryStatus, MapVetoSessionStatus  # noqa: E402
from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from src.services.encounter.map_veto import (  # noqa: E402
    apply_veto_action,
    auto_complete_decider_entry,
    build_map_pool_state,
    build_unavailable_state,
    current_slot,
    serialize_map_pool_entry,
    serialize_veto_session,
)


def make_pool_entry(
    map_id: int,
    *,
    status: MapPoolEntryStatus = MapPoolEntryStatus.AVAILABLE,
    order: int = 0,
    action_index: int | None = None,
    picked_by: MapPickSide | None = None,
    team_id: int | None = None,
    slot: int | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=map_id,
        map_id=map_id,
        order=order,
        action_index=action_index,
        status=status,
        picked_by=picked_by,
        team_id=team_id,
        slot=slot,
    )


def make_veto_session(
    sequence: list[str],
    *,
    status: MapVetoSessionStatus = MapVetoSessionStatus.ACTIVE,
    first_side: MapPickSide = MapPickSide.HOME,
    slot_reserves_json: dict | None = None,
    config_reserves: dict[int, int] | None = None,
) -> SimpleNamespace:
    """A veto session row.

    ``config_reserves`` stands in for the live ``MapVetoConfig`` the session was
    built from, mapping position to reserve map id. It exists so a test can make
    the config DISAGREE with the snapshot: ``config_id`` is a real relationship,
    so reading reserves off it is one attribute away and would look harmless.
    """
    started = datetime(2026, 7, 18, 12, 0, tzinfo=UTC)
    return SimpleNamespace(
        id=1,
        status=status,
        first_side=first_side,
        seed_source="bracket_slot",
        home_seed=1,
        away_seed=4,
        turn_timer_seconds=60,
        started_at=started,
        current_step_started_at=started,
        resolved_sequence_json=sequence,
        slot_reserves_json=slot_reserves_json,
        config=SimpleNamespace(
            slots=[
                SimpleNamespace(position=position, reserve_map_id=map_id)
                for position, map_id in sorted((config_reserves or {}).items())
            ]
        ),
    )


class BuildMapPoolStateTests(TestCase):
    def test_home_viewer_can_only_ban_on_home_ban_step(self) -> None:
        pool = [
            make_pool_entry(1, order=0),
            make_pool_entry(2, order=1),
            make_pool_entry(3, order=2),
        ]

        state = build_map_pool_state(["ban_home", "pick_away"], pool, viewer_side="home")

        self.assertEqual("ban_home", state["current_step"])
        self.assertEqual("ban", state["expected_action"])
        self.assertEqual("home", state["turn_side"])
        self.assertEqual(["ban"], state["allowed_actions"])
        self.assertTrue(state["viewer_can_act"])
        self.assertFalse(state["is_complete"])

    def test_other_viewer_cannot_act_when_not_their_turn(self) -> None:
        pool = [
            make_pool_entry(1, order=0),
            make_pool_entry(2, order=1),
            make_pool_entry(3, order=2),
        ]

        state = build_map_pool_state(["ban_home", "pick_away"], pool, viewer_side="away")

        self.assertEqual("home", state["turn_side"])
        self.assertEqual([], state["allowed_actions"])
        self.assertFalse(state["viewer_can_act"])

    def test_away_viewer_can_only_pick_on_away_pick_step(self) -> None:
        pool = [
            make_pool_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME),
            make_pool_entry(2, order=1),
            make_pool_entry(3, order=2),
        ]

        state = build_map_pool_state(["ban_home", "pick_away"], pool, viewer_side="away")

        self.assertEqual("pick_away", state["current_step"])
        self.assertEqual("pick", state["expected_action"])
        self.assertEqual("away", state["turn_side"])
        self.assertEqual(["pick"], state["allowed_actions"])
        self.assertTrue(state["viewer_can_act"])

    def test_decider_step_is_not_actionable_by_viewer(self) -> None:
        pool = [
            make_pool_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME),
            make_pool_entry(2, status=MapPoolEntryStatus.PICKED, picked_by=MapPickSide.AWAY),
            make_pool_entry(3, order=2),
        ]

        state = build_map_pool_state(["ban_home", "pick_away", "decider"], pool, viewer_side="home")

        self.assertEqual("decider", state["current_step"])
        self.assertEqual("decider", state["expected_action"])
        self.assertIsNone(state["turn_side"])
        self.assertEqual([], state["allowed_actions"])
        self.assertFalse(state["viewer_can_act"])

    def test_complete_sequence_reports_no_pending_step(self) -> None:
        pool = [
            make_pool_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME),
            make_pool_entry(2, status=MapPoolEntryStatus.PICKED, picked_by=MapPickSide.AWAY),
        ]

        state = build_map_pool_state(["ban_home", "pick_away"], pool, viewer_side="away")

        self.assertIsNone(state["current_step"])
        self.assertIsNone(state["expected_action"])
        self.assertIsNone(state["turn_side"])
        self.assertEqual([], state["allowed_actions"])
        self.assertTrue(state["is_complete"])


class AutoCompleteDeciderEntryTests(TestCase):
    def test_marks_last_available_map_as_decider_pick(self) -> None:
        pool = [
            make_pool_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME, order=0),
            make_pool_entry(2, status=MapPoolEntryStatus.PICKED, picked_by=MapPickSide.AWAY, order=1),
            make_pool_entry(3, status=MapPoolEntryStatus.AVAILABLE, order=2),
        ]

        resolved = auto_complete_decider_entry(["ban_home", "pick_away", "decider"], pool)

        self.assertIsNotNone(resolved)
        self.assertEqual(MapPoolEntryStatus.PICKED, resolved.status)
        self.assertEqual(MapPickSide.DECIDER, resolved.picked_by)
        self.assertEqual(2, resolved.order)
        self.assertEqual(2, resolved.action_index)


class CurrentSlotTests(TestCase):
    def test_returns_the_lowest_slot_with_an_available_map(self) -> None:
        pool = [
            make_pool_entry(1, slot=1, status=MapPoolEntryStatus.BANNED),
            make_pool_entry(2, slot=1),
            make_pool_entry(3, slot=2),
        ]

        self.assertEqual(1, current_slot(pool))

    def test_advances_to_the_lowest_unresolved_slot_regardless_of_pool_order(self) -> None:
        """Advancement is the load-bearing claim behind ``min``, and the only
        thing the next slot's action validation can rest on. Slot 1 is fully
        resolved, so the answer is 2 -- and the entries are deliberately listed
        out of play order so the assertion pins the ascending slot number rather
        than the position in the pool."""
        pool = [
            make_pool_entry(5, slot=3),
            make_pool_entry(6, slot=3),
            make_pool_entry(3, slot=2),
            make_pool_entry(4, slot=2),
            make_pool_entry(1, slot=1, status=MapPoolEntryStatus.BANNED),
            make_pool_entry(2, slot=1, status=MapPoolEntryStatus.PICKED),
        ]

        self.assertEqual(2, current_slot(pool))

    def test_returns_none_when_every_entry_is_consumed(self) -> None:
        """The terminal state of every finished slot-mode veto. An unguarded
        ``min()`` raised here, on the read path that serves the room."""
        pool = [make_pool_entry(1, slot=1, status=MapPoolEntryStatus.PICKED)]

        self.assertIsNone(current_slot(pool))

    def test_returns_none_for_a_flat_pool(self) -> None:
        self.assertIsNone(current_slot([make_pool_entry(1), make_pool_entry(2)]))


class SlotScopedDeciderTests(TestCase):
    def test_resolves_slot_one_while_slot_two_still_has_maps(self) -> None:
        """The decider closes one slot at a time: another slot's untouched
        candidates must not count toward this slot's "exactly one available".
        Pre-fix the check counted AVAILABLE across the whole pool, so slot 2's
        three candidates made it != 1 and this raised 400."""
        pool = [
            make_pool_entry(1, slot=1, status=MapPoolEntryStatus.BANNED),
            make_pool_entry(2, slot=1, status=MapPoolEntryStatus.BANNED),
            make_pool_entry(3, slot=1),
            make_pool_entry(4, slot=2),
            make_pool_entry(5, slot=2),
            make_pool_entry(6, slot=2),
        ]
        sequence = ["ban_home", "ban_away", "decider", "ban_home", "ban_away", "decider"]

        entry = auto_complete_decider_entry(sequence, pool)

        self.assertEqual(3, entry.map_id)
        self.assertEqual(MapPoolEntryStatus.PICKED, entry.status)


class SerializationTests(TestCase):
    def test_pool_entry_includes_action_index(self) -> None:
        entry = make_pool_entry(7, status=MapPoolEntryStatus.BANNED, action_index=3, picked_by=MapPickSide.AWAY)

        data = serialize_map_pool_entry(entry)

        self.assertEqual(
            {
                "id": 7,
                "map_id": 7,
                "slot": None,
                "order": 0,
                "action_index": 3,
                "picked_by": MapPickSide.AWAY,
                "team_id": None,
                "status": MapPoolEntryStatus.BANNED,
            },
            data,
        )

    def test_veto_session_serializes_iso_datetimes(self) -> None:
        veto = make_veto_session(["ban_home", "pick_away"])

        data = serialize_veto_session(veto)

        self.assertEqual("2026-07-18T12:00:00+00:00", data["started_at"])
        self.assertEqual("2026-07-18T12:00:00+00:00", data["current_step_started_at"])
        self.assertEqual(MapVetoSessionStatus.ACTIVE, data["status"])
        self.assertEqual(1, data["home_seed"])
        self.assertEqual(4, data["away_seed"])

    def test_veto_session_carries_the_reserve_snapshot_out_verbatim(self) -> None:
        # The room's reserve label reads this and nothing else (Decision 18), so
        # the serializer must not re-key, sort or fill it: the keys stay the
        # ``position`` strings the column holds, gaps and all, and a slot with no
        # reserve stays absent rather than becoming an explicit null the client
        # would have to filter. Positions 2/5/9 are gapped and never equal a map
        # id here, so an index-for-position slip cannot pass.
        veto = make_veto_session(["ban_home", "decider"], slot_reserves_json={"2": 41, "9": 33})

        data = serialize_veto_session(veto)

        self.assertEqual({"2": 41, "9": 33}, data["slot_reserves"])
        self.assertNotIn("5", data["slot_reserves"])

    def test_veto_session_reports_a_flat_pool_as_a_null_snapshot(self) -> None:
        # NULL, not ``{}``: the client distinguishes "no slots at all" from "slots
        # that named no reserve" the same way ``_require_flat_veto`` does.
        data = serialize_veto_session(make_veto_session(["ban_home", "pick_away"]))

        self.assertIsNone(data["slot_reserves"])

    def test_veto_session_prefers_the_snapshot_over_a_config_that_has_since_changed(self) -> None:
        # Decision 18: the session runs off its own snapshot, and the config it
        # was built from stays editable underneath it. The two disagree on every
        # slot here — including one the config added and one it dropped — so
        # reading the relationship instead cannot coincide with the right answer.
        veto = make_veto_session(
            ["ban_home", "decider"],
            slot_reserves_json={"2": 41, "9": 33},
            config_reserves={2: 44, 5: 21, 9: 22},
        )

        data = serialize_veto_session(veto)

        self.assertEqual({"2": 41, "9": 33}, data["slot_reserves"])

    def test_state_includes_sequence_and_session(self) -> None:
        veto = make_veto_session(["ban_home", "pick_away"])
        pool = [make_pool_entry(1), make_pool_entry(2), make_pool_entry(3)]

        state = build_map_pool_state(veto.resolved_sequence_json, pool, viewer_side="home", veto=veto)

        self.assertEqual(["ban_home", "pick_away"], state["sequence"])
        self.assertEqual(1, state["session"]["id"])
        self.assertEqual(MapVetoSessionStatus.ACTIVE, state["session"]["status"])

    def test_unavailable_state_shapes(self) -> None:
        for reason in ("not_configured", "teams_unknown"):
            state = build_unavailable_state(reason)
            self.assertEqual(
                {
                    "session": None,
                    "reason": reason,
                    "sequence": [],
                    "pool": [],
                    "viewer_side": None,
                    "viewer_can_act": False,
                    "allowed_actions": [],
                    "current_step_index": None,
                    "current_step": None,
                    "expected_action": None,
                    "turn_side": None,
                    "current_slot": None,
                    "is_complete": False,
                },
                state,
            )

    def test_pool_entry_carries_its_slot(self) -> None:
        """``test_pool_entry_includes_action_index`` is exhaustive, so it already
        catches the key going missing -- but its fixture is flat (``slot=None``),
        which a hardcoded ``"slot": None`` would satisfy just as well. A non-None
        slot is what pins the serializer to the entry's own value.
        """
        self.assertEqual(2, serialize_map_pool_entry(make_pool_entry(7, slot=2))["slot"])

    def test_state_exposes_the_active_slot(self) -> None:
        """Slot 2's candidates are listed first on purpose: the payload must name
        the lowest unresolved slot, not whichever slot the pool happens to open
        with."""
        pool = [
            make_pool_entry(3, slot=2),
            make_pool_entry(4, slot=2),
            make_pool_entry(1, slot=1),
            make_pool_entry(2, slot=1),
        ]

        state = build_map_pool_state(["ban_home", "decider", "ban_away", "decider"], pool)

        self.assertEqual(1, state["current_slot"])

    def test_flat_pool_state_exposes_no_slot(self) -> None:
        state = build_map_pool_state(["ban_home", "pick_away"], [make_pool_entry(1), make_pool_entry(2)])

        self.assertIsNone(state["current_slot"])

    def test_completed_slot_mode_state_serializes_without_raising(self) -> None:
        """Design property 8. The room keeps reading state after the veto ends,
        so the terminal slot-mode pool has to serialize at all. An unguarded
        ``min()`` over an empty available-slot list raised ValueError right here
        -- on a read path, for every finished slot-mode encounter.
        """
        veto = make_veto_session(["ban_home", "decider"], status=MapVetoSessionStatus.COMPLETED)
        pool = [
            make_pool_entry(1, slot=1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME, action_index=0),
            make_pool_entry(
                2,
                slot=1,
                status=MapPoolEntryStatus.PICKED,
                picked_by=MapPickSide.DECIDER,
                action_index=1,
                order=1,
            ),
        ]

        state = build_map_pool_state(veto.resolved_sequence_json, pool, viewer_side="home", veto=veto)

        self.assertIsNone(state["current_slot"])
        self.assertTrue(state["is_complete"])

    def test_both_state_builders_carry_the_same_keys(self) -> None:
        """The room's state comes from either builder, so a field added to one
        silently diverges the shape of the other. ``reason`` is the single
        legitimate exclusive -- it is set only when there is no session, and the
        frontend type marks it optional for exactly that reason.

        Asserting the key sets against each other, rather than maintaining a
        second hand-written list, is what makes an omission in *either* builder
        fail: ``test_unavailable_state_shapes`` covers one direction only, and
        nothing covered the other.
        """
        pool_state = build_map_pool_state(["ban_home"], [make_pool_entry(1)])
        unavailable_state = build_unavailable_state("not_configured")

        self.assertEqual(
            {"reason"},
            set(unavailable_state) - set(pool_state),
            "the unavailable state carries a key the map pool state does not",
        )
        self.assertEqual(
            set(),
            set(pool_state) - set(unavailable_state),
            "the map pool state carries a key the unavailable state does not",
        )


class SlotStateWalkTests(TestCase):
    NOW = datetime(2026, 7, 18, 13, 0, tzinfo=UTC)

    def test_payload_slot_tracks_the_slot_each_accepted_action_consumes(self) -> None:
        """``current_slot`` is what the room highlights, so it has to name the
        slot the engine will actually accept an action in. Checked by advertising
        first and acting second: every entry the engine consumes must belong to
        the slot the payload named *before* that action. Slot 2's candidates lead
        the pool so a positional reading of the slot fails at the first step.
        """
        sequence = ["ban_home", "ban_away", "decider", "ban_home", "ban_away", "decider"]
        veto = make_veto_session(sequence)
        pool = [
            make_pool_entry(4, slot=2),
            make_pool_entry(5, slot=2),
            make_pool_entry(6, slot=2),
            make_pool_entry(1, slot=1),
            make_pool_entry(2, slot=1),
            make_pool_entry(3, slot=1),
        ]

        def advertised_slot() -> int | None:
            return build_map_pool_state(sequence, pool, veto=veto)["current_slot"]

        advertised: list[int | None] = []
        consumed: list[int | None] = []
        for side, map_id in (("home", 1), ("away", 2)):
            advertised.append(advertised_slot())
            consumed.append(apply_veto_action(veto, pool, side, map_id, "ban", now=self.NOW).slot)
        advertised.append(advertised_slot())
        consumed.append(auto_complete_decider_entry(sequence, pool).slot)
        for side, map_id in (("home", 4), ("away", 5)):
            advertised.append(advertised_slot())
            consumed.append(apply_veto_action(veto, pool, side, map_id, "ban", now=self.NOW).slot)
        advertised.append(advertised_slot())
        consumed.append(auto_complete_decider_entry(sequence, pool).slot)

        self.assertEqual([1, 1, 1, 2, 2, 2], advertised)
        self.assertEqual(advertised, consumed)
        self.assertIsNone(advertised_slot(), "a fully consumed slot pool advertises no slot")


class ApplyVetoActionTests(TestCase):
    NOW = datetime(2026, 7, 18, 13, 0, tzinfo=UTC)

    def test_actions_stamp_global_action_index(self) -> None:
        veto = make_veto_session(["ban_home", "ban_away", "pick_home"])
        pool = [make_pool_entry(1), make_pool_entry(2), make_pool_entry(3)]

        first = apply_veto_action(veto, pool, "home", 1, "ban", now=self.NOW)
        second = apply_veto_action(veto, pool, "away", 2, "ban", now=self.NOW)

        self.assertEqual(0, first.action_index)
        self.assertEqual(MapPoolEntryStatus.BANNED, first.status)
        self.assertEqual(MapPickSide.HOME, first.picked_by)
        self.assertEqual(1, second.action_index)
        self.assertEqual(self.NOW, veto.current_step_started_at)
        self.assertEqual(MapVetoSessionStatus.ACTIVE, veto.status)

    def test_final_step_completes_session(self) -> None:
        veto = make_veto_session(["ban_home", "pick_away"])
        pool = [
            make_pool_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME, action_index=0),
            make_pool_entry(2),
            make_pool_entry(3),
        ]

        entry = apply_veto_action(veto, pool, "away", 2, "pick", now=self.NOW)

        self.assertEqual(1, entry.action_index)
        self.assertEqual(MapPoolEntryStatus.PICKED, entry.status)
        self.assertEqual(MapVetoSessionStatus.COMPLETED, veto.status)

    def test_rejects_wrong_turn(self) -> None:
        veto = make_veto_session(["ban_home", "ban_away"])
        pool = [make_pool_entry(1), make_pool_entry(2)]

        with self.assertRaises(HTTPException) as ctx:
            apply_veto_action(veto, pool, "away", 1, "ban", now=self.NOW)

        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual("It's home team's turn, not away", ctx.exception.detail)

    def test_rejects_wrong_action_type(self) -> None:
        veto = make_veto_session(["ban_home", "pick_away"])
        pool = [make_pool_entry(1), make_pool_entry(2)]

        with self.assertRaises(HTTPException) as ctx:
            apply_veto_action(veto, pool, "home", 1, "pick", now=self.NOW)

        self.assertEqual("Expected action 'ban', got 'pick'", ctx.exception.detail)

    def test_rejects_unavailable_map(self) -> None:
        veto = make_veto_session(["ban_home", "ban_away"])
        pool = [
            make_pool_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME, action_index=0),
            make_pool_entry(2),
        ]

        with self.assertRaises(HTTPException) as ctx:
            apply_veto_action(veto, pool, "away", 1, "ban", now=self.NOW)

        self.assertEqual("Map is already banned", str(ctx.exception.detail))

    def test_rejects_completed_sequence(self) -> None:
        veto = make_veto_session(["ban_home"])
        pool = [make_pool_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME, action_index=0)]

        with self.assertRaises(HTTPException) as ctx:
            apply_veto_action(veto, pool, "home", 1, "ban", now=self.NOW)

        self.assertEqual("Veto sequence is already complete", ctx.exception.detail)


class SlotRestrictionTests(TestCase):
    NOW = datetime(2026, 7, 18, 13, 0, tzinfo=UTC)

    def test_rejects_banning_a_map_from_a_future_slot(self) -> None:
        """Slots are played one at a time, so a candidate of slot 2 is not a
        legal target while slot 1 is unresolved. Pre-fix the lookup keyed on
        ``map_id`` alone and happily banned it, consuming a step of slot 1 to
        remove a map slot 1 never offered."""
        veto = make_veto_session(["ban_home", "ban_away", "decider", "ban_home", "ban_away", "decider"])
        pool = [
            make_pool_entry(1, slot=1),
            make_pool_entry(2, slot=1),
            make_pool_entry(3, slot=1),
            make_pool_entry(4, slot=2),
            make_pool_entry(5, slot=2),
            make_pool_entry(6, slot=2),
        ]

        with self.assertRaises(HTTPException) as ctx:
            apply_veto_action(veto, pool, "home", 4, "ban", now=self.NOW)

        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual("Map is not a candidate of slot 1", str(ctx.exception.detail))
        self.assertEqual(
            [MapPoolEntryStatus.AVAILABLE] * 6,
            [entry.status for entry in pool],
            "a rejected action must not consume any entry",
        )

    def test_the_same_map_in_two_slots_resolves_to_the_current_slot_entry(self) -> None:
        """Banning map 1 while slot 1 is active must leave slot 2's entry for
        the same map AVAILABLE -- the lookup keys on (map_id, slot), not map_id.

        Slot 2's copy is listed *first* deliberately, and must stay that way:
        the lookup has to resolve by slot and never by pool position, and only
        an ordering that puts a later slot's copy ahead of the active slot's can
        tell those two apart. Tidied into ascending slot order, this test passes
        against a ``map_id``-only lookup -- which is exactly the pre-fix bug.
        """
        veto = make_veto_session(["ban_home", "decider", "ban_away", "decider"])
        slot_two_shared = make_pool_entry(1, slot=2)
        slot_two_other = make_pool_entry(2, slot=2)
        slot_one_shared = make_pool_entry(1, slot=1)
        slot_one_other = make_pool_entry(3, slot=1)
        pool = [slot_two_shared, slot_two_other, slot_one_shared, slot_one_other]

        entry = apply_veto_action(veto, pool, "home", 1, "ban", now=self.NOW)

        self.assertIs(slot_one_shared, entry)
        self.assertEqual(MapPoolEntryStatus.BANNED, slot_one_shared.status)
        self.assertEqual(MapPoolEntryStatus.AVAILABLE, slot_two_shared.status)
        self.assertEqual(MapPoolEntryStatus.AVAILABLE, slot_one_other.status)
        self.assertEqual(MapPoolEntryStatus.AVAILABLE, slot_two_other.status)
