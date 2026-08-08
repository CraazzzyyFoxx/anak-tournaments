"""Model-metadata tests for the ``map_veto_config_map`` child table (dbarch05).

Pure metadata tests (no DB connection): verify the JSON ``map_pool_ids`` array
was normalized into a proper FK child table, that ``MapVetoConfig`` no longer
declares the JSON column, and that the ``map_pool`` relationship links them.
"""

from shared.models.tournament.encounter_map import (
    MapVetoConfig,
    MapVetoConfigMap,
)


def test_map_veto_config_no_longer_has_map_pool_ids_column():
    cols = set(MapVetoConfig.__table__.columns.keys())
    assert "map_pool_ids" not in cols
    # veto_sequence_json is template-shaped and intentionally kept.
    assert "veto_sequence_json" in cols


def test_child_table_name_and_schema():
    assert MapVetoConfigMap.__table__.name == "map_veto_config_map"
    assert MapVetoConfigMap.__table__.schema == "tournament"


def test_child_columns_present():
    cols = set(MapVetoConfigMap.__table__.columns.keys())
    assert {"map_veto_config_id", "map_id", "sort_order"} <= cols


def test_config_fk_targets_map_veto_config_cascade():
    col = MapVetoConfigMap.__table__.columns["map_veto_config_id"]
    fk = next(iter(col.foreign_keys))
    assert fk.column.table.name == "map_veto_config"
    assert fk.column.table.schema == "tournament"
    assert fk.ondelete == "CASCADE"


def test_map_fk_targets_overwatch_map_cascade():
    col = MapVetoConfigMap.__table__.columns["map_id"]
    fk = next(iter(col.foreign_keys))
    assert fk.column.table.name == "map"
    assert fk.column.table.schema == "overwatch"
    assert fk.ondelete == "CASCADE"


def test_unique_constraint_on_config_and_map():
    uniques = {
        c.name: [col.name for col in c.columns]
        for c in MapVetoConfigMap.__table__.constraints
        if c.name == "uq_map_veto_config_map_config_map"
    }
    assert uniques["uq_map_veto_config_map_config_map"] == [
        "map_veto_config_id",
        "map_id",
    ]


def test_map_pool_relationship_exists_and_is_list():
    rel = MapVetoConfig.__mapper__.relationships["map_pool"]
    assert rel.uselist is True


def test_slot_tables_exist_with_cascades_and_uniques():
    from shared.models.tournament.encounter_map import MapVetoConfigSlot, MapVetoConfigSlotMap

    assert MapVetoConfigSlot.__table__.schema == "tournament"
    assert {"map_veto_config_id", "position", "reserve_map_id"} <= set(MapVetoConfigSlot.__table__.columns.keys())
    config_fk = next(iter(MapVetoConfigSlot.__table__.columns["map_veto_config_id"].foreign_keys))
    assert config_fk.ondelete == "CASCADE"
    reserve_fk = next(iter(MapVetoConfigSlot.__table__.columns["reserve_map_id"].foreign_keys))
    assert reserve_fk.ondelete == "SET NULL"

    slot_fk = next(iter(MapVetoConfigSlotMap.__table__.columns["map_veto_config_slot_id"].foreign_keys))
    assert slot_fk.ondelete == "CASCADE"


def test_flat_pool_table_is_untouched():
    """Flat mode must not feel this feature (design Decision 2)."""
    from shared.models.tournament.encounter_map import MapVetoConfigMap

    uniques = {
        c.name: [col.name for col in c.columns]
        for c in MapVetoConfigMap.__table__.constraints
        if c.name == "uq_map_veto_config_map_config_map"
    }
    assert uniques["uq_map_veto_config_map_config_map"] == ["map_veto_config_id", "map_id"]


def test_config_mode_and_rotation_are_enums_with_value_binding():
    """`values_callable` is mandatory: without it SQLAlchemy binds member NAMES
    ('POOL'), which the PG type rejects on every insert."""
    from shared.models.tournament.encounter_map import MapVetoConfig

    for name in ("mode", "first_ban_rotation"):
        col_type = MapVetoConfig.__table__.columns[name].type
        assert col_type.enums, f"{name} is not an enum"
        assert all(value.islower() for value in col_type.enums), f"{name} binds names, not values"
