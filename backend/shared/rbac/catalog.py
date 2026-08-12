from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PermissionSpec:
    name: str
    resource: str
    action: str
    description: str


WORKSPACE_SYSTEM_ROLE_NAMES = ("owner", "admin", "member", "player")

CRUD = ("read", "create", "update", "delete")


def _permission(resource: str, action: str, description: str | None = None) -> PermissionSpec:
    name = "admin.*" if resource == "*" and action == "*" else f"{resource}.{action}"
    return PermissionSpec(
        name=name,
        resource=resource,
        action=action,
        description=description or f"{resource}.{action}",
    )


def _crud(resource: str) -> tuple[PermissionSpec, ...]:
    return tuple(_permission(resource, action) for action in CRUD)


PERMISSION_CATALOG: tuple[PermissionSpec, ...] = (
    _permission("*", "*", "Workspace-scoped wildcard permission"),
    *_crud("workspace"),
    *_crud("workspace_member"),
    *_crud("role"),
    _permission("permission", "read"),
    *_crud("api_key"),
    _permission("auth_user", "read"),
    _permission("auth_user", "update"),
    *_crud("user"),
    _permission("oauth_connection", "read"),
    _permission("oauth_connection", "delete"),
    *_crud("auth_session"),
    *_crud("tournament"),
    *_crud("stage"),
    *_crud("team"),
    *_crud("player"),
    *_crud("match"),
    *_crud("standing"),
    *_crud("registration_form"),
    *_crud("registration"),
    _permission("registration", "approve"),
    _permission("registration", "reject"),
    _permission("registration", "check_in"),
    *_crud("registration_status"),
    *_crud("balancer"),
    *_crud("analytics"),
    *_crud("achievement"),
    *_crud("division_grid"),
    *_crud("log"),
    *_crud("discord_channel"),
    *_crud("challonge"),
    *_crud("asset"),
    _permission("rank", "read", "Read rank-collection health and fetch history"),
    _permission("rank", "update", "Trigger a rank re-fetch"),
    _permission("subscription", "read", "Read subscription-collection health and check history"),
    _permission("subscription", "update", "Trigger a subscription re-check"),
    _permission("audit", "read", "Read the platform audit log"),
    # Self-service capabilities: allowed by default for every authenticated user;
    # exist only so an admin can DENY them per user (negative RBAC).
    _permission("account", "avatar", "Change one's own avatar"),
    _permission("account", "social", "Manage one's own social accounts"),
    _permission("registration", "self_register", "Self-register for a tournament"),
)

_ALL_PERMISSION_NAMES = frozenset(permission.name for permission in PERMISSION_CATALOG)

_GOVERNANCE_RESOURCES = frozenset(("role", "permission"))
_MEMBER_READ_RESOURCES = frozenset(
    (
        "workspace",
        "workspace_member",
        "user",
        "tournament",
        "stage",
        "team",
        "player",
        "match",
        "standing",
        "registration_form",
        "registration",
        "registration_status",
        "balancer",
        "analytics",
        "achievement",
        "division_grid",
        "log",
        "discord_channel",
        "challonge",
        "asset",
    )
)


def _admin_permission_names() -> tuple[str, ...]:
    names: list[str] = []
    for permission in PERMISSION_CATALOG:
        if permission.name == "admin.*":
            continue
        if permission.resource in _GOVERNANCE_RESOURCES:
            continue
        if permission.name in {"workspace.delete", "workspace_member.delete"}:
            continue
        names.append(permission.name)
    return tuple(names)


def _member_permission_names() -> tuple[str, ...]:
    return tuple(
        permission.name
        for permission in PERMISSION_CATALOG
        if permission.action == "read" and permission.resource in _MEMBER_READ_RESOURCES
    )


def permission_names_for_workspace_role(role_name: str) -> tuple[str, ...]:
    if role_name == "owner":
        return ("admin.*",)
    if role_name == "admin":
        return _admin_permission_names()
    if role_name == "member":
        return _member_permission_names()
    if role_name == "player":
        return ()
    raise ValueError(f"Unknown workspace system role: {role_name}")


def assert_catalog_consistent() -> None:
    if len(_ALL_PERMISSION_NAMES) != len(PERMISSION_CATALOG):
        raise RuntimeError("RBAC permission catalog contains duplicate names")


assert_catalog_consistent()
