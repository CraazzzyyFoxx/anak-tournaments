from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

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
    """

    __tablename__ = "member_rank"
    __table_args__ = (
        # Partial indexes, not UniqueConstraint: Postgres treats NULLs in a
        # composite unique key as distinct, so a plain constraint over these
        # columns would happily store two canon rows for one (member, role).
        Index(
            "uq_member_rank_canon",
            "workspace_id",
            "workspace_member_id",
            "role",
            unique=True,
            postgresql_where="author_user_id IS NULL",
        ),
        Index(
            "uq_member_rank_author",
            "workspace_id",
            "author_user_id",
            "workspace_member_id",
            "role",
            unique=True,
            postgresql_where="author_user_id IS NOT NULL",
        ),
        {"schema": "balancer"},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    workspace_member_id: Mapped[int] = mapped_column(
        ForeignKey("workspace_member.id", ondelete="CASCADE"), index=True
    )
    author_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("auth.user.id", ondelete="CASCADE"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    rank_value: Mapped[int] = mapped_column(Integer(), nullable=False)
