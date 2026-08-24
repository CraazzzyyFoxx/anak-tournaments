import { apiFetch } from "@/lib/api-fetch";

/**
 * One row of a mix lineup, self-describing so the lineup never has to guess a
 * name from a separately paginated pool query.
 *
 * `is_active` is the bench switch: a benched row keeps its rank override and
 * role order but is skipped when the mix is balanced. `roles` is the ordered
 * role list — position is the balancer's role priority, and `null` means
 * "every role this player has a rank for". `ranks` is what balance will
 * actually use per role (override > host book > canon > Overwatch).
 */
export type CustomGamePlayer = {
  id: number;
  workspace_player_id: number;
  display_name: string | null;
  battle_tag: string | null;
  rank_value: number | null;
  team_index: number | null;
  sort_order: number;
  is_active: boolean;
  roles: string[] | null;
  ranks: Record<string, number>;
};

export type CustomGameStatus = "draft" | "balanced" | "completed" | "cancelled";

export type CustomGame = {
  id: number;
  workspace_id: number;
  host_user_id: number;
  name: string;
  status: CustomGameStatus | string;
  config_json: Record<string, unknown> | null;
  result_json: unknown;
  players?: CustomGamePlayer[];
};

/** Patch semantics: an omitted key is left untouched on the server. */
export type CustomGamePlayerPatch = {
  rank_value?: number | null;
  is_active?: boolean;
  roles?: string[] | null;
};

export const customGameKeys = {
  list: (workspaceId: number) => ["custom-games", workspaceId] as const,
  one: (workspaceId: number, gameId: number) => ["custom-games", workspaceId, gameId] as const,
};

export const customGameService = {
  list(workspaceId: number): Promise<CustomGame[]> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games`).then((r) => r.json());
  },

  /** Always starts empty: the lineup is built explicitly from the player pool. */
  create(workspaceId: number, name: string): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games`, {
      method: "POST",
      body: { name, player_ids: [] },
    }).then((r) => r.json());
  },

  get(workspaceId: number, gameId: number): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}`).then((r) => r.json());
  },

  updateRoster(workspaceId: number, gameId: number, playerIds: number[]): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/roster`, {
      method: "POST",
      body: { player_ids: playerIds },
    }).then((r) => r.json());
  },

  updatePlayer(
    workspaceId: number,
    gameId: number,
    workspacePlayerId: number,
    patch: CustomGamePlayerPatch,
  ): Promise<CustomGame> {
    return apiFetch(
      `/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/players/${workspacePlayerId}`,
      { method: "PUT", body: patch },
    ).then((r) => r.json());
  },

  balance(workspaceId: number, gameId: number): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/balance`, {
      method: "POST",
    }).then((r) => r.json());
  },
};
