export interface DivisionTier {
  id?: number;
  slug?: string;
  number: number;
  name: string;
  rank_min: number;
  rank_max: number | null;
  sort_order?: number;
  icon_url: string;
}

export interface DivisionGrid {
  tiers: DivisionTier[];
}

export interface DivisionGridVersion {
  id: number;
  grid_id: number;
  version: number;
  label: string;
  status: "draft" | "published" | "archived" | string;
  created_from_version_id: number | null;
  published_at: string | null;
  tiers: DivisionTier[];
}

export interface DivisionGridEntity {
  id: number;
  workspace_id: number | null;
  slug: string;
  name: string;
  description: string | null;
  versions: DivisionGridVersion[];
}

export interface DivisionGridMappingRule {
  id?: number;
  mapping_id?: number;
  source_tier_id: number;
  target_tier_id: number;
  weight: number;
  is_primary: boolean;
}

export interface Workspace {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  is_active: boolean;
  default_division_grid_version_id: number | null;
  default_division_grid_version: DivisionGridVersion | null;
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
