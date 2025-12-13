"""
Schemas for auth service
"""
from .auth import *
from .oauth import *
from .rbac import *

__all__ = [
    "UserRegister",
    "UserLogin",
    "Token",
    "TokenPayload",
    "RefreshTokenRequest",
    "AuthUser",
    "UserUpdate",
    "OAuthProvider",
    "OAuthURL",
    "OAuthCallbackRequest",
    "OAuthUserInfo",
    "PlayerLinkRequest",
    "PlayerLinkResponse",
    "LinkedPlayer",
    "PermissionBase",
    "PermissionCreate",
    "PermissionRead",
    "RoleBase",
    "RoleCreate",
    "RoleUpdate",
    "RoleRead",
    "RoleWithPermissions",
    "UserRoleAssign",
    "UserRoleRemove",
]
