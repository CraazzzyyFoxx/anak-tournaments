from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, Mock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

stage_service = importlib.import_module("src.services.admin.stage")
enums = importlib.import_module("shared.core.enums")
eager_loading = importlib.import_module("shared.tests.eager_loading")
pick_ban_models = importlib.import_module("shared.models.tournament.pick_ban")


def _scalars_result(values: list):
    scalars = Mock()
    scalars.all.return_value = values
    result = Mock()
    result.scalars.return_value = scalars
    return result


class AdminStageMergeTests(IsolatedAsyncioTestCase):
    async def test_merge_group_stages_moves_items_and_stage_references(self) -> None:
        calls: list[str] = []

        target_item = SimpleNamespace(
            id=100,
            stage_id=10,
            name="A",
            type=enums.StageItemType.GROUP,
            order=0,
        )
        source_item_b = SimpleNamespace(
            id=101,
            stage_id=11,
            name="B",
            type=enums.StageItemType.GROUP,
            order=0,
        )
        source_item_c = SimpleNamespace(
            id=102,
            stage_id=12,
            name="C",
            type=enums.StageItemType.GROUP,
            order=0,
        )
        target_stage = SimpleNamespace(
            id=10,
            tournament_id=99,
            name="A",
            stage_type=enums.StageType.SWISS,
            is_active=False,
            is_completed=True,
            order=0,
            items=[target_item],
        )
        source_stage_b = SimpleNamespace(
            id=11,
            tournament_id=99,
            name="B",
            stage_type=enums.StageType.SWISS,
            is_active=True,
            is_completed=True,
            order=1,
        )
        source_stage_c = SimpleNamespace(
            id=12,
            tournament_id=99,
            name="C",
            stage_type=enums.StageType.SWISS,
            is_active=False,
            is_completed=True,
            order=2,
        )
        playoff_stage = SimpleNamespace(id=13, tournament_id=99, order=3)

        group_row = SimpleNamespace(stage_id=11)
        encounter_row = SimpleNamespace(stage_id=11)
        standing_row = SimpleNamespace(stage_id=12)
        challonge_row = SimpleNamespace(stage_id=12)

        async def fake_commit():
            calls.append("commit")

        async def fake_enqueue(_session, tournament_id):
            calls.append(f"enqueue:{tournament_id}")

        async def fake_publish(_session, tournament_id, reason):
            calls.append(f"publish:{tournament_id}:{reason}")

        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _scalars_result([source_stage_b, source_stage_c]),
                    _scalars_result([source_item_b, source_item_c]),
                    # _merge_pick_ban_configs(kind=MAP): target, then source.
                    _scalars_result([]),
                    _scalars_result([]),
                    # _merge_pick_ban_configs(kind=HERO): target, then source.
                    _scalars_result([]),
                    _scalars_result([]),
                    _scalars_result([group_row]),
                    _scalars_result([encounter_row]),
                    _scalars_result([standing_row]),
                    _scalars_result([challonge_row]),
                    _scalars_result([target_stage, playoff_stage]),
                ]
            ),
            delete=AsyncMock(),
            flush=AsyncMock(),
            commit=AsyncMock(side_effect=fake_commit),
        )

        with (
            patch.object(
                stage_service,
                "get_stage",
                AsyncMock(side_effect=[target_stage, "merged-stage"]),
            ),
            patch.object(
                stage_service,
                "enqueue_tournament_recalculation",
                AsyncMock(side_effect=fake_enqueue),
            ) as enqueue_recalc,
            patch.object(
                stage_service,
                "_publish_tournament_changed",
                AsyncMock(side_effect=fake_publish),
            ) as publish_changed,
        ):
            result = await stage_service.merge_group_stages(
                session,
                target_stage_id=target_stage.id,
                source_stage_ids=[source_stage_b.id, source_stage_c.id],
                target_name="Groups",
            )

        self.assertEqual("merged-stage", result)
        self.assertEqual("Groups", target_stage.name)
        self.assertTrue(target_stage.is_active)
        self.assertTrue(target_stage.is_completed)
        self.assertEqual(target_stage.id, source_item_b.stage_id)
        self.assertEqual(target_stage.id, source_item_c.stage_id)
        self.assertEqual(1, source_item_b.order)
        self.assertEqual(2, source_item_c.order)
        self.assertEqual(target_stage.id, group_row.stage_id)
        self.assertEqual(target_stage.id, encounter_row.stage_id)
        self.assertEqual(target_stage.id, standing_row.stage_id)
        self.assertEqual(target_stage.id, challonge_row.stage_id)
        self.assertEqual(0, target_stage.order)
        self.assertEqual(1, playoff_stage.order)
        session.delete.assert_any_await(source_stage_b)
        session.delete.assert_any_await(source_stage_c)
        enqueue_recalc.assert_awaited_once_with(session, target_stage.tournament_id)
        publish_changed.assert_awaited_once_with(
            session,
            target_stage.tournament_id,
            "structure_changed",
        )
        self.assertLess(calls.index("enqueue:99"), calls.index("commit"))
        self.assertLess(calls.index("publish:99:structure_changed"), calls.index("commit"))


