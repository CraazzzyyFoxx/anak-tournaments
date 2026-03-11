import { fetchWithAuth } from "@/lib/fetch-with-auth";
import type {
  AssignRolePayload,
  AuthAdminUser,
  AuthAdminUserDetail,
  RbacPermission,
  RbacRole,
  RbacRoleDetail,
  UpsertRolePayload,
} from "@/types/rbac.types";

const AUTH_SERVICE_URL =
  process.env.NEXT_PUBLIC_AUTH_SERVICE_URL?.replace(/\/$/, "") || "http://localhost:8001";

async function rbacFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${AUTH_SERVICE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  const response = await fetchWithAuth(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = "Failed to complete RBAC request";
    try {
      const error = await response.json();
      message = error?.detail || error?.message || message;
    } catch {
      // Ignore non-JSON errors.
    }
    throw new Error(message);
  }

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

  listRoles() {
    return rbacFetch<RbacRole[]>("/rbac/roles");
  },

  getRole(roleId: number) {
    return rbacFetch<RbacRoleDetail>(`/rbac/roles/${roleId}`);
  },

  createRole(payload: UpsertRolePayload) {
    return rbacFetch<RbacRole>("/rbac/roles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateRole(roleId: number, payload: Partial<UpsertRolePayload>) {
    return rbacFetch<RbacRole>(`/rbac/roles/${roleId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
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
      body: JSON.stringify(payload),
    });
  },

  removeRole(payload: AssignRolePayload) {
    return rbacFetch<void>("/rbac/users/remove-role", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
