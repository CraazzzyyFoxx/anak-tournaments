import { apiFetch } from "@/lib/api-fetch";
import { DivisionGrid, Workspace, WorkspaceMember } from "@/types/workspace.types";

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

  static async getDivisionGrid(workspaceId: number, tournamentId?: number): Promise<DivisionGrid> {
    const params = tournamentId ? `?tournament_id=${tournamentId}` : "";
    return apiFetch("app", `workspaces/${workspaceId}/division-grid${params}`).then((r) => r.json());
  }

  static async updateDivisionGrid(workspaceId: number, grid: DivisionGrid | null): Promise<Workspace> {
    return apiFetch("app", `workspaces/${workspaceId}`, {
      method: "PATCH",
      body: { division_grid_json: grid },
    }).then((r) => r.json());
  }

  static async update(
    id: number,
    data: { name?: string; description?: string; icon_url?: string | null; is_active?: boolean }
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
}
