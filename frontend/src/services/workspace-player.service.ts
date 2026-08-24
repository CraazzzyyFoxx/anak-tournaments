import { apiFetch } from "@/lib/api-fetch";

export const WORKSPACE_PLAYER_ROLES = ["tank", "dps", "support"] as const;

export type WorkspacePlayerRole = (typeof WORKSPACE_PLAYER_ROLES)[number];

export type WorkspacePlayer = {
  id: number;
  workspace_id: number;
  battle_tag: string | null;
  display_name: string | null;
  player_id: number | null;
  ranks: Record<string, number>;
};

export const workspacePlayerKeys = {
  list: (workspaceId: number) => ["workspace-players", workspaceId] as const,
};

export function parseRoleRanks(input: Record<string, string>): Record<string, number> {
  const ranks: Record<string, number> = {};
  for (const role of WORKSPACE_PLAYER_ROLES) {
    const raw = input[role]?.trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      throw new Error(`${role} rank must be an integer`);
    }
    ranks[role] = value;
  }
  return ranks;
}

export const workspacePlayerService = {
  list(workspaceId: number): Promise<WorkspacePlayer[]> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/players`).then((r) => r.json());
  },

  upsert(workspaceId: number, battleTag: string, displayName?: string): Promise<WorkspacePlayer> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/players`, {
      method: "POST",
      body: { battle_tag: battleTag, display_name: displayName || undefined },
    }).then((r) => r.json());
  },

  setRanks(workspaceId: number, playerId: number, ranks: Record<string, number>): Promise<Record<string, number>> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/players/${playerId}/ranks`, {
      method: "PUT",
      body: { ranks },
    }).then((r) => r.json());
  },

  setHostRanks(
    workspaceId: number,
    playerId: number,
    ranks: Record<string, number>,
  ): Promise<Record<string, number>> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/hosts/${playerId}/ranks`, {
      method: "PUT",
      body: { ranks },
    }).then((r) => r.json());
  },
};
