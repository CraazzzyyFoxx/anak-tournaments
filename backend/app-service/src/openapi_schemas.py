"""OpenAPI request/response model map for app-service RPC subjects.

Schemas-only module (no flows/DB) consumed by the export script — see
``shared.rpc.openapi``. Models mirror the return annotations of the flows each
handler calls (src/rpc/*.py + src/services/*/service.py + the CRUD registries).

Generic CRUD engine keys are ``<subject>#<entity>``. Endpoints returning ad-hoc
dicts / None (204) are omitted (generic object in the docs).
"""

from __future__ import annotations

from shared.core.pagination import Paginated
from shared.rpc.openapi import Op, QueryParam
from shared.schemas.catalog import CatalogEntityRead
from shared.schemas.quota import (
    QuotaOperationRead,
    QuotaOperationWrite,
    QuotaPlanLimitRead,
    QuotaPlanRead,
    QuotaPlanWrite,
    QuotaUsageRead,
)
from shared.schemas.team_format import TeamFormatRead, TeamFormatWrite
from src import schemas
from src.schemas.discipline import DisciplineDescriptor, DisciplineMetadata

# Reusable ad-hoc query params (handlers read these via c.q/c.q1, no query model).
_WS = QueryParam("workspace_id", "integer")
# The discipline reads take an explicit scope: a workspace id or the literal "all" (global view), so not an integer.
_WS_OR_ALL = QueryParam(
    "workspace_id", "string", description='Workspace id (positive integer) or the literal "all" for the global view'
)

