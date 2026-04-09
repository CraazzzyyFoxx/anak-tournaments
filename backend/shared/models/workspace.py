from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

__all__ = (
    "Workspace",
    "WorkspaceMember",
)


class Workspace(db.TimeStampIntegerMixin):
    __tablename__ = "workspace"

    slug: Mapped[str] = mapped_column(String(), unique=True, index=True)
    name: Mapped[str] = mapped_column(String())
    description: Mapped[str | None] = mapped_column(String(), nullable=True)
    icon_url: Mapped[str | None] = mapped_column(String(), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean(), server_default="true")
    division_grid_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace", passive_deletes=True
    )


class WorkspaceMember(db.TimeStampIntegerMixin):
    __tablename__ = "workspace_member"

    __table_args__ = (UniqueConstraint("workspace_id", "auth_user_id"),)

    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    auth_user_id: Mapped[int] = mapped_column(
        ForeignKey("auth.user.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(), server_default="member")

    workspace: Mapped["Workspace"] = relationship(back_populates="members")
