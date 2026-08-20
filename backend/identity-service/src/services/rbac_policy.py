"""RBAC authorization policy — the guards, none of the data access.

Pure predicate/raise decisions over an already-loaded ``AuthUser``. Three
different scoping shapes exist deliberately and each emits its own message; the
admin surface has shipped them long enough that the strings are part of the
contract, so they are reproduced rather than unified.
"""

from __future__ import annotations

from collections.abc import Sequence

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.identity.rbac import Permission, Role
from src import models


class RbacPolicy:
    """Authorization decisions for the RBAC admin surface."""

    ADMIN_EQUIVALENT_ROLE_NAMES = {"admin"}

    # Names an operator may never mint a new role under. ``admin`` is a hardcoded
    # trust marker in the shared AuthUser model (``_has_admin_equivalent_role`` ->
    # full bypass); ``owner``/``member``/``player`` are system/trusted role names.
    # Allowing a self-service role with any of these names would be an escalation
    # path, so role creation rejects them (case-insensitive).
    RESERVED_ROLE_NAMES = frozenset({"admin", "owner", "member", "player"})

    # A deny on these resources could lock RBAC administration out of the system
    # or brick a superuser; never deniable.
    DENY_PROTECTED_RESOURCES = frozenset({"*", "role", "permission", "auth_user"})

    @staticmethod
    def actor_label(user: models.AuthUser) -> str | None:
        """Snapshot of the actor's display name at the moment of the action.

        identity-svc resolves ``current_user`` from the bearer token before any
        flow runs, so this is a live row rather than an id lifted off an
        envelope: the label is a true snapshot and keeps the row readable after
        the account is deleted.
        """
        return user.username or user.email

    @staticmethod
    def permission_key(resource: str, action: str) -> str:
        if resource == "*" and action == "*":
            return "admin.*"
        return f"{resource}.{action}"

    @staticmethod
    def has_global(user: models.AuthUser, resource: str, action: str) -> bool:
        return bool(getattr(user, "is_superuser", False)) or user.has_permission(resource, action)

    @staticmethod
    def has_workspace(user: models.AuthUser, workspace_id: int, resource: str, action: str) -> bool:
        return bool(getattr(user, "is_superuser", False)) or user.has_workspace_permission(
            workspace_id, resource, action
        )

    @staticmethod
    def effective_permissions(user: models.AuthUser) -> list[str]:
        keys = {
            RbacPolicy.permission_key(permission.resource, permission.action)
            for role in user.roles
            if role.workspace_id is None
            for permission in role.permissions
        }
        return sorted(keys)

    def require_superuser(self, user: models.AuthUser) -> None:
        """The superuser-only gate the RBAC admin surface uses."""
        if not user.is_superuser:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")

    def require_permission(self, user: models.AuthUser, resource: str, action: str) -> None:
        """Require an exact global ``resource.action`` grant.

        Deliberately has no superuser shortcut: ``has_permission`` already grants
        one for admin-equivalent holders, and the check this replaces never
        consulted ``is_superuser`` either.
        """
        if not user.has_permission(resource, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {resource}.{action} required",
            )

    def require_scoped_permission(
        self,
        user: models.AuthUser,
        workspace_id: int | None,
        resource: str,
        action: str,
    ) -> None:
        """Global-or-workspace check for a non-role resource (listings, denies)."""
        allowed = (
            self.has_global(user, resource, action)
            if workspace_id is None
            else self.has_workspace(user, workspace_id, resource, action)
        )
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {resource}.{action} required",
            )

    def require_role_scope(
        self,
        user: models.AuthUser,
        workspace_id: int | None,
        action: str,
        *,
        global_fallback: bool = True,
    ) -> None:
        """Role-resource check, scoped by ``workspace_id``.

        ``global_fallback`` distinguishes the two shapes the surface exposes.
        Read paths (role list/detail) let a global ``role.read`` holder see a
        workspace role and answer "Access denied" when neither grant applies;
        write paths (create/assign/remove) require the grant in the role's own
        scope and name the missing permission. Collapsing the two would change
        both the authorization envelope and the message.
        """
        if workspace_id is not None:
            if global_fallback:
                if not self.has_workspace(user, workspace_id, "role", action) and not self.has_global(
                    user, "role", action
                ):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
            elif not self.has_workspace(user, workspace_id, "role", action):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: role.{action} required",
                )
            return

        if not self.has_global(user, "role", action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: role.{action} required",
            )

    def require_role_access(self, user: models.AuthUser, role: Role, required_action: str) -> None:
        """Check access control for a role based on its scope (global vs workspace)."""
        self.require_role_scope(user, role.workspace_id, required_action, global_fallback=False)

    def require_can_grant(
        self,
        user: models.AuthUser,
        permissions: Sequence[Permission],
        workspace_id: int | None,
    ) -> None:
        """Privilege-ceiling guard (review M / RBAC): an actor may only
        create/update/assign a role whose permission set is a SUBSET of the
        permissions the actor themselves effectively holds.
        Without this, ``role.create`` + ``role.update`` (or a workspace ``role.*``)
        would let a limited operator mint or hand out a role more powerful than
        their own — a straightforward privilege escalation. Superusers (and, via
        ``has_*_permission``, global-admin-equivalent holders / workspace wildcard
        owners) bypass, since they already hold everything.
        """
        if getattr(user, "is_superuser", False):
            return
        for permission in permissions:
            if workspace_id is None:
                allowed = user.has_permission(permission.resource, permission.action)
            else:
                allowed = user.has_workspace_permission(workspace_id, permission.resource, permission.action)
            if not allowed:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Permission denied: cannot grant a role carrying a permission you do not "
                        f"hold ({self.permission_key(permission.resource, permission.action)})"
                    ),
                )


rbac_policy = RbacPolicy()