POOL_MODE = enums.MapVetoMode.POOL
SLOTS_MODE = enums.MapVetoMode.SLOTS
FIXED = enums.FirstBanRotation.FIXED
ALTERNATE = enums.FirstBanRotation.ALTERNATE
MAP_KIND = enums.PickBanKind.MAP


def _slot_row(
    position: int,
    candidates: list[tuple[int, int]],
    reserve_item_id: int | None = None,
) -> SimpleNamespace:
    """One ``pick_ban_config_slot`` row.

    ``candidates`` are ``(sort_order, item_id)`` pairs listed in ROW ARRIVAL
    order, which is deliberately not the same thing as their sort order.
    """
    return SimpleNamespace(
        position=position,
        reserve_item_id=reserve_item_id,
        items=[SimpleNamespace(sort_order=sort_order, item_id=item_id) for sort_order, item_id in candidates],
    )


def _pick_ban_config(
    *,
    mode: enums.MapVetoMode,
    sequence: list[str] | None = None,
    pool: tuple[int, ...] = (),
    slots: list[SimpleNamespace] | None = None,
    stage_id: int | None = None,
    rotation: enums.FirstBanRotation = FIXED,
) -> SimpleNamespace:
    return SimpleNamespace(
        kind=MAP_KIND,
        mode=mode,
        sequence_json=sequence,
        items=[SimpleNamespace(item_id=item_id) for item_id in pool],
        slots=list(slots or []),
        stage_id=stage_id,
        first_ban_rotation=rotation,
    )


def _pre_slot_signature(config: SimpleNamespace) -> tuple[tuple, tuple]:
    """``_pick_ban_config_signature`` exactly as it read before slot mode existed."""
    return (
        tuple(config.sequence_json or []),
        tuple(entry.item_id for entry in config.items),
    )


def _slot_union(config: SimpleNamespace) -> tuple[int, ...]:
    """Every slot candidate in play order with the partition forgotten.

    What a union-based signature would compare, and what two configs with
    different partitions can share.
    """
    return tuple(entry.item_id for slot in sorted(config.slots, key=lambda row: row.position) for entry in slot.items)


