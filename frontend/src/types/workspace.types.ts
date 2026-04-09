export interface DivisionTier {
  number: number;
  name: string;
  rank_min: number;
  rank_max: number | null;
  icon_path: string;
}

export interface DivisionGrid {
  tiers: DivisionTier[];
}

export interface Workspace {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  is_active: boolean;
  division_grid: DivisionGrid | null;
}

export interface WorkspaceMember {
  id: number;
  workspace_id: number;
  auth_user_id: number;
  role: "owner" | "admin" | "member";
  username?: string;
}

export interface WorkspaceMembership {
  workspace_id: number;
  slug: string;
  role: string;
  rbac_roles: string[];
  rbac_permissions: string[];
}
