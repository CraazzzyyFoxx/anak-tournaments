import { apiFetch } from "@/lib/api-fetch";
import {
  DivisionGridEntity,
  DivisionGridMappingRule,
  DivisionGridVersion,
  Workspace,
  WorkspaceMember,
} from "@/types/workspace.types";

export default class workspaceService {
  static async getAll(): Promise<Workspace[]> {
    return apiFetch("app","workspaces").then((r) => r.json());
  }

  static async getById(id: number): Promise<Workspace> {
    return apiFetch("app",`workspaces/${id}`).then((r) => r.json());
  }

  static async create(data: {
    slug: string;
    name: string;
    description?: string;
    icon_url?: string;
  }): Promise<Workspace> {
    return apiFetch("app","workspaces", {
      method: "POST",
      body: data,
    }).then((r) => r.json());
  }

  static async update(
    id: number,
    data: {
      name?: string;
      description?: string;
      icon_url?: string | null;
      is_active?: boolean;
      default_division_grid_version_id?: number | null;
    }
  ): Promise<Workspace> {
    return apiFetch("app",`workspaces/${id}`, {
      method: "PATCH",
      body: data,
    }).then((r) => r.json());
  }

  static async getMembers(workspaceId: number): Promise<WorkspaceMember[]> {
    return apiFetch("app",`workspaces/${workspaceId}/members`).then((r) =>
      r.json()
    );
  }

  static async addMember(
    workspaceId: number,
    authUserId: number,
    role: string = "member"
  ): Promise<WorkspaceMember> {
    return apiFetch("app",`workspaces/${workspaceId}/members`, {
      method: "POST",
      body: { auth_user_id: authUserId, role },
    }).then((r) => r.json());
  }

  static async updateMemberRole(
    workspaceId: number,
    authUserId: number,
    role: string
  ): Promise<WorkspaceMember> {
    return apiFetch("app",`workspaces/${workspaceId}/members/${authUserId}`, {
      method: "PATCH",
      body: { role },
    }).then((r) => r.json());
  }

  static async removeMember(
    workspaceId: number,
    authUserId: number
  ): Promise<void> {
    await apiFetch("app",`workspaces/${workspaceId}/members/${authUserId}`, {
      method: "DELETE",
    });
  }

  static async uploadIcon(workspaceId: number, file: File): Promise<Workspace> {
    const formData = new FormData();
    formData.append("file", file);
    return apiFetch("app", `workspaces/${workspaceId}/icon`, {
      method: "POST",
      body: formData,
    }).then((r) => r.json());
  }

  static async deleteIcon(workspaceId: number): Promise<Workspace> {
    return apiFetch("app", `workspaces/${workspaceId}/icon`, {
      method: "DELETE",
    }).then((r) => r.json());
  }

  static async getDivisionGrids(workspaceId: number): Promise<DivisionGridEntity[]> {
    return apiFetch("app", `workspaces/${workspaceId}/division-grids`).then((r) => r.json());
  }

  static async createDivisionGrid(
    workspaceId: number,
    data: { slug: string; name: string; description?: string | null }
  ): Promise<DivisionGridEntity> {
    return apiFetch("app", `workspaces/${workspaceId}/division-grids`, {
      method: "POST",
      body: data,
    }).then((r) => r.json());
  }

  static async getDivisionGridVersions(workspaceId: number, gridId: number): Promise<DivisionGridVersion[]> {
    return apiFetch("app", `workspaces/${workspaceId}/division-grids/${gridId}/versions`).then((r) => r.json());
  }

  static async createDivisionGridVersion(
    workspaceId: number,
    gridId: number,
    data: {
      label: string;
      tiers: Array<{
        slug: string;
        number: number;
        name: string;
        sort_order: number;
        rank_min: number;
        rank_max: number | null;
        icon_url: string;
      }>;
    }
  ): Promise<DivisionGridVersion> {
    return apiFetch("app", `workspaces/${workspaceId}/division-grids/${gridId}/versions`, {
      method: "POST",
      body: data,
    }).then((r) => r.json());
  }

  static async publishDivisionGridVersion(versionId: number): Promise<DivisionGridVersion> {
    return apiFetch("app", `division-grid-versions/${versionId}/publish`, {
      method: "POST",
      body: {},
    }).then((r) => r.json());
  }

  static async cloneDivisionGridVersion(versionId: number): Promise<DivisionGridVersion> {
    return apiFetch("app", `division-grid-versions/${versionId}/clone`, {
      method: "POST",
      body: {},
    }).then((r) => r.json());
  }

  static async uploadDivisionIcon(
    slug: string,
    file: File,
    workspaceId: number
  ): Promise<{ key: string; public_url: string }> {
    const formData = new FormData();
    formData.append("file", file);
    return apiFetch("app", `admin/assets/divisions/${slug}`, {
      method: "POST",
      body: formData,
      query: { workspace_id: workspaceId },
    }).then((r) => r.json());
  }

  static async getDivisionGridMapping(
    sourceVersionId: number,
    targetVersionId: number
  ): Promise<{
    id: number;
    source_version_id: number;
    target_version_id: number;
    name: string;
    is_complete: boolean;
    rules: DivisionGridMappingRule[];
  }> {
    return apiFetch("app", `division-grid-mappings/${sourceVersionId}/${targetVersionId}`).then((r) => r.json());
  }

  static async putDivisionGridMapping(
    sourceVersionId: number,
    targetVersionId: number,
    data: { name: string; rules: DivisionGridMappingRule[] }
  ): Promise<{
    id: number;
    source_version_id: number;
    target_version_id: number;
    name: string;
    is_complete: boolean;
    rules: DivisionGridMappingRule[];
  }> {
    return apiFetch("app", `division-grid-mappings/${sourceVersionId}/${targetVersionId}`, {
      method: "PUT",
      body: data,
    }).then((r) => r.json());
  }
}
