"""Tournament roster leaf assignments (D36, D86; spec §14.3).

Legacy player role columns remain unmapped until discipline02 drops them.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, ForeignKeyConstraint, func, literal_column, select
from sqlalchemy.orm import Mapped, aliased, mapped_column, relationship
from sqlalchemy.sql.elements import ColumnElement

from shared.core import db
from shared.models.catalog.role import CatalogRole, RoleDimension

__all__ = ("PlayerRole", "assignment_of", "rated_role_code")


class PlayerRole(db.Base):
    __tablename__ = "player_role"
    __table_args__ = (
        ForeignKeyConstraint(
            ["role_id", "dimension_id"], ["catalog.role.id", "catalog.role.dimension_id"], name="fk_player_role_role"
        ),
        {"schema": "tournament"},
    )

    player_id: Mapped[int] = mapped_column(
        ForeignKey("tournament.player.id", ondelete="CASCADE", name="fk_player_role_player"), primary_key=True
    )
    dimension_id: Mapped[int] = mapped_column(BigInteger())
    role_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True, autoincrement=False)
    role: Mapped[CatalogRole] = relationship(
        primaryjoin="foreign(PlayerRole.role_id) == CatalogRole.id", foreign_keys=[role_id], lazy="joined"
    )


def assignment_of(role: CatalogRole) -> PlayerRole:
    return PlayerRole(dimension_id=role.dimension_id, role_id=role.id, role=role)


def rated_role_code(player_id: ColumnElement[int], *, top: bool) -> ColumnElement[str | None]:
    """SQL counterpart of the player's top-level role/sub-role reads.

    ponytail: correlated lookup per row; use a lateral join if large stats reads become slow.
    """
    leaf, parent = aliased(CatalogRole, name="rated_leaf"), aliased(CatalogRole, name="rated_parent")
    code = func.coalesce(parent.code, leaf.code) if top else leaf.code
    query = (
        select(code.label("rated_code"))
        .select_from(PlayerRole)
        .join(leaf, leaf.id == PlayerRole.role_id)
        .join(RoleDimension, (RoleDimension.id == leaf.dimension_id) & RoleDimension.rated.is_(True))
        .outerjoin(parent, parent.id == leaf.parent_role_id)
        .where(PlayerRole.player_id == player_id)
    )
    if not top:
        query = query.where(leaf.parent_role_id.is_not(None))
    # Stable aliases, label and limit keep repeated expressions identical for PostgreSQL GROUP BY.
    return query.limit(literal_column("1")).scalar_subquery()
