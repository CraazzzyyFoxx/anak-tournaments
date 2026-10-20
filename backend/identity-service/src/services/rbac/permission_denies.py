from __future__ import annotations

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.identity.rbac import Permission, UserPermissionDeny
from shared.repository import (
    AuthUserRepository,
    PermissionRepository,
    UserPermissionDenyRepository,
    WorkspaceRepository,
)
from src import models
from src.services.audit import record_operator_audit
from src.services.rbac_policy import RbacPolicy, rbac_policy
from src.services.session_cache import SessionCache, session_cache


def _deny_payload(permission: Permission, workspace_id: int | None) -> dict:
    return {
        "permission_id": permission.id,
        "name": permission.name,
        "resource": permission.resource,
        "action": permission.action,
        "description": permission.description,
        "workspace_id": workspace_id,
    }


class PermissionDenyService:
    """Per-user permission denies (negative RBAC).

    ``workspace_id=None`` denies the permission globally (everywhere); a concrete
    ``workspace_id`` scopes the deny to that workspace only. A user can hold both
    a global and a workspace-scoped deny for the same permission at once
    (distinct rows per the partial-unique index), which is why every lookup goes
    through ``UserPermissionDenyRepository.workspace_scope`` — a NULL-safe scope
    predicate whose reasoning is documented at the repository.
    """

    def __init__(
        self,
        *,
        policy: RbacPolicy = rbac_policy,
        denies: UserPermissionDenyRepository = UserPermissionDenyRepository(),
        permissions: PermissionRepository = PermissionRepository(),
        users: AuthUserRepository = AuthUserRepository(),
        workspaces: WorkspaceRepository = WorkspaceRepository(),
        cache: SessionCache = session_cache,
    ) -> None:
        self._policy = policy
        self._denies = denies
        self._permissions = permissions
        self._users = users
        self._workspaces = workspaces
        self._cache = cache

    async def list(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
        user_id: int,
    ) -> list[dict]:
        """List the permissions explicitly denied for a user (global + per-workspace)."""
        self._policy.require_permission(current_user, "auth_user", "read")
        rows = await self._denies.list_with_permissions(session, user_id)
        return [_deny_payload(permission, workspace_id) for permission, workspace_id in rows]

    async def add(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
        user_id: int,
        permission_id: int,
        reason: str | None = None,
        workspace_id: int | None = None,
        *,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> list[dict]:
        """Deny a permission to a user (idempotent). Rejects governance permissions."""
        self._policy.require_permission(current_user, "auth_user", "update")

        user = await self._users.get(session, user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        permission = await self._permissions.get(session, permission_id)
        if permission is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Permission not found")
        if permission.resource in self._policy.DENY_PROTECTED_RESOURCES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot deny governance permission '{permission.name}'",
            )

        if workspace_id is not None and await self._workspaces.get(session, workspace_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

        existing = await self._denies.get_scoped(
            session, user_id=user_id, permission_id=permission_id, workspace_id=workspace_id
        )
        if existing is None:
            await self._denies.create(
                session,
                UserPermissionDeny(
                    user_id=user_id,
                    permission_id=permission_id,
                    workspace_id=workspace_id,
                    created_by=current_user.id,
                    reason=reason,
                ),
            )
            await record_operator_audit(
                session,
                current_user,
                action="permission_deny.add",
                workspace_id=workspace_id,
                entity_type="auth_user",
                entity_id=user_id,
                entity_label=user.username or user.email,
                after={
                    "permission_id": permission_id,
                    "permission_name": permission.name,
                    "workspace_id": workspace_id,
                },
                reason=reason,
                ip_address=ip_address,
                user_agent=user_agent,
            )
            await session.commit()
            logger.info(
                f"Permission denied to user: user_id={user_id} permission={permission.name} "
                f"workspace_id={workspace_id} actor={current_user.id}"
            )
        await self._cache.invalidate_rbac(user_id)
        return await self.list(session, current_user, user_id)

    async def remove(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
        user_id: int,
        permission_id: int,
        workspace_id: int | None = None,
        *,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> list[dict]:
        """Remove a permission deny from a user (idempotent).

        Matches the exact ``(user_id, permission_id, workspace_id)`` scope so
        removing a global deny never removes a workspace-scoped deny for the same
        permission, and vice-versa.
        """
        self._policy.require_permission(current_user, "auth_user", "update")
        removed = await self._denies.delete_scoped(
            session, user_id=user_id, permission_id=permission_id, workspace_id=workspace_id
        )
        # Idempotent by contract: a remove that matched nothing lifted nothing, and
        # must not claim in the journal that it did.
        if removed:
            await record_operator_audit(
                session,
                current_user,
                action="permission_deny.remove",
                workspace_id=workspace_id,
                entity_type="auth_user",
                entity_id=user_id,
                before={"permission_id": permission_id, "workspace_id": workspace_id},
                ip_address=ip_address,
                user_agent=user_agent,
            )
        await session.commit()
        await self._cache.invalidate_rbac(user_id)
        logger.info(
            f"Permission deny removed: user_id={user_id} permission_id={permission_id} "
            f"workspace_id={workspace_id} actor={current_user.id}"
        )
        return await self.list(session, current_user, user_id)


permission_denies = PermissionDenyService()