class PickBanConfigSignatureTests(TestCase):
    """``_pick_ban_config_signature`` decides whether ``_merge_pick_ban_configs``
    refuses, so anything it leaves out is merged away in silence. Generalizes
    the legacy ``_map_veto_signature`` test suite onto ``PickBanConfig``."""

    def test_flat_signature_keeps_the_pre_slot_pair_as_its_prefix(self) -> None:
        config = _pick_ban_config(
            mode=POOL_MODE,
            sequence=["ban_home", "pick_away", "decider"],
            # items is ordered by sort_order at the ORM layer.
            pool=(7, 3, 11),
        )
        self.assertEqual(
            stage_service._pick_ban_config_signature(config),
            (("ban_home", "pick_away", "decider"), (7, 3, 11), POOL_MODE, None, ()),
        )

    def test_flat_pairs_keep_their_pre_slot_merge_verdicts(self) -> None:
        flats = [
            _pick_ban_config(mode=POOL_MODE, sequence=["ban_home"], pool=(1, 2)),
            _pick_ban_config(mode=POOL_MODE, sequence=["ban_home"], pool=(1, 2)),
            _pick_ban_config(mode=POOL_MODE, sequence=["ban_home"], pool=(2, 1)),
            _pick_ban_config(mode=POOL_MODE, sequence=["ban_home", "decider"], pool=(1, 2)),
            # A flat config's rotation is inert, so this one must stay verdict-equal
            # to the two identical FIXED ones above.
            _pick_ban_config(mode=POOL_MODE, sequence=["ban_home"], pool=(1, 2), rotation=ALTERNATE),
            _pick_ban_config(mode=POOL_MODE, sequence=None, pool=()),
        ]
        for index, config in enumerate(flats):
            with self.subTest(prefix=index):
                self.assertEqual(stage_service._pick_ban_config_signature(config)[:2], _pre_slot_signature(config))
        for left_index, left in enumerate(flats):
            for right_index, right in enumerate(flats):
                with self.subTest(left=left_index, right=right_index):
                    self.assertEqual(
                        stage_service._pick_ban_config_signature(left)
                        == stage_service._pick_ban_config_signature(right),
                        _pre_slot_signature(left) == _pre_slot_signature(right),
                    )

    def test_signature_handles_empty_pool_and_sequence(self) -> None:
        config = _pick_ban_config(mode=POOL_MODE)
        self.assertEqual(stage_service._pick_ban_config_signature(config), ((), (), POOL_MODE, None, ()))

    def test_slot_partition_is_significant_where_the_union_is_not(self) -> None:
        left = _pick_ban_config(
            mode=SLOTS_MODE,
            sequence=["ban_first", "ban_second"],
            slots=[_slot_row(1, [(0, 4), (1, 9)]), _slot_row(2, [(0, 6), (1, 2)])],
        )
        right = _pick_ban_config(
            mode=SLOTS_MODE,
            sequence=["ban_first", "ban_second"],
            slots=[_slot_row(1, [(0, 4), (1, 9), (2, 6)]), _slot_row(2, [(0, 2)])],
        )
        self.assertEqual(_slot_union(left), _slot_union(right))
        self.assertNotEqual(
            stage_service._pick_ban_config_signature(left),
            stage_service._pick_ban_config_signature(right),
        )

    def test_slot_row_arrival_order_is_not_significant(self) -> None:
        rows = [_slot_row(1, [(0, 4), (1, 9)], reserve_item_id=13), _slot_row(2, [(0, 6), (1, 2)])]
        self.assertEqual(
            stage_service._pick_ban_config_signature(
                _pick_ban_config(mode=SLOTS_MODE, sequence=["ban_first"], slots=rows)
            ),
            stage_service._pick_ban_config_signature(
                _pick_ban_config(mode=SLOTS_MODE, sequence=["ban_first"], slots=list(reversed(rows)))
            ),
        )

    def test_slot_positions_are_significant(self) -> None:
        # Positions are unique but not contiguous, and a session snapshots its
        # reserves keyed by position, so the same two candidate lists at 1/2 and
        # at 1/3 are different configs and must not merge into each other.
        candidates = [[(0, 4), (1, 9)], [(0, 6), (1, 2)]]
        adjacent = _pick_ban_config(
            mode=SLOTS_MODE,
            sequence=["ban_first"],
            slots=[_slot_row(1, candidates[0]), _slot_row(2, candidates[1])],
        )
        gapped = _pick_ban_config(
            mode=SLOTS_MODE,
            sequence=["ban_first"],
            slots=[_slot_row(1, candidates[0]), _slot_row(3, candidates[1])],
        )
        self.assertNotEqual(
            stage_service._pick_ban_config_signature(adjacent),
            stage_service._pick_ban_config_signature(gapped),
        )

    def test_candidates_are_read_in_sort_order_not_arrival_order(self) -> None:
        def config(candidates: list[tuple[int, int]]) -> SimpleNamespace:
            return _pick_ban_config(mode=SLOTS_MODE, sequence=["ban_first"], slots=[_slot_row(2, candidates)])

        self.assertEqual(
            stage_service._pick_ban_config_signature(config([(0, 4), (1, 9)])),
            stage_service._pick_ban_config_signature(config([(1, 9), (0, 4)])),
        )
        self.assertNotEqual(
            stage_service._pick_ban_config_signature(config([(0, 4), (1, 9)])),
            stage_service._pick_ban_config_signature(config([(0, 9), (1, 4)])),
        )

    def test_tied_candidate_sort_orders_do_not_leave_the_order_to_the_query(self) -> None:
        # sort_order is only UNIQUE(slot, item); it defaults to 0, so a slot can
        # hold ties and Postgres may hand two copies of one structure back in
        # different orders. That must not read as a difference.
        def config(candidates: list[tuple[int, int]]) -> SimpleNamespace:
            return _pick_ban_config(mode=SLOTS_MODE, sequence=["ban_first"], slots=[_slot_row(1, candidates)])

        self.assertEqual(
            stage_service._pick_ban_config_signature(config([(0, 4), (0, 9)])),
            stage_service._pick_ban_config_signature(config([(0, 9), (0, 4)])),
        )

    def test_slot_reserves_are_significant(self) -> None:
        def config(reserve_item_id: int | None) -> SimpleNamespace:
            return _pick_ban_config(
                mode=SLOTS_MODE,
                sequence=["ban_first"],
                slots=[
                    _slot_row(1, [(0, 4), (1, 9)], reserve_item_id=reserve_item_id),
                    _slot_row(2, [(0, 6), (1, 2)]),
                ],
            )

        signatures = [stage_service._pick_ban_config_signature(config(reserve)) for reserve in (None, 13, 21)]
        self.assertEqual(len(set(signatures)), 3, signatures)

    def test_mode_is_carried_and_separates_otherwise_identical_configs(self) -> None:
        # Nothing forbids a config from holding both a flat pool and slot rows,
        # so mode is what says which of the two is played. Asserting the mode is
        # PRESENT as well as that the two differ: with the rotation gated on mode,
        # inequality alone would still hold if mode itself were dropped.
        slots = [_slot_row(1, [(0, 4), (1, 9)]), _slot_row(2, [(0, 6), (1, 2)])]
        flat = stage_service._pick_ban_config_signature(
            _pick_ban_config(mode=POOL_MODE, sequence=["ban_first"], pool=(7, 3), slots=slots)
        )
        slotted = stage_service._pick_ban_config_signature(
            _pick_ban_config(mode=SLOTS_MODE, sequence=["ban_first"], pool=(7, 3), slots=slots)
        )
        self.assertIn(POOL_MODE, flat)
        self.assertIn(SLOTS_MODE, slotted)
        self.assertNotEqual(flat, slotted)

    def test_slot_signature_shape_is_pinned(self) -> None:
        config = _pick_ban_config(
            mode=SLOTS_MODE,
            sequence=["ban_first", "decider"],
            slots=[
                # Arrival order reversed on both levels; the pin is the sorted result.
                _slot_row(2, [(1, 2), (0, 6)]),
                _slot_row(1, [(1, 9), (0, 4)], reserve_item_id=13),
            ],
            rotation=ALTERNATE,
        )
        self.assertEqual(
            stage_service._pick_ban_config_signature(config),
            (
                ("ban_first", "decider"),
                (),
                SLOTS_MODE,
                ALTERNATE,
                ((1, 13, (4, 9)), (2, None, (6, 2))),
            ),
        )

    def test_ban_rotation_is_significant_in_slot_mode(self) -> None:
        # ALTERNATE hands the opening ban of every second slot to the other side
        # (build_slot_sequence), so these two run different vetos.
        slots = [_slot_row(1, [(0, 4), (1, 9)]), _slot_row(2, [(0, 6), (1, 2)])]
        self.assertNotEqual(
            stage_service._pick_ban_config_signature(
                _pick_ban_config(mode=SLOTS_MODE, sequence=["ban_first"], slots=slots, rotation=FIXED)
            ),
            stage_service._pick_ban_config_signature(
                _pick_ban_config(mode=SLOTS_MODE, sequence=["ban_first"], slots=slots, rotation=ALTERNATE)
            ),
        )

    def test_ban_rotation_is_gated_out_of_flat_signatures(self) -> None:
        # The field is slot-mode-only, so signing it unconditionally would refuse
        # two flat configs over something that changes nothing for them.
        self.assertEqual(
            stage_service._pick_ban_config_signature(
                _pick_ban_config(mode=POOL_MODE, sequence=["ban_home"], pool=(7, 3), rotation=FIXED)
            ),
            stage_service._pick_ban_config_signature(
                _pick_ban_config(mode=POOL_MODE, sequence=["ban_home"], pool=(7, 3), rotation=ALTERNATE)
            ),
        )


