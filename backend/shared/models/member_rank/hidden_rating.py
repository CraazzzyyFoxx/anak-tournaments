from __future__ import annotations

from sqlalchemy import BigInteger, ColumnElement, Float, ForeignKey, ForeignKeyConstraint, UniqueConstraint, select
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.catalog.role import CatalogRole

__all__ = ("MemberHiddenRating",)


class MemberHiddenRating(db.TimeStampIntegerMixin):
    """The mix ranker's hidden ``(mu, sigma)`` of one member in one role.

    Derived data: it is a fold over the workspace's recorded mix rounds (``encounter.team_member`` /
    ``mix.round*``; ``MixRankerService.rebuild``), kept incrementally by every recorded match
    and rebuilt whenever that history or the workspace's hidden scale changes.
    Per workspace member, never per platform player: a host of another
    workspace must not be able to move it.
    """

    __tablename__ = "member_hidden_rating"
    __table_args__ = (
        UniqueConstraint("workspace_member_id", "role_id", name="uq_member_hidden_rating_member_role_id"),
        ForeignKeyConstraint(
            ["role_id", "dimension_id"],
            ["catalog.role.id", "catalog.role.dimension_id"],
            name="fk_member_hidden_rating_role",
            deferrable=True,
            initially="DEFERRED",
        ),
        {"schema": "balancer"},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    workspace_member_id: Mapped[int] = mapped_column(ForeignKey("workspace_member.id", ondelete="CASCADE"))
    dimension_id: Mapped[int] = mapped_column(BigInteger(), nullable=False)
    role_id: Mapped[int] = mapped_column(BigInteger(), nullable=False, index=True)
    mu: Mapped[float] = mapped_column(Float(), nullable=False)
    sigma: Mapped[float] = mapped_column(Float(), nullable=False)

    catalog_role: Mapped[CatalogRole] = relationship(
        primaryjoin="foreign(MemberHiddenRating.role_id) == CatalogRole.id", foreign_keys=[role_id], lazy="joined"
    )

    @hybrid_property
    def role(self) -> str:
        return self.catalog_role.code

    @role.inplace.expression
    @classmethod
    def _role_expression(cls) -> ColumnElement[str]:
        return (
            select(CatalogRole.code).where(CatalogRole.id == cls.role_id).correlate(cls).scalar_subquery().label("role")
        )
