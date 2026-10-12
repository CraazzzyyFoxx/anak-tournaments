"""``enclayer01`` writes the pool snapshot the live room reads.

``enclayer01`` backfills ``pick_ban_session.pool_json`` for every room opened
before the cutover. Its converter (``pool_snapshot``, pure, because a migration
imports nothing from ``shared``) has to produce, byte for byte, what
``pick_ban_session.pool_snapshot`` writes for a new room -- the room's next-round
healer and ``round_candidates`` read nothing else. A drift here is invisible
until a hero or slot room hangs at its second round, so the two are compared on
the same in-memory configs, and the migrated pool is then read through the real
reader.
"""

from __future__ import annotations

import importlib.util
import pathlib

import pytest

from shared.core import enums
from shared.models.tournament.pick_ban import PickBanConfig, PickBanConfigItem, PickBanConfigSlot, PickBanConfigSlotItem
from src.services.encounter.pick_ban_session import pool_rotation, pool_snapshot, round_candidates

_PATH = pathlib.Path(__file__).resolve().parents[2] / "migrations" / "versions" / "enclayer01_encounter_layer.py"
_spec = importlib.util.spec_from_file_location("enclayer01", _PATH)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def _config(
    mode: enums.MapVetoMode,
    kind: enums.PickBanKind,
    *,
    items: tuple[tuple[int, int], ...] = (),
    slots: tuple[tuple[int, tuple[int, ...]], ...] = (),
    rotation: enums.FirstBanRotation = enums.FirstBanRotation.FIXED,
) -> PickBanConfig:
    """A transient config; ``(item_id, sort_order)`` and ``(position, item ids)``."""
    return PickBanConfig(
        kind=kind,
        mode=mode,
        first_ban_rotation=rotation,
        items=[PickBanConfigItem(item_id=item_id, sort_order=order) for item_id, order in items],
        slots=[
            PickBanConfigSlot(
                position=position,
                items=[PickBanConfigSlotItem(item_id=item_id, sort_order=order) for order, item_id in enumerate(ids)],
            )
            for position, ids in slots
        ],
    )


def _migrated(config: PickBanConfig, kind: enums.PickBanKind, best_of: int) -> dict:
    """What the backfill writes: the converter fed the rows the SQL would read."""
    return migration.pool_snapshot(
        str(config.mode),
        str(config.first_ban_rotation),
        str(kind),
        best_of,
        [item.item_id for item in sorted(config.items, key=lambda item: item.sort_order)],
        [[item.item_id for item in slot.items] for slot in sorted(config.slots, key=lambda slot: slot.position)],
    )


CASES = {
    "map pool, classic veto": (
        _config(enums.MapVetoMode.POOL, enums.PickBanKind.MAP, items=((7, 2), (3, 0), (9, 1))),
        enums.PickBanKind.MAP,
        3,
    ),
    "map slots": (
        _config(
            enums.MapVetoMode.SLOTS,
            enums.PickBanKind.MAP,
            slots=((2, (21, 22)), (1, (11, 12, 13)), (3, (31,)), (4, (41, 42))),
            rotation=enums.FirstBanRotation.ALTERNATE,
        ),
        enums.PickBanKind.MAP,
        3,
    ),
    "hero pool": (
        _config(
            enums.MapVetoMode.POOL,
            enums.PickBanKind.HERO,
            items=((5, 0), (6, 1)),
            rotation=enums.FirstBanRotation.RESULT_LOSER_CHOICE,
        ),
        enums.PickBanKind.HERO,
        5,
    ),
    "slot with no items": (
        _config(enums.MapVetoMode.SLOTS, enums.PickBanKind.MAP, slots=((1, (1, 2)), (2, ()))),
        enums.PickBanKind.MAP,
        2,
    ),
}


@pytest.mark.parametrize("name", CASES)
def test_the_migrated_pool_is_what_a_new_room_would_snapshot(name: str) -> None:
    config, kind, best_of = CASES[name]

    assert _migrated(config, kind, best_of) == pool_snapshot(config, kind, best_of=best_of)


def test_a_migrated_slot_pool_serves_each_round_its_own_candidates() -> None:
    config, kind, best_of = CASES["map slots"]
    pool = _migrated(config, kind, best_of)

    assert pool["progressive"] is True
    assert [round_candidates(pool, n) for n in (1, 2, 3)] == [[11, 12, 13], [21, 22], [31]]
    # The series is best-of-3: the fourth slot is not a round.
    assert round_candidates(pool, 4) is None
    assert pool_rotation(pool) == enums.FirstBanRotation.ALTERNATE


def test_a_migrated_hero_pool_is_progressive_and_offers_its_items_every_round() -> None:
    config, kind, best_of = CASES["hero pool"]
    pool = _migrated(config, kind, best_of)

    assert pool["progressive"] is True
    assert round_candidates(pool, 2) == [5, 6]
    assert pool_rotation(pool) == enums.FirstBanRotation.RESULT_LOSER_CHOICE


def test_a_migrated_classic_map_pool_stays_single_round() -> None:
    config, kind, best_of = CASES["map pool, classic veto"]
    pool = _migrated(config, kind, best_of)

    assert pool["progressive"] is False
    assert round_candidates(pool, None) == [3, 9, 7]


def test_a_room_whose_config_was_deleted_keeps_an_empty_pool() -> None:
    hero = migration.pool_snapshot(None, None, "hero", 3, [], [])
    map_room = migration.pool_snapshot(None, None, "map", 3, [], [])

    assert hero == {"mode": "pool", "rotation": "fixed", "progressive": True, "items": [], "slots": []}
    assert map_room["progressive"] is False
    assert round_candidates(hero, 1) == []
