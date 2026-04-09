"""Authentication dependencies for balancer-service (stateless, no DB)."""

from typing import Any

from shared.core.auth import create_auth_dependencies
from shared.models.auth_user import AuthUser
from shared.models.rbac import Permission, Role


def _safe_str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _build_roles(value: Any) -> list[Role]:
    if not isinstance(value, list):
        return []
    roles: list[Role] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            roles.append(Role(name=item.strip()))
    return roles


def _build_permissions(value: Any) -> list[Permission]:
    if not isinstance(value, list):
        return []
    permissions: list[Permission] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        resource = item.get("resource")
        action = item.get("action")
        if not isinstance(resource, str) or not resource.strip():
            continue
        if not isinstance(action, str) or not action.strip():
            continue
        resource = resource.strip()
        action = action.strip()
        permissions.append(
            Permission(
                name=f"{resource}.{action}",
                resource=resource,
                action=action,
            )
        )
    return permissions


async def _resolve_user_from_token(
    user_id: int, payload: dict[str, Any]
) -> AuthUser:
    roles = _build_roles(payload.get("roles"))
    permissions = _build_permissions(payload.get("permissions"))
    if permissions:
        if roles:
            for role in roles:
                role.permissions = permissions
        else:
            role = Role(name="token")
            role.permissions = permissions
            roles = [role]

    user = AuthUser(
        id=user_id,
        username=_safe_str(payload.get("username")),
        email=_safe_str(payload.get("email")),
        is_active=True,
        is_superuser=bool(payload.get("is_superuser", False)),
    )
    user.roles = roles
    return user


_auth = create_auth_dependencies(_resolve_user_from_token)

get_current_user = _auth.get_current_user
get_current_active_user = _auth.get_current_active_user
get_current_superuser = _auth.get_current_superuser
require_permission = _auth.require_permission
require_role = _auth.require_role
require_any_role = _auth.require_any_role
require_workspace_member = _auth.require_workspace_member
