import { apiFetch } from "@/lib/api-fetch";

/** Where an effective rank came from, strongest first. */
export type RankSource = "override" | "host" | "canon" | "ow";

export const RANK_SOURCE_LABELS: Record<RankSource, string> = {
  override: "This mix",
  host: "Mine",
  canon: "Workspace",
  ow: "Overwatch",
};

/**
 * One row of a mix lineup, self-describing so the lineup never has to guess a
 * name from a separately paginated pool query.
 *
 * `is_active` is the bench switch: a benched row keeps its rank override and
 * role order but is skipped when the mix is balanced. `roles` is the ordered
 * role list — position is the balancer's role priority, and `null` means
 * "every role this player has a rank for".
 *
 * Ranks come from three dictionaries and one snapshot, and the row carries
 * enough to tell them apart: `ranks` is what balance will actually use,
 * `rank_sources` says which layer won (`rank_value` here > this host's book >
 * the workspace canon > Overwatch), and `host_ranks` is this host's own book so
 * the sheet can edit it without confusing it with an inherited value.
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
  rank_sources: Record<string, RankSource>;
  host_ranks: Record<string, number>;
};

export type CustomGameStatus = "draft" | "balanced" | "completed" | "cancelled";

/**
 * How a mix ended. `winner` is a 1-based team number, `null` a draw — the same
 * free-form dict `record_outcome` stores, narrowed to the only shape this app
 * writes so a reader never has to guess between `winner: 0` and "no winner".
 */
export type CustomGameOutcome = {
  winner: number | null;
};

export type CustomGame = {
  id: number;
  workspace_id: number;
  host_user_id: number;
  name: string;
  status: CustomGameStatus | string;
  config_json: Record<string, unknown> | null;
  result_json: unknown;
  outcome_json: unknown;
  players?: CustomGamePlayer[];
};

/** Patch semantics: an omitted key is left untouched on the server. */
export type CustomGamePlayerPatch = {
  rank_value?: number | null;
  is_active?: boolean;
  roles?: string[] | null;
};

export const customGameKeys = {
  /** Every mix query for a workspace — `list` is a prefix of `one`, so this covers both. */
  all: (workspaceId: number) => ["custom-games", workspaceId] as const,
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

  /** Terminal: the server flips the mix to `completed` and stops accepting writes. */
  recordOutcome(workspaceId: number, gameId: number, outcome: CustomGameOutcome): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/outcome`, {
      method: "POST",
      body: { outcome_json: outcome },
    }).then((r) => r.json());
  },
};
