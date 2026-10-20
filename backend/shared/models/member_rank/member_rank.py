from __future__ import annotations

from sqlalchemy import BigInteger, ColumnElement, ForeignKey, ForeignKeyConstraint, Index, Integer, select
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.catalog.role import CatalogRole

__all__ = ("MemberRank",)


class MemberRank(db.TimeStampIntegerMixin):
    """A workspace member's rank in one role, in one of two layers.

    ``author_user_id IS NULL`` is the workspace canon -- the number everybody in
    the workspace sees. A non-null ``author_user_id`` is that account's own
    private book: it outranks the canon when *their* mixes are balanced and is
    invisible to everyone else's.

    One table replaces three (``workspace_player_rank``, ``host_player_rank``
    and the per-game pin on ``custom_game_player``), so the resolver reads both
    layers in a single query. There is deliberately no ``scope`` column: the
    nullable author already *is* the discriminator, and a scope column would be
    a second source of truth for the same fact -- free to disagree with it.

    The subject is a ``workspace_member``, not a balancer-local player row: that
    is the anchor registrations, teams, drafts and achievements already use, so
    identity dedup comes from ``uq_workspace_member_workspace_player`` and the
    global user-merge instead of a parallel merge implementation.

    Held on a module role of the discipline's rated dimension: ``role_id``.
    The legacy ``role`` column is read by nothing until discipline02 drops it.
    """

    __tablename__ = "member_rank"
    __table_args__ = (
        # Partial indexes, not UniqueConstraint: Postgres treats NULLs in a
        # composite unique key as distinct, so a plain constraint over these
        # columns would happily store two canon rows for one (member, role).
        Index(
            "uq_member_rank_canon_role",
            "workspace_id",
            "workspace_member_id",
            "role_id",
            unique=True,
            postgresql_where="author_user_id IS NULL",
        ),
        Index(
            "uq_member_rank_author_role",
            "workspace_id",
            "author_user_id",
            "workspace_member_id",
            "role_id",
            unique=True,
            postgresql_where="author_user_id IS NOT NULL",
        ),
        ForeignKeyConstraint(
            ["role_id", "dimension_id"],
            ["catalog.role.id", "catalog.role.dimension_id"],
            name="fk_member_rank_role",
            deferrable=True,
            initially="DEFERRED",
        ),
        {"schema": "balancer"},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    workspace_member_id: Mapped[int] = mapped_column(ForeignKey("workspace_member.id", ondelete="CASCADE"), index=True)
    author_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("auth.user.id", ondelete="CASCADE"), nullable=True, index=True
    )
    dimension_id: Mapped[int] = mapped_column(BigInteger(), nullable=False)
    role_id: Mapped[int] = mapped_column(BigInteger(), nullable=False, index=True)
    rank_value: Mapped[int] = mapped_column(Integer(), nullable=False)

    catalog_role: Mapped[CatalogRole] = relationship(
        primaryjoin="foreign(MemberRank.role_id) == CatalogRole.id", foreign_keys=[role_id], lazy="joined"
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