class PickBanConfigMergeDedupTests(IsolatedAsyncioTestCase):
    """``_merge_pick_ban_configs`` refuses ONLY on differing signatures, so the
    failure mode of a weak signature is a silent merge, not an error."""

    @staticmethod
    def _session(source_configs: list[SimpleNamespace]) -> SimpleNamespace:
        return SimpleNamespace(
            execute=AsyncMock(side_effect=[_scalars_result([]), _scalars_result(source_configs)]),
            delete=AsyncMock(),
        )

    async def _merge(self, session: SimpleNamespace) -> None:
        await stage_service._merge_pick_ban_configs(
            session,
            target_stage=SimpleNamespace(id=10, tournament_id=99),
            source_stage_ids=[11, 12],
            kind=MAP_KIND,
        )

    async def test_merge_refuses_sources_that_differ_only_in_slot_partition(self) -> None:
        left = _pick_ban_config(
            mode=SLOTS_MODE,
            sequence=["ban_first", "ban_second"],
            slots=[_slot_row(1, [(0, 4), (1, 9)]), _slot_row(2, [(0, 6), (1, 2)])],
            stage_id=11,
        )
        right = _pick_ban_config(
            mode=SLOTS_MODE,
            sequence=["ban_first", "ban_second"],
            slots=[_slot_row(1, [(0, 4), (1, 9), (2, 6)]), _slot_row(2, [(0, 2)])],
            stage_id=12,
        )
        session = self._session([left, right])
        with self.assertRaises(stage_service.HTTPException) as caught:
            await self._merge(session)
        self.assertEqual(caught.exception.status_code, stage_service.status.HTTP_409_CONFLICT)
        self.assertEqual([left.stage_id, right.stage_id], [11, 12])
        session.delete.assert_not_awaited()

    async def test_merge_keeps_one_of_two_identical_slot_configs(self) -> None:
        # Same structure, rows handed back in a different order: this must not
        # read as a conflict either.
        left = _pick_ban_config(
            mode=SLOTS_MODE,
            sequence=["ban_first", "ban_second"],
            slots=[_slot_row(1, [(0, 4), (1, 9)], reserve_item_id=13), _slot_row(2, [(0, 6), (1, 2)])],
            stage_id=11,
        )
        right = _pick_ban_config(
            mode=SLOTS_MODE,
            sequence=["ban_first", "ban_second"],
            slots=[_slot_row(2, [(1, 2), (0, 6)]), _slot_row(1, [(1, 9), (0, 4)], reserve_item_id=13)],
            stage_id=12,
        )
        session = self._session([left, right])
        await self._merge(session)
        self.assertEqual(left.stage_id, 10)
        session.delete.assert_awaited_once_with(right)

    async def test_merge_refuses_sources_that_differ_only_in_ban_rotation(self) -> None:
        slots = [_slot_row(1, [(0, 4), (1, 9)]), _slot_row(2, [(0, 6), (1, 2)])]
        left = _pick_ban_config(mode=SLOTS_MODE, sequence=["ban_first"], slots=slots, rotation=FIXED, stage_id=11)
        right = _pick_ban_config(mode=SLOTS_MODE, sequence=["ban_first"], slots=slots, rotation=ALTERNATE, stage_id=12)
        session = self._session([left, right])
        with self.assertRaises(stage_service.HTTPException) as caught:
            await self._merge(session)
        self.assertEqual(caught.exception.status_code, stage_service.status.HTTP_409_CONFLICT)
        self.assertEqual([left.stage_id, right.stage_id], [11, 12])
        session.delete.assert_not_awaited()

    async def test_merge_eager_loads_the_slot_chain_it_signs(self) -> None:
        session = self._session([])
        await self._merge(session)
        source_statement = session.execute.await_args_list[1].args[0]
        eager_loading.assert_eager_loads(self, source_statement, "PickBanConfig.slots", "PickBanConfigSlot.items")

    async def test_the_target_query_loads_nothing_because_nothing_is_read_off_it(self) -> None:
        # ``target_configs`` is only counted and truthiness-tested, so any loader
        # option here is dead. It is pinned rather than merely deleted because a
        # dead ``items`` eager load sitting beside the source query's chain reads
        # as a slot chain someone forgot, which is how a sweep grows a
        # cargo-culted option that costs a SELECT and proves nothing.
        session = self._session([])
        await self._merge(session)
        target_statement = session.execute.await_args_list[0].args[0]
        self.assertEqual([], eager_loading.eager_loaded_chains(target_statement))

    async def test_merge_scopes_both_queries_by_kind(self) -> None:
        session = self._session([])
        await self._merge(session)
        for statement in (call.args[0] for call in session.execute.await_args_list):
            self.assertIn(
                f"pick_ban_config.kind = {MAP_KIND.value!r}".replace("'", ""),
                str(statement.compile(compile_kwargs={"literal_binds": True})).replace("'", ""),
            )


class PickBanConfigSignatureAnchorTests(TestCase):
    """``_pick_ban_config_signature``/``_merge_pick_ban_configs`` exist
    verbatim in BOTH tournament-service and parser-service (the merge route is
    only ever exposed from tournament-service's RPC layer; parser-service's
    copy is dead code kept in sync by this mechanical diff, same convention
    dbarch05 established for the legacy ``_map_veto_signature`` pair)."""

    def test_both_service_copies_are_identical(self) -> None:
        opening = "def _pick_ban_config_signature"
        closing = "async def _retarget_stage_rows"

        def extract(relative: str) -> str:
            source = (backend_root / relative).read_text(encoding="utf-8")
            self.assertIn(opening, source, relative)
            self.assertIn(closing, source, relative)
            start = source.index(opening)
            return source[start : source.index(closing, start)]

        self.assertEqual(
            extract("tournament-service/src/services/admin/stage.py"),
            extract("parser-service/src/services/admin/stage.py"),
        )
