"""``rpc.tournament.admin_veto_config_upsert`` accepts slot-mode configs.

This endpoint is the first and only writer of a slot-mode config, so every
guard the rest of the feature added becomes reachable here for the first time:
``validate_slot_config``'s five checks, the ``ck_map_veto_config_slots_not_custom``
CHECK, and the two cross-mode clears that keep a converted config from leaving
the other mode's rows behind.

Everything below drives the real subscriber through the real permission path
against a session fake that answers by the entity each query targets, so a
handler that asked for the wrong thing gets an ``AssertionError`` rather than a
conveniently correct answer. The configs are real ORM objects -- transient, so
no database is touched -- because the relationship collections are what the
handler actually assigns to and what ``serialize_veto_config`` reads back.

The fixture's numbers are deliberately all different from one another: three
slots with 4/2/3 candidates, positions 1..3 against indices 0..2, one reserve on
the MIDDLE slot, and candidates listed in an order that is neither ascending nor
descending by id. A handler that confused a position with an index, took the
first or last slot for the reserved one, or re-sorted candidates cannot pass by
coincidence.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

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
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

from shared.tests import eager_loading  # noqa: E402

veto_admin = importlib.import_module("src.rpc.veto_admin")
reads = importlib.import_module("src.rpc.reads")
helpers = importlib.import_module("src.rpc._helpers")
models = importlib.import_module("src.models")
enums = importlib.import_module("shared.core.enums")
veto_session_service = importlib.import_module("src.services.encounter.veto_session")
map_veto_service = importlib.import_module("src.services.encounter.map_veto")

UPSERT = "rpc.tournament.admin_veto_config_upsert"
LIST = "rpc.tournament.admin_veto_config_list"
PUBLIC_LIST = "rpc.tournament.get_veto_configs"

TOURNAMENT_ID = 7
#: Unequal to ``TOURNAMENT_ID`` and to ``ROUND``: a handler that mixed any two of
#: the three up would still land on a row if they shared a value.
STAGE_ID = 8
ROUND = 3
CONFIG_ID = 500
WORKSPACE_ID = 1

SLOTS = enums.MapVetoMode.SLOTS
POOL = enums.MapVetoMode.POOL
FIXED = enums.FirstBanRotation.FIXED
ALTERNATE = enums.FirstBanRotation.ALTERNATE

#: Candidate counts 4/2/3: unequal to each other, to the slot count and to every
#: position, and listed in an id order that is neither ascending nor descending.
CANDIDATES = [[51, 12, 33, 24], [77, 15], [88, 42, 66]]
#: Only the MIDDLE slot carries a reserve, and 99 is not a candidate anywhere, so
#: neither "the first slot's" nor "any slot's" reserve is interchangeable with it.
RESERVES: list[int | None] = [None, 99, None]

FLAT_SEQUENCE = ["ban_first", "ban_second", "pick_first", "pick_second", "decider"]
#: Six maps for five steps, none of them shared with the slot fixture, so a pool
#: that leaked into slot mode (or the reverse) is visible by value alone.
FLAT_MAP_IDS = [101, 102, 103, 104, 105, 106]

#: Grants exactly the gate this subject checks (``match.update``) and nothing
#: else, and is not a superuser, so the real permission path runs.
IDENTITY = {
    "user_id": 7,
    "is_superuser": False,
    "is_active": True,
    "roles": [],
    "permissions": [],
    "workspaces": [
        {
            "workspace_id": WORKSPACE_ID,
            "rbac_roles": [],
            "rbac_permissions": [{"resource": "match", "action": "update"}],
        }
    ],
}


def slot_payload(
    candidates: list[list[int]] | None = None,
    reserves: list[int | None] | None = None,
) -> list[dict]:
    """The ``slots`` body fragment, defaulting to the module fixture."""
    cands = CANDIDATES if candidates is None else candidates
    res = RESERVES if reserves is None else reserves
    return [{"candidates": list(c), "reserve_map_id": r} for c, r in zip(cands, res, strict=True)]


def slot_body(**overrides) -> dict:
    body = {
        "mode": SLOTS.value,
        "first_ban_rotation": ALTERNATE.value,
        "preset": "bracket",
        "turn_timer_seconds": 45,
        "sequence": [],
        "map_ids": [],
        "slots": slot_payload(),
    }
    body.update(overrides)
    return body


def flat_body(**overrides) -> dict:
    body = {
        "mode": POOL.value,
        "preset": "bo5",
        "turn_timer_seconds": 30,
        "sequence": list(FLAT_SEQUENCE),
        "map_ids": list(FLAT_MAP_IDS),
    }
    body.update(overrides)
    return body


def _config(mode, *, slots: list[list[int]] | None = None, map_ids: list[int] | None = None):
    """A persisted-looking config. Transient, so its collections need no DB."""
    config = models.MapVetoConfig(
        tournament_id=TOURNAMENT_ID,
        stage_id=None,
        round=None,
        mode=mode,
        first_ban_rotation=FIXED,
        preset="bo3",
        turn_timer_seconds=15,
        veto_sequence_json=[],
    )
    config.id = CONFIG_ID
    config.map_pool = [
        models.MapVetoConfigMap(map_id=map_id, sort_order=index) for index, map_id in enumerate(map_ids or [])
    ]
    config.slots = [
        models.MapVetoConfigSlot(
            position=index + 1,
            reserve_map_id=None,
            maps=[models.MapVetoConfigSlotMap(map_id=m, sort_order=i) for i, m in enumerate(candidates)],
        )
        for index, candidates in enumerate(slots or [])
    ]
    return config


class _Result:
    def __init__(self, rows: list) -> None:
        self._rows = rows

    def scalars(self):
        return self

    def unique(self):
        return self

    def all(self):
        return list(self._rows)


class _CapturingBroker:
    """Records the handler behind each subject instead of binding a queue."""

    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def subscriber(self, subject, *args, **kwargs):
        def register(fn):
            self.handlers[subject] = fn
            return fn

        return register


class _FakeSession:
    """Answers each query by the entity it targets, and records every statement.

    Dispatching on ``column_descriptions`` rather than on call order is what
    makes the fixture unable to flatter a wrong query: asking for anything the
    handler has no business asking for -- an ``EncounterVetoSession``, say --
    raises instead of returning a row.
    """

    def __init__(self, *, existing=None, configs: list | None = None, stage_tournament_id=TOURNAMENT_ID) -> None:
        self._existing = existing
        self._configs = configs if configs is not None else []
        self._stage_tournament_id = stage_tournament_id
        self.statements: dict[str, list] = {}
        self.added: list = []
        self.commits = 0
        self.refreshes: list[tuple[object, list[str]]] = []
        self.flushes: list[dict[str, list[int]]] = []

    def _record(self, query):
        entity = query.column_descriptions[0]["entity"]
        self.statements.setdefault(entity.__name__, []).append(query)
        return entity

    async def scalar(self, query):
        entity = self._record(query)
        if entity is models.Stage:
            return self._stage_tournament_id
        if entity is models.MapVetoConfig:
            return self._existing
        raise AssertionError(f"the handler queried an unexpected entity: {entity!r}")

    async def execute(self, query):
        entity = self._record(query)
        if entity is models.MapVetoConfig:
            return _Result(self._configs)
        raise AssertionError(f"the handler queried an unexpected entity: {entity!r}")

    async def scalars(self, query):
        return await self.execute(query)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj, names):
        self.refreshes.append((obj, list(names)))

    async def flush(self):
        # Snapshots the config's two child collections AS THEY STAND, which is
        # the only thing a fake can see about flush ordering: whether the
        # handler emitted the clear on its own or bundled it with the rebuild.
        # A real database distinguishes the two by rejecting the second, since
        # SQLAlchemy sends child INSERTs before child DELETEs.
        config = self._existing
        if config is None:
            configs = [obj for obj in self.added if isinstance(obj, models.MapVetoConfig)]
            config = configs[0] if configs else None
        if config is None:
            self.flushes.append({"map_pool": [], "slots": []})
            return
        self.flushes.append(
            {
                "map_pool": [entry.map_id for entry in config.map_pool],
                "slots": [slot.position for slot in config.slots],
            }
        )

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _UpsertCase(IsolatedAsyncioTestCase):
    async def invoke(self, body: dict, *, existing=None, stage_tournament_id=TOURNAMENT_ID):
        broker = _CapturingBroker()
        veto_admin.register(broker, SimpleNamespace(exception=lambda *a, **k: None))
        self.assertIn(UPSERT, broker.handlers, "subject is not registered")

        session = _FakeSession(existing=existing, stage_tournament_id=stage_tournament_id)

        async def _workspace_id(_session, tournament_id):
            self.assertEqual(TOURNAMENT_ID, tournament_id)
            return WORKSPACE_ID

        self.enterContext(patch.object(helpers.db, "async_session_maker", session))
        self.enterContext(patch.object(veto_admin.auth, "get_tournament_workspace_id", _workspace_id))

        envelope = await broker.handlers[UPSERT]({"identity": IDENTITY, "id": TOURNAMENT_ID, "payload": body}, None)
        return envelope, session

    def assert_unprocessable(self, envelope: dict, *fragments: str) -> str:
        self.assertFalse(envelope["ok"], envelope)
        self.assertEqual("unprocessable", envelope["error"]["code"], envelope)
        message = envelope["error"]["message"]
        for fragment in fragments:
            self.assertIn(fragment, message)
        return message

    def written_config(self, envelope: dict, session: _FakeSession):
        """The config the handler wrote, with the response asserted successful."""
        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual(1, session.commits, "the handler did not commit exactly once")
        configs = [obj for obj in session.added if isinstance(obj, models.MapVetoConfig)]
        self.assertEqual(1, len(configs), session.added)
        return configs[0]


# ── the body shape itself ────────────────────────────────────────────────────


class ModeIsRequired(_UpsertCase):
    async def test_omitting_mode_is_rejected(self) -> None:
        # Decision 17: the endpoint replaces the pool wholesale, so a default
        # would let a stale admin tab convert a slot config to flat in silence.
        #
        # ``type=missing`` rather than a bare "mode" match: a defaulted ``mode``
        # would send this same body down the pool branch, where the message
        # "slots must be empty in pool mode" contains "mode" too and would let
        # the mutant pass. Pydantic's own error type is what separates them.
        body = slot_body()
        del body["mode"]

        envelope, session = await self.invoke(body)

        self.assert_unprocessable(envelope, "mode", "type=missing")
        self.assertEqual(0, session.commits)

    async def test_an_unknown_mode_is_rejected_rather_than_read_as_flat(self) -> None:
        # Decision 10: ``mode`` is an enum precisely so a typo cannot fall
        # silently into flat mode. Same substring hazard as above, so this pins
        # the enum error rather than the word.
        envelope, session = await self.invoke(slot_body(mode="slot"))

        self.assert_unprocessable(envelope, "mode", "type=enum")
        self.assertEqual(0, session.commits)

    async def test_first_ban_rotation_defaults_to_fixed_when_omitted(self) -> None:
        body = slot_body()
        del body["first_ban_rotation"]

        envelope, session = await self.invoke(body)

        config = self.written_config(envelope, session)
        self.assertEqual(FIXED, config.first_ban_rotation)


# ── the cross-field 422s ─────────────────────────────────────────────────────


class ModeContradictions(_UpsertCase):
    async def test_each_contradiction_is_refused_and_names_the_empty_list(self) -> None:
        # Three payloads that pick one pool shape and then carry the other's
        # data. Slot mode: Decision 19 was withdrawn, so nothing mirrors slot
        # candidates into ``map_veto_config_map`` and the slots ARE the
        # sequence -- neither field is an alternative spelling of anything.
        # Pool mode: the same hazard as a defaulted ``mode``, a stale tab still
        # holding slot data saving as flat with the slots cleared and no signal.
        #
        # Each message must name ``[]`` rather than say only "must be empty":
        # all three fields default to empty, so omitting the key and sending
        # ``[]`` arrive identically and a client author would be left guessing.
        cases = {
            "map_ids": slot_body(map_ids=[101, 102]),
            "sequence": slot_body(sequence=["ban_first"]),
            "slots": flat_body(slots=slot_payload()),
        }
        for field, body in cases.items():
            with self.subTest(field=field):
                envelope, session = await self.invoke(body)
                message = self.assert_unprocessable(envelope, field)
                self.assertIn(f"send {field}: []", message)
                self.assertEqual(0, session.commits)


class CustomPresetIsUnstorableInSlotMode(_UpsertCase):
    async def test_a_custom_preset_is_refused_rather_than_left_to_the_check(self) -> None:
        # ``ck_map_veto_config_slots_not_custom`` would raise IntegrityError,
        # which ``_run`` maps to an opaque 500. The organizer gets a 422 instead,
        # and -- like the three contradiction messages -- it says what to send
        # rather than only what is wrong. ``BRACKET_PRESET`` by reference, so the
        # message cannot drift from the constant it advertises.
        envelope, session = await self.invoke(slot_body(preset=veto_session_service.CUSTOM_PRESET))

        self.assert_unprocessable(
            envelope,
            "preset",
            "custom",
            f"send preset: '{veto_session_service.BRACKET_PRESET}' or null",
        )
        self.assertEqual(0, session.commits)

    async def test_a_custom_preset_is_still_accepted_in_pool_mode(self) -> None:
        # The CHECK is conditioned on the mode; flat mode's hand-authored order
        # is exactly what ``custom`` is for.
        envelope, session = await self.invoke(flat_body(preset=veto_session_service.CUSTOM_PRESET))

        config = self.written_config(envelope, session)
        self.assertEqual("custom", config.preset)

    async def test_a_non_custom_preset_survives_a_slot_upsert(self) -> None:
        envelope, session = await self.invoke(slot_body(preset="bracket"))

        config = self.written_config(envelope, session)
        self.assertEqual("bracket", config.preset)


# ── validate_slot_config, reached through the endpoint ───────────────────────


class SlotValidationGuards(_UpsertCase):
    async def test_an_empty_slot_list_is_refused(self) -> None:
        envelope, session = await self.invoke(slot_body(slots=[]))

        self.assert_unprocessable(envelope, "slots must not be empty")
        self.assertEqual(0, session.commits)

    async def test_an_underfilled_slot_is_named_by_its_one_based_position(self) -> None:
        # The offender is the SECOND slot, so an ordinal taken from a 0-based
        # index would say "slot 1" and an off-by-one would say "slot 3".
        envelope, session = await self.invoke(
            slot_body(slots=slot_payload([[51, 12, 33, 24], [77], [88, 42, 66]], RESERVES))
        )

        self.assert_unprocessable(envelope, "slot 2 must have at least two candidate maps")
        self.assertEqual(0, session.commits)

    async def test_a_slot_repeating_a_candidate_is_refused(self) -> None:
        envelope, session = await self.invoke(
            slot_body(slots=slot_payload([[51, 12, 33, 24], [77, 15], [88, 42, 88]], RESERVES))
        )

        self.assert_unprocessable(envelope, "slot 3 must not repeat candidate map(s): 88")
        self.assertEqual(0, session.commits)

    async def test_a_reserve_that_is_its_own_slots_candidate_is_refused(self) -> None:
        envelope, session = await self.invoke(slot_body(slots=slot_payload(CANDIDATES, [None, 15, None])))

        self.assert_unprocessable(envelope, "slot 2 reserve must not be one of its own candidates")
        self.assertEqual(0, session.commits)

    async def test_a_reserve_may_be_another_slots_candidate(self) -> None:
        # Uniqueness is per slot: only within-slot duplication is meaningless.
        envelope, session = await self.invoke(slot_body(slots=slot_payload(CANDIDATES, [None, 88, None])))

        config = self.written_config(envelope, session)
        self.assertEqual([None, 88, None], [slot.reserve_map_id for slot in config.slots])

    async def test_a_map_may_be_a_candidate_in_several_slots(self) -> None:
        shared = [[51, 12, 33, 24], [51, 15], [88, 51, 66]]

        envelope, session = await self.invoke(slot_body(slots=slot_payload(shared, RESERVES)))

        config = self.written_config(envelope, session)
        self.assertEqual(shared, [[entry.map_id for entry in slot.maps] for slot in config.slots])

    async def test_the_reserve_list_the_handler_derives_is_parallel_to_the_slots(self) -> None:
        # ``validate_slot_config``'s length-mismatch guard cannot be tripped from
        # here -- both lists are comprehended from the same payload -- so what is
        # worth pinning is that the derivation stays parallel and in payload
        # order, which is what makes every OTHER guard report the right ordinal.
        seen: list[tuple[list[list[int]], list[int | None]]] = []

        def _spy(slots, *, reserves):
            seen.append((slots, list(reserves)))

        self.enterContext(patch.object(veto_admin.veto_session_service, "validate_slot_config", _spy))
        await self.invoke(slot_body())

        self.assertEqual([(CANDIDATES, RESERVES)], seen)


# ── the round trip ───────────────────────────────────────────────────────────


class SlotRoundTrip(_UpsertCase):
    async def test_a_slot_config_comes_back_exactly_as_it_was_sent(self) -> None:
        envelope, session = await self.invoke(slot_body())

        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual(
            {
                "mode": SLOTS,
                "first_ban_rotation": ALTERNATE,
                "sequence": [],
                "map_ids": [],
                "slots": [
                    {"position": 1, "candidates": [51, 12, 33, 24], "reserve_map_id": None},
                    {"position": 2, "candidates": [77, 15], "reserve_map_id": 99},
                    {"position": 3, "candidates": [88, 42, 66], "reserve_map_id": None},
                ],
            },
            {key: envelope["data"][key] for key in ("mode", "first_ban_rotation", "sequence", "map_ids", "slots")},
        )

    async def test_positions_are_one_based_and_follow_payload_order(self) -> None:
        envelope, session = await self.invoke(slot_body())

        config = self.written_config(envelope, session)
        # Positions 1..3 against indices 0..2: an ``enumerate`` left at its
        # default start would violate ``ck_map_veto_config_slot_position_positive``
        # and shift every ordinal ``validate_slot_config`` reports.
        self.assertEqual([1, 2, 3], [slot.position for slot in config.slots])

    async def test_reordering_the_payload_moves_the_positions_with_it(self) -> None:
        reordered = list(reversed(CANDIDATES))
        reordered_reserves = list(reversed(RESERVES))

        envelope, session = await self.invoke(slot_body(slots=slot_payload(reordered, reordered_reserves)))

        config = self.written_config(envelope, session)
        self.assertEqual(
            [(1, [88, 42, 66]), (2, [77, 15]), (3, [51, 12, 33, 24])],
            [(slot.position, [entry.map_id for entry in slot.maps]) for slot in config.slots],
        )

    async def test_candidate_sort_order_is_the_payload_order_not_the_id_order(self) -> None:
        # Asserting the stored ``sort_order`` values, not just the in-memory list:
        # ``slot_candidates`` reads ``maps`` back through the relationship's
        # ``order_by``, so a handler that wrote every candidate at sort_order 0
        # would look right here and shuffle after a reload.
        envelope, session = await self.invoke(slot_body())

        config = self.written_config(envelope, session)
        self.assertEqual(
            [[(0, 51), (1, 12), (2, 33), (3, 24)], [(0, 77), (1, 15)], [(0, 88), (1, 42), (2, 66)]],
            [[(entry.sort_order, entry.map_id) for entry in slot.maps] for slot in config.slots],
        )

    async def test_the_written_slots_are_what_the_session_builder_would_read(self) -> None:
        # The consumers' own accessors, not a re-implementation of them.
        envelope, session = await self.invoke(slot_body())

        config = self.written_config(envelope, session)
        self.assertEqual(CANDIDATES, veto_session_service.slot_candidates(config.slots))
        self.assertEqual({"2": 99}, veto_session_service.slot_reserves(config.slots))

    async def test_slot_mode_writes_no_flat_pool_rows(self) -> None:
        # Decision 19 withdrawn: no union mirror. A mirror would turn a dead
        # room into a plausible flat veto over every slot's candidates.
        envelope, session = await self.invoke(slot_body())

        config = self.written_config(envelope, session)
        self.assertEqual([], list(config.map_pool))
        self.assertEqual([], list(config.veto_sequence_json))


# ── flat mode is untouched ───────────────────────────────────────────────────


class FlatModeIsUnchanged(_UpsertCase):
    async def test_a_payload_that_never_mentions_slots_still_works(self) -> None:
        envelope, session = await self.invoke(flat_body())

        config = self.written_config(envelope, session)
        self.assertEqual(POOL, config.mode)
        self.assertEqual(FLAT_MAP_IDS, [entry.map_id for entry in config.map_pool])
        self.assertEqual(list(range(len(FLAT_MAP_IDS))), [entry.sort_order for entry in config.map_pool])
        self.assertEqual(FLAT_SEQUENCE, config.veto_sequence_json)
        self.assertEqual([], list(config.slots))

    async def test_the_flat_validator_still_runs(self) -> None:
        envelope, session = await self.invoke(flat_body(sequence=["decider", "ban_first"]))

        self.assert_unprocessable(envelope, "decider must be the last step")
        self.assertEqual(0, session.commits)

    async def test_the_flat_validator_still_rejects_an_empty_pool(self) -> None:
        envelope, session = await self.invoke(flat_body(map_ids=[]))

        self.assert_unprocessable(envelope, "map_ids must not be empty")
        self.assertEqual(0, session.commits)

    async def test_omitting_the_list_fields_entirely_is_still_refused(self) -> None:
        # ``sequence`` and ``map_ids`` default to empty so that slot mode has one
        # spelling of "this mode does not use it". Flat mode must not become
        # laxer for it: the refusal moves from the schema to
        # ``validate_veto_config``, which is the message an organizer already
        # knows, but it still refuses.
        for missing in ("sequence", "map_ids"):
            with self.subTest(missing=missing):
                body = flat_body()
                del body[missing]

                envelope, session = await self.invoke(body)

                self.assert_unprocessable(envelope, f"{missing} must not be empty")
                self.assertEqual(0, session.commits)


# ── converting between the modes ─────────────────────────────────────────────


class CrossModeClearing(_UpsertCase):
    async def test_switching_a_slot_config_to_flat_empties_its_slots(self) -> None:
        existing = _config(SLOTS, slots=CANDIDATES)

        envelope, session = await self.invoke(flat_body(), existing=existing)

        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual(1, session.commits)
        self.assertEqual([], list(existing.slots), "slot rows survived the conversion to flat")
        self.assertEqual(FLAT_MAP_IDS, [entry.map_id for entry in existing.map_pool])
        self.assertEqual(POOL, existing.mode)
        self.assertEqual([], envelope["data"]["slots"])

    async def test_switching_a_flat_config_to_slots_empties_its_pool(self) -> None:
        existing = _config(POOL, map_ids=FLAT_MAP_IDS)

        envelope, session = await self.invoke(slot_body(), existing=existing)

        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual(1, session.commits)
        self.assertEqual([], list(existing.map_pool), "pool rows survived the conversion to slots")
        self.assertEqual(CANDIDATES, [[entry.map_id for entry in slot.maps] for slot in existing.slots])
        self.assertEqual(SLOTS, existing.mode)
        self.assertEqual([], envelope["data"]["map_ids"])

    async def test_editing_a_slot_config_replaces_its_slots_wholesale(self) -> None:
        existing = _config(SLOTS, slots=[[1, 2], [3, 4], [5, 6], [7, 8]])
        stale = list(existing.slots)

        envelope, session = await self.invoke(slot_body(), existing=existing)

        self.assertTrue(envelope["ok"], envelope)
        # Four slots in, three out: a handler that reconciled by position would
        # leave the fourth behind.
        self.assertEqual(3, len(existing.slots))
        self.assertEqual(CANDIDATES, [[entry.map_id for entry in slot.maps] for slot in existing.slots])
        self.assertTrue(all(slot not in existing.slots for slot in stale))

    async def test_an_edit_adds_no_second_config_row(self) -> None:
        existing = _config(POOL, map_ids=FLAT_MAP_IDS)

        _, session = await self.invoke(slot_body(), existing=existing)

        self.assertEqual([], [obj for obj in session.added if isinstance(obj, models.MapVetoConfig)])

    async def test_converting_out_and_back_leaves_neither_shape_behind(self) -> None:
        # Executable documentation, not a gap-closer. No mutant kills this test
        # alone -- every candidate is already caught by one of the two
        # directional tests above or by the wholesale-replace one. It is kept
        # because the compound case is what an organizer actually does, and a
        # reader should not have to assemble it from three others.
        existing = _config(SLOTS, slots=[[1, 2], [3, 4], [5, 6], [7, 8]])

        await self.invoke(flat_body(), existing=existing)
        self.assertEqual(([], FLAT_MAP_IDS), (list(existing.slots), [e.map_id for e in existing.map_pool]))

        envelope, _ = await self.invoke(slot_body(), existing=existing)

        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual([], list(existing.map_pool))
        self.assertEqual(SLOTS, existing.mode)
        self.assertEqual(CANDIDATES, veto_session_service.slot_candidates(existing.slots))
        self.assertEqual([1, 2, 3], [slot.position for slot in existing.slots])


# ── the clear must reach the database before the replacements do ─────────────


class ReplacementRowsAreFlushedAfterTheClear(_UpsertCase):
    """The one failure only a real database shows, so it is pinned structurally.

    SQLAlchemy's unit of work emits a mapper's child INSERTs before its child
    DELETEs. Replacing either collection in a single step therefore sends the
    new rows while the old ones are still present, and both child tables carry a
    plain non-deferrable UNIQUE the new rows land on:
    ``uq_map_veto_config_slot_position`` always, because positions are
    re-derived as 1..N, and ``uq_map_veto_config_map_config_map`` whenever the
    new map set overlaps the old. Postgres rejects the INSERT and the
    IntegrityError reaches ``_run``'s bare ``except Exception`` as an opaque 500.

    A fake session cannot reproduce that -- it has no constraints and no unit of
    work -- so what is pinned instead is the shape that avoids it: the handler
    empties both collections and flushes THAT, before building any replacement.
    """

    async def test_the_clear_is_flushed_before_the_replacements_are_built(self) -> None:
        existing = _config(SLOTS, slots=[[1, 2], [3, 4], [5, 6], [7, 8]])

        envelope, session = await self.invoke(slot_body(), existing=existing)

        self.assertTrue(envelope["ok"], envelope)
        # Exactly one flush, and both collections were empty at that moment.
        self.assertEqual([{"map_pool": [], "slots": []}], session.flushes)

    async def test_a_flat_edit_flushes_its_cleared_pool_too(self) -> None:
        # ``uq_map_veto_config_map_config_map`` is the same hazard on the flat
        # side: FLAT_MAP_IDS resent over itself is a total overlap.
        existing = _config(POOL, map_ids=FLAT_MAP_IDS)

        envelope, session = await self.invoke(flat_body(), existing=existing)

        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual([{"map_pool": [], "slots": []}], session.flushes)

    async def test_the_flush_lands_before_the_commit(self) -> None:
        # A flush emitted after the rebuild would snapshot the new rows, and one
        # emitted after the commit would not help at all.
        existing = _config(SLOTS, slots=CANDIDATES)

        _, session = await self.invoke(slot_body(), existing=existing)

        self.assertEqual(1, len(session.flushes))
        self.assertEqual({"map_pool": [], "slots": []}, session.flushes[0])
        self.assertEqual(1, session.commits)


# ── a running session is nobody's business here ──────────────────────────────


class RunningSessionsAreUntouched(_UpsertCase):
    async def test_the_handler_reads_and_writes_only_config_rows(self) -> None:
        # Decision 18: a session carries its own sequence and reserve snapshots
        # and must not follow a config edit. The fake raises on any other entity,
        # so this pins both halves -- nothing queried, nothing added.
        existing = _config(SLOTS, slots=CANDIDATES)

        envelope, session = await self.invoke(slot_body(), existing=existing)

        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual(["MapVetoConfig"], sorted(session.statements))
        self.assertEqual([], session.added)


# ── the eager loads serialize_veto_config now depends on ─────────────────────


class SerializeNeedsTheSlotChain(_UpsertCase):
    async def test_the_upsert_lookup_loads_the_slot_chain(self) -> None:
        # Two reasons, either sufficient: assigning over a lazy ``slots``
        # collection loads it to compute the orphans, and ``serialize_veto_config``
        # reads it back. Both happen outside the async greenlet.
        existing = _config(POOL, map_ids=FLAT_MAP_IDS)

        _, session = await self.invoke(slot_body(), existing=existing)

        statement = session.statements["MapVetoConfig"][0]
        eager_loading.assert_eager_loads(self, statement, "MapVetoConfig.slots", "MapVetoConfigSlot.maps")
        eager_loading.assert_eager_loads(self, statement, "MapVetoConfig.map_pool")

    async def test_the_admin_list_loads_the_slot_chain(self) -> None:
        broker = _CapturingBroker()
        veto_admin.register(broker, SimpleNamespace(exception=lambda *a, **k: None))
        session = _FakeSession(configs=[_config(SLOTS, slots=CANDIDATES)])

        async def _workspace_id(_session, _tournament_id):
            return WORKSPACE_ID

        self.enterContext(patch.object(helpers.db, "async_session_maker", session))
        self.enterContext(patch.object(veto_admin.auth, "get_tournament_workspace_id", _workspace_id))

        envelope = await broker.handlers[LIST]({"identity": IDENTITY, "id": TOURNAMENT_ID}, None)

        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual(CANDIDATES, [slot["candidates"] for slot in envelope["data"]["configs"][0]["slots"]])
        eager_loading.assert_eager_loads(
            self, session.statements["MapVetoConfig"][0], "MapVetoConfig.slots", "MapVetoConfigSlot.maps"
        )

    async def test_the_public_read_loads_the_slot_chain(self) -> None:
        # ``rpc.tournament.get_veto_configs`` serializes the same configs, so it
        # inherits the same requirement even though it is a different module.
        broker = _CapturingBroker()
        reads.register(broker, SimpleNamespace(exception=lambda *a, **k: None))
        session = _FakeSession(configs=[_config(SLOTS, slots=CANDIDATES)])

        async def _viewable(*_args, **_kwargs):
            return None

        self.enterContext(patch.object(helpers.db, "async_session_maker", session))
        self.enterContext(patch.object(reads, "assert_tournament_viewable", _viewable))

        envelope = await broker.handlers[PUBLIC_LIST]({"identity": IDENTITY, "id": TOURNAMENT_ID}, None)

        self.assertTrue(envelope["ok"], envelope)
        eager_loading.assert_eager_loads(
            self, session.statements["MapVetoConfig"][0], "MapVetoConfig.slots", "MapVetoConfigSlot.maps"
        )


class RefreshMustNotReachForTheSlotChain(_UpsertCase):
    """The one site in this sweep that must NOT gain ``slots``.

    ``Session.refresh(instance, attribute_names)`` expires exactly the named
    attributes and reloads them with ``only_load_props``; it takes no loader
    options at all (SQLAlchemy 2.0.45), so it cannot express
    ``slots -> maps``. Today ``config.slots`` and each slot's ``maps`` are
    correct here without any reload: they were assigned above and
    ``expire_on_commit=False`` leaves them loaded across the commit.

    Adding ``"slots"`` would therefore expire a correct collection and reload it
    with every slot's ``maps`` lazy, turning ``serialize_veto_config``'s
    ``slot.maps`` read into exactly the ``MissingGreenlet`` the rest of this
    sweep exists to prevent. If ``slots`` ever does need re-reading here, the fix
    is a fresh SELECT carrying the two-level chain, never a wider refresh.
    """

    async def test_the_upsert_refreshes_the_flat_pool_and_nothing_else(self) -> None:
        _, session = await self.invoke(slot_body(), existing=_config(POOL, map_ids=FLAT_MAP_IDS))

        self.assertEqual([["map_pool"]], [names for _obj, names in session.refreshes])

    async def test_the_response_still_carries_the_slots_across_the_commit(self) -> None:
        # The observable half: whatever the refresh does, the serialized slots
        # must survive it, so this fails on a refresh that dropped the pool shape
        # rather than only on the argument list above.
        envelope, _ = await self.invoke(slot_body(), existing=_config(POOL, map_ids=FLAT_MAP_IDS))

        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual(CANDIDATES, [slot["candidates"] for slot in envelope["data"]["slots"]])
        self.assertEqual([], envelope["data"]["map_ids"])


class SerializeOrdersSlotsByPosition(IsolatedAsyncioTestCase):
    """The one thing the upsert's own round trip cannot pin.

    Everything this endpoint writes is already in position order, so a
    serializer that trusted row order would round-trip perfectly here. Slot rows
    reach ``serialize_veto_config`` from elsewhere too -- the stage-merge copier
    builds them, and ``load_slot_rows`` documents its row order as meaningless
    -- and play order is what the room labels its slots by.
    """

    def test_row_order_does_not_decide_play_order(self) -> None:
        config = _config(SLOTS)
        # Arrival order reversed against position, and positions deliberately
        # non-contiguous: a deleted middle slot leaves a gap, so a position is
        # not an index into this list.
        config.slots = [
            models.MapVetoConfigSlot(
                position=7,
                reserve_map_id=99,
                maps=[models.MapVetoConfigSlotMap(map_id=m, sort_order=i) for i, m in enumerate([88, 42, 66])],
            ),
            models.MapVetoConfigSlot(
                position=2,
                reserve_map_id=None,
                maps=[models.MapVetoConfigSlotMap(map_id=m, sort_order=i) for i, m in enumerate([77, 15])],
            ),
        ]

        self.assertEqual(
            [
                {"position": 2, "candidates": [77, 15], "reserve_map_id": None},
                {"position": 7, "candidates": [88, 42, 66], "reserve_map_id": 99},
            ],
            map_veto_service.serialize_veto_config(config)["slots"],
        )
