"""
RBAC (Role-Based Access Control) models
"""
from typing import TYPE_CHECKING
from sqlalchemy import String, ForeignKey, Table, Column, Integer, Text, Boolean, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

if TYPE_CHECKING:
    from shared.models.auth_user import AuthUser

__all__ = ("Role", "Permission", "user_roles", "role_permissions")


# Association table for many-to-many relationship between users and roles
user_roles = Table(
    "user_roles",
    db.Base.metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("auth_user.id", ondelete="CASCADE"), nullable=False),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
    Column("created_at", db.DateTime(timezone=True), server_default=text("now()"), nullable=False),
)


class Role(db.TimeStampIntegerMixin):
    """Role model for RBAC"""
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean(), default=False, nullable=False)  # System roles can't be deleted
    
    # Relations
    users: Mapped[list["AuthUser"]] = relationship(
        secondary=user_roles,
        back_populates="roles"
    )
    permissions: Mapped[list["Permission"]] = relationship(
        secondary="role_permissions",
        back_populates="roles"
    )

    def __repr__(self):
        return f"<Role id={self.id} name={self.name}>"


class Permission(db.TimeStampIntegerMixin):
    """Permission model for RBAC"""
    __tablename__ = "permissions"

    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    resource: Mapped[str] = mapped_column(String(100), nullable=False, index=True)  # e.g., "tournament", "user", "team"
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # e.g., "create", "read", "update", "delete"
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    
    # Relations
    roles: Mapped[list["Role"]] = relationship(
        secondary="role_permissions",
        back_populates="permissions"
    )

    def __repr__(self):
        return f"<Permission id={self.id} name={self.name} resource={self.resource} action={self.action}>"


# Association table for many-to-many relationship between roles and permissions
role_permissions = Table(
    "role_permissions",
    db.Base.metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
    Column("permission_id", Integer, ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False),
    Column("created_at", db.DateTime(timezone=True), server_default=text("now()"), nullable=False),
)
