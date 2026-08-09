"""Model-metadata tests for revision ``vetoslot01`` (slot-based map pools).

Pure metadata tests (no DB connection): the two new slot tables carry the
cascades, uniques and CHECK that the migration declares; ``map_veto_config``
gains ``mode``/``first_ban_rotation`` bound by enum *value*, plus the CHECK that
forbids a hand-authored ``custom`` order in slot mode; and the flat-mode pool
table is left alone (design Decision 2).

Migration: ``backend/migrations/versions/vetoslot01_add_slot_pools.py``
Design: ``docs/plans/2026-08-05-map-veto-slot-pools.md`` §4.1
"""

from sqlalchemy import CheckConstraint, UniqueConstraint

from shared.models.tournament.encounter_map import (
    MapVetoConfig,
    MapVetoConfigMap,
    MapVetoConfigSlot,
    MapVetoConfigSlotMap,
)


def _uniques(model) -> dict[str, list[str]]:
    return {
        c.name: [col.name for col in c.columns] for c in model.__table__.constraints if isinstance(c, UniqueConstraint)
    }


def _checks(model) -> dict[str, str]:
    return {c.name: str(c.sqltext) for c in model.__table__.constraints if isinstance(c, CheckConstraint)}


def test_slot_tables_exist_with_cascades_and_uniques():
    assert MapVetoConfigSlot.__table__.schema == "tournament"
    assert MapVetoConfigSlotMap.__table__.schema == "tournament"
    assert {"map_veto_config_id", "position", "reserve_map_id"} <= set(MapVetoConfigSlot.__table__.columns.keys())

    config_fk = next(iter(MapVetoConfigSlot.__table__.columns["map_veto_config_id"].foreign_keys))
    assert config_fk.ondelete == "CASCADE"
    reserve_fk = next(iter(MapVetoConfigSlot.__table__.columns["reserve_map_id"].foreign_keys))
    assert reserve_fk.ondelete == "SET NULL"

    slot_fk = next(iter(MapVetoConfigSlotMap.__table__.columns["map_veto_config_slot_id"].foreign_keys))
    assert slot_fk.ondelete == "CASCADE"
    map_fk = next(iter(MapVetoConfigSlotMap.__table__.columns["map_id"].foreign_keys))
    assert map_fk.ondelete == "CASCADE"

    assert _uniques(MapVetoConfigSlot) == {"uq_map_veto_config_slot_position": ["map_veto_config_id", "position"]}
    assert set(_checks(MapVetoConfigSlot)) == {"ck_map_veto_config_slot_position_positive"}
    # Unique per slot, deliberately NOT per config: one map may be a candidate in
    # several slots of the same config, which is why slot mode does not reuse
    # ``map_veto_config_map``.
    assert _uniques(MapVetoConfigSlotMap) == {"uq_map_veto_config_slot_map": ["map_veto_config_slot_id", "map_id"]}


def test_flat_pool_table_is_untouched():
    """Flat mode must not feel this feature (design Decision 2).

    Exact set equality, not a subset check: the failure worth guarding against is
    a slot column *leaking onto* the flat table, and a subset assertion cannot
    see that.
    """
    assert set(MapVetoConfigMap.__table__.columns.keys()) == {
        "id",
        "created_at",
        "updated_at",
        "map_veto_config_id",
        "map_id",
        "sort_order",
    }


def test_config_mode_and_rotation_are_enums_with_value_binding():
    """``values_callable`` is mandatory: without it SQLAlchemy binds member NAMES
    ('POOL'), which the PG type rejects on every insert."""
    for name in ("mode", "first_ban_rotation"):
        col_type = MapVetoConfig.__table__.columns[name].type
        assert col_type.enums, f"{name} is not an enum"
        assert all(value.islower() for value in col_type.enums), f"{name} binds names, not values"


def test_config_forbids_custom_preset_in_slot_mode():
    """Design §4.1's second CHECK. A NULL ``preset`` leaves the expression NULL,
    which a CHECK treats as satisfied — an unset preset is not a custom one."""
    assert _checks(MapVetoConfig)["ck_map_veto_config_slots_not_custom"] == "NOT (mode = 'slots' AND preset = 'custom')"
