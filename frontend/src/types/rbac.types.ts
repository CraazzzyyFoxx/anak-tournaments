export interface RbacPermission {
  id: number;
  name: string;
  resource: string;
  action: string;
  description?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface RbacRole {
  id: number;
  name: string;
  description?: string | null;
  is_system: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface RbacRoleDetail extends RbacRole {
  permissions: RbacPermission[];
}

export interface AuthAdminUser {
  id: number;
  email: string;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  is_active: boolean;
  is_superuser: boolean;
  is_verified: boolean;
  roles: RbacRole[];
  created_at: string;
  updated_at?: string | null;
}

export interface AuthAdminUserDetail extends AuthAdminUser {
  effective_permissions: string[];
}

export interface AssignRolePayload {
  user_id: number;
  role_id: number;
}

export interface UpsertRolePayload {
  name: string;
  description?: string | null;
  permission_ids: number[];
}