OPERATIONS: dict[str, Op] = {
    "rpc.app.workspaces.team_format_get": Op(response=TeamFormatRead),
    "rpc.app.workspaces.team_format_put": Op(request=TeamFormatWrite, response=TeamFormatRead),
    # ── public native catalog ──────────────────────────────────────────────
    "rpc.app.catalog.list": Op(response=Paginated[CatalogEntityRead], query=schemas.CatalogEntityListQueryParams),
    "rpc.app.catalog.get": Op(response=CatalogEntityRead),
    "rpc.app.disciplines.list": Op(response=DisciplineDescriptor, response_array=True, query_params=(_WS_OR_ALL,)),
    "rpc.app.disciplines.metadata": Op(response=DisciplineMetadata, query_params=(_WS_OR_ALL,)),
    # ── users (identity reads) ─────────────────────────────────────────────
    "rpc.app.users.search": Op(
        response=schemas.UserSearch,
        response_array=True,
        query_params=(QueryParam("query"),),
    ),
    "rpc.app.users.by_name": Op(response=schemas.UserRead),
    # ── workspaces ─────────────────────────────────────────────────────────
    "rpc.app.workspaces.get": Op(response=schemas.WorkspaceRead),
    "rpc.app.workspaces.staff": Op(response=schemas.WorkspaceStaffMember, response_array=True),
    "rpc.app.workspaces.list": Op(response=schemas.WorkspaceListItem, response_array=True),
    "rpc.app.workspaces.by_slug": Op(response=schemas.WorkspaceRead, query_params=(QueryParam("slug"),)),
    # by_host answers with an ad-hoc {workspace_id, slug} (or null); only the
    # host query param is declared -- see the module docstring's convention.
    "rpc.app.workspaces.by_host": Op(query_params=(QueryParam("host"),)),
    "rpc.app.workspaces.icon_upload": Op(response=schemas.WorkspaceRead),
    "rpc.app.workspaces.icon_delete": Op(response=schemas.WorkspaceRead),
    "rpc.app.workspaces.create": Op(request=schemas.WorkspaceCreate, response=schemas.WorkspaceRead),
    "rpc.app.admin.update#workspace": Op(request=schemas.WorkspaceUpdate, response=schemas.WorkspaceRead),
    "rpc.app.workspaces.members_list": Op(
        response=Paginated[schemas.WorkspaceMemberRead],
        query_params=(
            QueryParam("page", "integer"),
            QueryParam("per_page", "integer"),
            QueryParam("search"),
            QueryParam("role_id", "integer"),
            QueryParam(
                "exclude_role_id",
                "integer",
                array=True,
                description="Drop members who hold any of these roles. Repeat the param or comma-separate ids.",
            ),
            QueryParam("sort"),
            QueryParam("order"),
        ),
    ),
    "rpc.app.workspaces.members_autofill_roles": Op(response=schemas.WorkspaceMemberAutofillResult),
    "rpc.app.workspaces.member_add": Op(request=schemas.WorkspaceMemberCreate, response=schemas.WorkspaceMemberRead),
    "rpc.app.workspaces.member_update": Op(request=schemas.WorkspaceMemberUpdate, response=schemas.WorkspaceMemberRead),
    "rpc.app.workspaces.set_custom_domain": Op(
        request=schemas.WorkspaceCustomDomainSet, response=schemas.WorkspaceRead
    ),
    "rpc.app.workspaces.verify_custom_domain": Op(response=schemas.WorkspaceRead),
    "rpc.app.workspaces.clear_custom_domain": Op(response=schemas.WorkspaceRead),
    "rpc.app.workspaces.discord_guild_verify": Op(
        request=schemas.WorkspaceDiscordGuildVerify, response=schemas.WorkspaceRead
    ),
    "rpc.app.workspaces.discord_guild_clear": Op(response=schemas.WorkspaceRead),
    "rpc.app.workspaces.my_discord_guilds": Op(response=schemas.WorkspaceDiscordGuildsRead),
    "rpc.app.workspaces.notification_config_get": Op(response=schemas.NotificationWorkspaceConfigRead),
    "rpc.app.workspaces.notification_config_update": Op(
        request=schemas.NotificationWorkspaceConfigUpdate, response=schemas.NotificationWorkspaceConfigRead
    ),
    "rpc.app.workspaces.verification_set": Op(request=schemas.WorkspaceVerificationSet, response=schemas.WorkspaceRead),
    "rpc.app.workspaces.owner_get": Op(response=schemas.WorkspaceOwnerRead),
    "rpc.app.workspaces.owner_set": Op(request=schemas.WorkspaceOwnerSet, response=schemas.WorkspaceOwnerRead),
    "rpc.app.workspaces.owner_transfer": Op(
        request=schemas.WorkspaceOwnerTransfer, response=schemas.WorkspaceOwnerRead
    ),
    "rpc.app.workspaces.quota_set": Op(request=schemas.WorkspaceQuotaSet, response=QuotaPlanLimitRead),
    # ── quota policy (superuser) + the workspace's own usage ────────────────
    "rpc.app.quota.plans": Op(response=QuotaPlanRead, response_array=True),
    "rpc.app.quota.plan_upsert": Op(request=QuotaPlanWrite, response=QuotaPlanRead),
    "rpc.app.quota.operations": Op(response=QuotaOperationRead, response_array=True),
    "rpc.app.quota.operation_upsert": Op(request=QuotaOperationWrite, response=QuotaOperationRead),
    "rpc.app.quota.workspace_usage": Op(response=QuotaUsageRead, query_params=(_WS,)),
    # ── game catalog admin (catalog.entity) ─────────────────────────────────
    "rpc.app.catalog.admin_list": Op(response=Paginated[CatalogEntityRead], query=schemas.CatalogEntityListQueryParams),
    "rpc.app.catalog.workspace_characters": Op(
        response=Paginated[CatalogEntityRead], query=schemas.CatalogEntityListQueryParams
    ),
    "rpc.app.catalog.admin_create": Op(request=schemas.CatalogEntityCreate, response=CatalogEntityRead),
    "rpc.app.catalog.admin_update": Op(request=schemas.CatalogEntityUpdate, response=CatalogEntityRead),
    "rpc.app.catalog.admin_delete": Op(),
    # ── metadata admin: catalog alias-miss queue ───────────────────────────
    "rpc.app.catalog_aliases.misses_list": Op(
        response=Paginated[schemas.CatalogAliasMissRead], query=schemas.CatalogAliasMissListQueryParams
    ),
    "rpc.app.catalog_aliases.attach": Op(request=schemas.CatalogAliasAttach),
    "rpc.app.catalog_aliases.dismiss": Op(),
    # ── platform audit log ─────────────────────────────────────────────────
    "rpc.app.audit_list": Op(response=Paginated[schemas.AuditLogRead], query=schemas.AuditLogListQueryParams),
    # ── users admin (CRUD + identities + merge) ────────────────────────────
    "rpc.app.users.admin_create": Op(request=schemas.UserCreate, response=schemas.UserRead),
    "rpc.app.users.admin_update": Op(request=schemas.UserAdminUpdate, response=schemas.UserRead),
    "rpc.app.users.merge_preview": Op(
        request=schemas.UserMergePreviewRequest, response=schemas.UserMergePreviewResponse
    ),
    "rpc.app.users.merge_execute": Op(
        request=schemas.UserMergeExecuteRequest, response=schemas.UserMergeExecuteResponse
    ),
    "rpc.app.users.social_add": Op(request=schemas.SocialAccountCreate, response=schemas.UserRead),
    "rpc.app.users.social_update": Op(request=schemas.SocialAccountUpdate, response=schemas.UserRead),
    "rpc.app.users.social_verify": Op(response=schemas.UserRead),
    "rpc.app.users.social_delete": Op(response=schemas.UserRead),
    "rpc.app.users.social_set_primary": Op(response=schemas.UserRead),
    "rpc.app.users.social_set_visibility": Op(request=schemas.SocialVisibilityUpdate, response=schemas.UserRead),
    # ── users self-service (capability ``account.social``) ──────────────────
    "rpc.app.users.me_social_list": Op(response=schemas.UserRead),
    "rpc.app.users.me_social_set_primary": Op(response=schemas.UserRead),
    # Request body is the ad-hoc {"visible": bool} the handler reads via
    # c.payload -- deliberately NOT SocialVisibilityUpdate, whose workspace_id
    # this self-service handler ignores (visibility here is always global).
    "rpc.app.users.me_social_set_visibility": Op(response=schemas.UserRead),
    "rpc.app.users.me_set_stream_visibility": Op(request=schemas.StreamVisibilityUpdate, response=schemas.UserRead),
    # Ad-hoc dict / 204 responses (me_favorite_add returns {"ok": True},
    # me_favorite_remove returns 204/None) are intentionally omitted -- see the
    # module docstring's "Endpoints returning ad-hoc dicts / None" convention.
    "rpc.app.users.me_favorites_list": Op(response=schemas.LookupItem, response_array=True),
    "rpc.app.users.avatar_delete": Op(response=schemas.UserRead),
    "rpc.app.users.avatar_upload": Op(response=schemas.UserRead),
    # ── notification inbox + announcement banner ───────────────────────────
    # ``cursor``/``limit`` are read ad-hoc via c.q1, so they are declared here
    # rather than through a query model.
    "rpc.app.notifications_list": Op(
        response=schemas.NotificationInboxRead,
        query_params=(
            QueryParam("cursor", description="Opaque continuation from the previous page's next_cursor."),
            QueryParam("limit", "integer", description="Page size (default 20, capped server-side)."),
        ),
    ),
    "rpc.app.notifications_mark_read": Op(
        request=schemas.NotificationMarkRead, response=schemas.NotificationMarkReadResult
    ),
    "rpc.app.notifications_delete": Op(request=schemas.NotificationDelete, response=schemas.NotificationDeleteResult),
    "rpc.app.notification_preferences_get": Op(response=schemas.NotificationPreferencesRead),
    "rpc.app.notification_preferences_update": Op(
        request=schemas.NotificationPreferencesUpdate, response=schemas.NotificationPreferencesRead
    ),
    # ── notifications admin (workspace-scoped operator screen) ─────────────
    "rpc.app.notification_admin_list": Op(
        response=Paginated[schemas.NotificationAdminItem],
        query_params=(
            _WS,
            QueryParam("kind", description="One notification kind; omitted lists every kind."),
            QueryParam("page", "integer", description="1-based page number (default 1)."),
            QueryParam("per_page", "integer", description="Page size (default 25, capped at 100)."),
        ),
    ),
    "rpc.app.notification_admin_retire": Op(
        request=schemas.NotificationRetire, response=schemas.NotificationRetireResult
    ),
    # ── notifications admin (one account's own notification state) ─────────
    "rpc.app.admin_user_notifications_get": Op(response=schemas.AdminUserNotificationsRead),
    "rpc.app.admin_user_notification_preferences_update": Op(
        request=schemas.NotificationPreferencesUpdate, response=schemas.AdminUserNotificationsRead
    ),
    "rpc.app.active_announcements": Op(response=schemas.NotificationItem, response_array=True),
    # ── announcements admin (operator CRUD) ────────────────────────────────
    "rpc.app.announcement_list": Op(
        response=schemas.NotificationItem,
        response_array=True,
        query_params=(
            _WS,
            QueryParam("limit", "integer", description="Page size (default 50, capped at 200)."),
        ),
    ),
    "rpc.app.announcement_create": Op(request=schemas.AnnouncementCreate, response=schemas.NotificationItem),
    "rpc.app.announcement_update": Op(request=schemas.AnnouncementUpdate, response=schemas.NotificationItem),
    # delete answers 204 with no body (the gateway drops the envelope) -- same
    # convention as the other 204 subjects above.
    "rpc.app.announcement_delete": Op(),
}
