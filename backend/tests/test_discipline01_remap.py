"""The pure rewriters of ``discipline01``'s pick-ban pass (D84): what moves and what must not."""

from __future__ import annotations

import importlib.util
import pathlib

_BACKEND = pathlib.Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "discipline01", _BACKEND / "migrations" / "versions" / "discipline01_catalog.py"
)
assert _spec is not None and _spec.loader is not None
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

IDS = {10: 910, 11: 911}


def test_every_item_in_leaf_is_rewritten_at_any_depth_and_nothing_else() -> None:
    tree = {
        "type": "all",
        "children": [
            {"type": "item_in", "params": {"item_ids": [10, 99]}},
            {"type": "item_group", "params": {"groups": ["control"], "item_ids": [10]}},
            {"type": "not", "child": {"type": "item_in", "params": {"item_ids": [11]}}},
        ],
    }
    assert mod.remap_condition(tree, IDS) == {
        "type": "all",
        "children": [
            {"type": "item_in", "params": {"item_ids": [910, 99]}},
            {"type": "item_group", "params": {"groups": ["control"], "item_ids": [10]}},
            {"type": "not", "child": {"type": "item_in", "params": {"item_ids": [911]}}},
        ],
    }


def test_a_pool_snapshot_and_its_reserves_are_rewritten() -> None:
    pool = {"mode": "slots", "rotation": "fixed", "progressive": True, "items": [10], "slots": [[10, 11], [99]]}
    assert mod.remap_pool(pool, IDS) == {**pool, "items": [910], "slots": [[910, 911], [99]]}
    assert mod.remap_pool({"mode": "pool"}, IDS) == {"mode": "pool"}
    assert mod.remap_reserves({"1": 11, "2": 99}, IDS) == {"1": 911, "2": 99}
    assert mod.remap_reserves(None, IDS) is None


def test_items_are_rewritten_unless_they_answer_a_side_pick() -> None:
    sequence = [{"index": 0, "action": "ban"}, {"index": 1, "action": "side_pick"}]
    assert mod.side_pick_steps(sequence) == frozenset({1})
    assert mod.remap_items([{"item_id": 10, "target_player_id": 5}], IDS) == [{"item_id": 910, "target_player_id": 5}]
    assert mod.remap_items([{"item_id": True}], IDS) == [{"item_id": True}]


def test_journal_payloads_are_rewritten_by_key() -> None:
    assert mod.remap_journal({"item_id": 10, "round": 10}, IDS) == {"item_id": 910, "round": 10}
    assert mod.remap_journal({"items": [{"item_id": 11}]}, IDS) == {"items": [{"item_id": 911}]}
    assert mod.remap_journal({"item_ids": [10, 99]}, IDS) == {"item_ids": [910, 99]}
