import { apiFetch } from "@/lib/api-fetch";
import type {
  AssignRolePayload,
  AuthAdminUser,
  AuthAdminUserDetail,
  OAuthConnectionAdmin,
  RbacPermission,
  RbacRole,
  RbacRoleDetail,
  UpsertRolePayload,
} from "@/types/rbac.types";

async function rbacFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await apiFetch("auth", path, {
    method: init?.method,
    body: init?.body,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const rbacService = {
  listUsers(params?: {
    search?: string;
    role_id?: number;
    is_active?: boolean;
    is_superuser?: boolean;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set("search", params.search);
    if (params?.role_id !== undefined) searchParams.set("role_id", String(params.role_id));
    if (params?.is_active !== undefined) searchParams.set("is_active", String(params.is_active));
    if (params?.is_superuser !== undefined) searchParams.set("is_superuser", String(params.is_superuser));

    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return rbacFetch<AuthAdminUser[]>(`/rbac/users${suffix}`);
  },

  getUser(userId: number) {
    return rbacFetch<AuthAdminUserDetail>(`/rbac/users/${userId}`);
  },

  listRoles(params?: { workspace_id?: number | null }) {
    const searchParams = new URLSearchParams();
    if (params?.workspace_id !== undefined && params.workspace_id !== null) {
      searchParams.set("workspace_id", String(params.workspace_id));
    }
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return rbacFetch<RbacRole[]>(`/rbac/roles${suffix}`);
  },

  getRole(roleId: number) {
    return rbacFetch<RbacRoleDetail>(`/rbac/roles/${roleId}`);
  },

  createRole(payload: UpsertRolePayload) {
    return rbacFetch<RbacRole>("/rbac/roles", {
      method: "POST",
      body: payload,
    });
  },

  updateRole(roleId: number, payload: Partial<UpsertRolePayload>) {
    return rbacFetch<RbacRole>(`/rbac/roles/${roleId}`, {
      method: "PATCH",
      body: payload,
    });
  },

  deleteRole(roleId: number) {
    return rbacFetch<void>(`/rbac/roles/${roleId}`, {
      method: "DELETE",
    });
  },

  listPermissions() {
    return rbacFetch<RbacPermission[]>("/rbac/permissions");
  },

  assignRole(payload: AssignRolePayload) {
    return rbacFetch<void>("/rbac/users/assign-role", {
      method: "POST",
      body: payload,
    });
  },

  removeRole(payload: AssignRolePayload) {
    return rbacFetch<void>("/rbac/users/remove-role", {
      method: "POST",
      body: payload,
    });
  },

  listOAuthConnections(params?: { search?: string; provider?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set("search", params.search);
    if (params?.provider) searchParams.set("provider", params.provider);

    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return rbacFetch<OAuthConnectionAdmin[]>(`/rbac/oauth-connections${suffix}`);
  },

  deleteOAuthConnection(connectionId: number) {
    return rbacFetch<void>(`/rbac/oauth-connections/${connectionId}`, {
      method: "DELETE",
    });
  },
};
