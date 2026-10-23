"""The role ontology of every discipline.

A module's dimensions and roles are projected here at startup (``shared.services.ontology``); a workspace adds its own
sub-roles as rows with ``workspace_id`` under a module role. Every role a player is assigned, prefers, is drafted on or
sits a balancer slot on is a row here, referenced by ``(role_id, dimension_id)``. Codes, not ids, are the domain's
vocabulary: a code is unique per dimension and workspace.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, aliased, mapped_column, relationship
from sqlalchemy.sql import ColumnElement
from sqlalchemy.sql.selectable import ScalarSelect

from shared.core import db

__all__ = ("CatalogRole", "RoleDimension", "leaf_code")


class RoleDimension(db.Base):
    __tablename__ = "role_dimension"
    __table_args__ = (
        CheckConstraint("selection_mode IN ('single', 'multi')", name="ck_role_dimension_selection_mode"),
        UniqueConstraint("discipline", "code", name="uq_role_dimension_code"),
        UniqueConstraint("id", "discipline", name="uq_role_dimension_key"),
        # At most one rated dimension per discipline; "exactly one" is the projection's check.
        Index("uq_role_dimension_rated", "discipline", unique=True, postgresql_where=text("rated")),
        {"schema": "catalog"},
    )

    id: Mapped[int] = mapped_column(BigInteger(), primary_key=True)
    discipline: Mapped[str] = mapped_column(
        String(32), ForeignKey("catalog.discipline.code", name="fk_role_dimension_discipline")
    )
    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(64))
    selection_mode: Mapped[str] = mapped_column(String(8))
    rated: Mapped[bool] = mapped_column(Boolean(), default=False, server_default=text("false"))
    active: Mapped[bool] = mapped_column(Boolean(), default=True, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer(), default=0, server_default=text("0"))


class CatalogRole(db.TimeStampIntegerMixin):
    __tablename__ = "role"
    __table_args__ = (
        UniqueConstraint("id", "dimension_id", name="uq_role_key"),
        ForeignKeyConstraint(
            ["parent_role_id", "dimension_id"], ["catalog.role.id", "catalog.role.dimension_id"], name="fk_role_parent"
        ),
        CheckConstraint("workspace_id IS NULL OR parent_role_id IS NOT NULL", name="ck_role_workspace_is_child"),
        CheckConstraint("jsonb_typeof(attrs) = 'object'", name="ck_role_attrs"),
        Index(
            "uq_role_module_code", "dimension_id", "code", unique=True, postgresql_where=text("workspace_id IS NULL")
        ),
        Index(
            "uq_role_workspace_code",
            "dimension_id",
            "workspace_id",
            "code",
            unique=True,
            postgresql_where=text("workspace_id IS NOT NULL"),
        ),
        {"schema": "catalog"},
    )

    dimension_id: Mapped[int] = mapped_column(ForeignKey("catalog.role_dimension.id", name="fk_role_dimension"))
    #: ``None`` -- a module role; otherwise a workspace's sub-role, always under a parent.
    workspace_id: Mapped[int | None] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE", name="fk_role_workspace"), nullable=True
    )
    parent_role_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    code: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    selectable: Mapped[bool] = mapped_column(Boolean(), default=True, server_default=text("true"))
    active: Mapped[bool] = mapped_column(Boolean(), default=True, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer(), default=0, server_default=text("0"))
    #: NOTE: JSONB does not track in-place mutation -- always reassign.
    attrs: Mapped[dict] = mapped_column(JSONB(), nullable=False, default=dict, server_default=text("'{}'::jsonb"))

    dimension: Mapped[RoleDimension] = relationship(lazy="joined")
    parent: Mapped[CatalogRole | None] = relationship(
        primaryjoin="foreign(CatalogRole.parent_role_id) == remote(CatalogRole.id)",
        viewonly=True,
        lazy="joined",
        join_depth=2,
    )


def leaf_code(role_id: ColumnElement[int], *, top: bool) -> ScalarSelect[str | None]:
    """SQL projection of a leaf's top-level code, or its code only when it is a sub-role."""
    leaf, parent = aliased(CatalogRole), aliased(CatalogRole)
    code = func.coalesce(parent.code, leaf.code) if top else leaf.code
    query = select(code).select_from(leaf).outerjoin(parent, parent.id == leaf.parent_role_id).where(leaf.id == role_id)
    if not top:
        query = query.where(leaf.parent_role_id.is_not(None))
    return query.scalar_subquery()
