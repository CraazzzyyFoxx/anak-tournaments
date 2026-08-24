from sqlalchemy import Enum as SAEnum
from sqlalchemy import String, UniqueConstraint

from shared.models.workspace_player.workspace_player import (
    HostPlayer,
    HostPlayerRank,
    WorkspacePlayer,
    WorkspacePlayerRank,
)
from shared.models.registration.registration import BalancerRegistration


def _fk(column):
    return next(iter(column.foreign_keys))


def test_workspace_player_table_name_and_schema():
    assert WorkspacePlayer.__tablename__ == "workspace_player"
    assert WorkspacePlayer.__table__.schema == "balancer"


def test_workspace_player_rank_table_name_and_schema():
    assert WorkspacePlayerRank.__tablename__ == "workspace_player_rank"
    assert WorkspacePlayerRank.__table__.schema == "balancer"


def test_workspace_player_required_columns_present():
    cols = set(WorkspacePlayer.__table__.columns.keys())
    assert {
        "id",
        "created_at",
        "updated_at",
        "workspace_id",
        "battle_tag",
        "battle_tag_normalized",
        "display_name",
        "player_id",
        "workspace_member_id",
        "hidden_at",
    } <= cols


def test_workspace_player_rank_required_columns_present():
    cols = set(WorkspacePlayerRank.__table__.columns.keys())
    assert {"id", "created_at", "updated_at", "workspace_player_id", "role", "rank_value"} <= cols


def test_workspace_player_player_id_nullable():
    assert WorkspacePlayer.__table__.columns["player_id"].nullable is True


def test_workspace_player_workspace_id_fk_cascade():
    fk = _fk(WorkspacePlayer.__table__.columns["workspace_id"])
    assert fk.column.table.name == "workspace"
    assert fk.ondelete == "CASCADE"


def test_workspace_player_player_id_fk_set_null():
    fk = _fk(WorkspacePlayer.__table__.columns["player_id"])
    assert fk.column.table.name == "user"
    assert fk.column.table.schema == "players"
    assert fk.ondelete == "SET NULL"


def test_workspace_player_workspace_member_id_fk_set_null():
    fk = _fk(WorkspacePlayer.__table__.columns["workspace_member_id"])
    assert fk.column.table.name == "workspace_member"
    assert fk.ondelete == "SET NULL"


def test_workspace_player_rank_fk_cascade():
    fk = _fk(WorkspacePlayerRank.__table__.columns["workspace_player_id"])
    assert fk.column.table.name == "workspace_player"
    assert fk.column.table.schema == "balancer"
    assert fk.ondelete == "CASCADE"


def test_workspace_player_tag_partial_unique():
    idx = next(i for i in WorkspacePlayer.__table__.indexes if i.name == "uq_workspace_player_tag_active")
    assert idx.unique
    assert [c.name for c in idx.columns] == ["workspace_id", "battle_tag_normalized"]
    assert idx.dialect_options["postgresql"]["where"] == (
        "battle_tag_normalized IS NOT NULL AND hidden_at IS NULL"
    )


def test_workspace_player_player_partial_unique():
    idx = next(i for i in WorkspacePlayer.__table__.indexes if i.name == "uq_workspace_player_player_active")
    assert idx.unique
    assert [c.name for c in idx.columns] == ["workspace_id", "player_id"]
    assert idx.dialect_options["postgresql"]["where"] == "player_id IS NOT NULL AND hidden_at IS NULL"


def test_workspace_player_rank_unique_on_player_and_role():
    cons = next(
        c
        for c in WorkspacePlayerRank.__table__.constraints
        if isinstance(c, UniqueConstraint) and c.name == "uq_workspace_player_rank"
    )
    assert [c.name for c in cons.columns] == ["workspace_player_id", "role"]


def test_workspace_player_rank_role_is_string_not_enum():
    col = WorkspacePlayerRank.__table__.columns["role"]
    assert isinstance(col.type, String)
    assert not isinstance(col.type, SAEnum)
    assert col.type.length == 16
    assert col.nullable is False


def test_registration_workspace_player_id_fk_set_null():
    col = BalancerRegistration.__table__.columns["workspace_player_id"]
    assert col.nullable is True
    fk = _fk(col)
    assert fk.column.table.name == "workspace_player"
    assert fk.column.table.schema == "balancer"
    assert fk.ondelete == "SET NULL"
    assert any("workspace_player_id" in {c.name for c in idx.columns} for idx in BalancerRegistration.__table__.indexes)


def test_host_player_table_name_and_schema():
    assert HostPlayer.__tablename__ == "host_player"
    assert HostPlayer.__table__.schema == "balancer"


def test_host_player_rank_table_name_and_schema():
    assert HostPlayerRank.__tablename__ == "host_player_rank"
    assert HostPlayerRank.__table__.schema == "balancer"


def test_host_player_required_columns_present():
    cols = set(HostPlayer.__table__.columns.keys())
    assert {"id", "created_at", "updated_at", "workspace_id", "host_user_id", "workspace_player_id"} <= cols


def test_host_player_rank_required_columns_present():
    cols = set(HostPlayerRank.__table__.columns.keys())
    assert {"id", "created_at", "updated_at", "host_user_id", "workspace_player_id", "role", "rank_value"} <= cols


def test_host_player_workspace_id_fk_cascade():
    fk = _fk(HostPlayer.__table__.columns["workspace_id"])
    assert fk.column.table.name == "workspace"
    assert fk.ondelete == "CASCADE"


def test_host_player_host_user_id_fk_cascade():
    fk = _fk(HostPlayer.__table__.columns["host_user_id"])
    assert fk.column.table.name == "user"
    assert fk.column.table.schema == "auth"
    assert fk.ondelete == "CASCADE"


def test_host_player_workspace_player_id_fk_cascade():
    fk = _fk(HostPlayer.__table__.columns["workspace_player_id"])
    assert fk.column.table.name == "workspace_player"
    assert fk.column.table.schema == "balancer"
    assert fk.ondelete == "CASCADE"


def test_host_player_rank_host_user_id_fk_cascade():
    fk = _fk(HostPlayerRank.__table__.columns["host_user_id"])
    assert fk.column.table.name == "user"
    assert fk.column.table.schema == "auth"
    assert fk.ondelete == "CASCADE"


def test_host_player_rank_workspace_player_fk_cascade():
    fk = _fk(HostPlayerRank.__table__.columns["workspace_player_id"])
    assert fk.column.table.name == "workspace_player"
    assert fk.column.table.schema == "balancer"
    assert fk.ondelete == "CASCADE"


def test_host_player_unique_workspace_host_player():
    cons = next(
        c
        for c in HostPlayer.__table__.constraints
        if isinstance(c, UniqueConstraint) and c.name == "uq_host_player"
    )
    assert [c.name for c in cons.columns] == ["workspace_id", "host_user_id", "workspace_player_id"]


def test_host_player_rank_unique_host_player_role():
    cons = next(
        c
        for c in HostPlayerRank.__table__.constraints
        if isinstance(c, UniqueConstraint) and c.name == "uq_host_player_rank"
    )
    assert [c.name for c in cons.columns] == ["host_user_id", "workspace_player_id", "role"]


def test_host_player_rank_role_is_string_not_enum():
    col = HostPlayerRank.__table__.columns["role"]
    assert isinstance(col.type, String)
    assert not isinstance(col.type, SAEnum)
    assert col.type.length == 16
    assert col.nullable is False


def test_host_player_rank_value_not_null():
    assert HostPlayerRank.__table__.columns["rank_value"].nullable is False
