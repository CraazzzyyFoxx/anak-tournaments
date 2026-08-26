import { apiFetch } from "@/lib/api-fetch";
import type { RosterShape, RosterSlotMap } from "@/lib/roster-shape";

/** Where an effective rank came from, strongest first. */
export type RankSource = "author" | "workspace" | "ow";

export const RANK_SOURCE_LABELS: Record<RankSource, string> = {
  author: "Mine",
  workspace: "Workspace",
  ow: "Overwatch",
};

/**
 * One row of a mix lineup, self-describing so the lineup never has to guess a
 * name from a separately paginated pool query.
 *
 * `is_active` is the bench switch: a benched row keeps its role order but is
 * skipped when the mix is balanced. `roles` is the ordered role list — position
 * is the balancer's role priority, and `null` means "every role this player has
 * a rank for". `must_play` guarantees this player a seat when the active
 * lineup does not divide evenly into full teams: the balancer trims the
 * leftover from the un-flagged players first.
 *
 * Ranks come from three layers and the row carries enough to tell them apart:
 * `ranks` is what balance will actually use, `rank_sources` says which layer won
 * (this host's own book > the workspace canon > Overwatch), and `author_ranks`
 * is this host's book alone so the sheet can edit it without mistaking an
 * inherited value for their own. There is deliberately no per-mix pin: a rank
 * that only existed inside one mix was invisible everywhere else it mattered.
 */
export type CustomGamePlayer = {
  id: number;
  workspace_member_id: number;
  display_name: string | null;
  battle_tag: string | null;
  team_index: number | null;
  sort_order: number;
  is_active: boolean;
  must_play: boolean;
  roles: string[] | null;
  ranks: Record<string, number>;
  rank_sources: Record<string, RankSource>;
  author_ranks: Record<string, number>;
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
  host_display_name: string | null;
  name: string;
  status: CustomGameStatus | string;
  config_json: Record<string, unknown> | null;
  result_json: unknown;
  outcome_json: unknown;
  created_at: string | null;
  /**
   * The mix's resolved team composition -- own `config_json.role_mask`
   * override, else the workspace default, else the built-in Overwatch 5v5
   * shape. Optional only for older cached rows read before this field
   * shipped; every fresh response carries it.
   */
  roster_shape?: RosterShape | null;
  players?: CustomGamePlayer[];
};

/**
 * One match recorded by `recordOutcome`, as it comes back from the permanent
 * `casual.match` log rather than the mix's own mutable `outcome_json`. `winner`
 * is derived server-side from the scoreline, the same 1-based/`null` shape as
 * `CustomGameOutcome`.
 */
export type CustomGameMatch = {
  id: number;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
  winner: number | null;
  map_id: number | null;
  map_name: string | null;
  recorded_by: number | null;
  recorded_at: string | null;
};

/** Patch semantics: an omitted key is left untouched on the server. */
export type CustomGamePlayerPatch = {
  is_active?: boolean;
  roles?: string[] | null;
  must_play?: boolean;
};

export const customGameKeys = {
  /** Every mix query for a workspace — `list` is a prefix of `one`/`matches`, so this covers all three. */
  all: (workspaceId: number) => ["custom-games", workspaceId] as const,
  list: (workspaceId: number) => ["custom-games", workspaceId] as const,
  one: (workspaceId: number, gameId: number) => ["custom-games", workspaceId, gameId] as const,
  matches: (workspaceId: number, gameId: number) => ["custom-games", workspaceId, gameId, "matches"] as const,
};

export const customGameService = {
  list(workspaceId: number): Promise<CustomGame[]> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games`).then((r) => r.json());
  },

  /** Always starts empty: the lineup is built explicitly from the workspace roster. */
  create(workspaceId: number, name: string): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games`, {
      method: "POST",
      body: { name, member_ids: [] },
    }).then((r) => r.json());
  },

  get(workspaceId: number, gameId: number): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}`).then((r) => r.json());
  },

  updateRoster(workspaceId: number, gameId: number, memberIds: number[]): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/roster`, {
      method: "POST",
      body: { member_ids: memberIds },
    }).then((r) => r.json());
  },

  updatePlayer(
    workspaceId: number,
    gameId: number,
    workspaceMemberId: number,
    patch: CustomGamePlayerPatch,
  ): Promise<CustomGame> {
    return apiFetch(
      `/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/players/${workspaceMemberId}`,
      { method: "PUT", body: patch },
    ).then((r) => r.json());
  },

  balance(workspaceId: number, gameId: number): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/balance`, {
      method: "POST",
    }).then((r) => r.json());
  },

  /**
   * Snapshots one played match into the permanent casual-match log — team
   * rosters and who won. Repeatable: a mix can record many before its host
   * calls `close`. `variantIndex` is whichever balance option is on screen;
   * `mapId` is optional -- the mix flow offers no map veto.
   */
  recordOutcome(
    workspaceId: number,
    gameId: number,
    outcome: CustomGameOutcome,
    variantIndex: number,
    mapId: number | null,
  ): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/outcome`, {
      method: "POST",
      body: { outcome_json: outcome, variant_index: variantIndex, map_id: mapId },
    }).then((r) => r.json());
  },

  /** Every match this mix has recorded, newest first. */
  listMatches(workspaceId: number, gameId: number): Promise<CustomGameMatch[]> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/matches`).then((r) => r.json());
  },

  /** Ends the mix. Matches already recorded stay recorded; this only stops further writes. */
  close(workspaceId: number, gameId: number): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/close`, {
      method: "POST",
    }).then((r) => r.json());
  },

  /**
   * Patch semantics: an index left out of ``teamNames`` keeps its current
   * name; an empty string clears that team's override back to the computed
   * default (``Team N``).
   */
  setTeamNames(workspaceId: number, gameId: number, teamNames: Record<string, string>): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/team-names`, {
      method: "PUT",
      body: { team_names: teamNames },
    }).then((r) => r.json());
  },

  /**
   * Patch the mix's own roster-shape override, or clear it (`null`) to inherit
   * the workspace default -- the same override/inherit split
   * `RosterShapeEditor` already offers for a tournament's `roster_slots_json`.
   */
  setRoleMask(workspaceId: number, gameId: number, roleMask: RosterSlotMap | null): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/role-mask`, {
      method: "PUT",
      body: { role_mask: roleMask },
    }).then((r) => r.json());
  },

  /**
   * The host's rank-adjustment-per-win knob: recording a win/loss then bumps
   * the winning team's author-book rank by this many points and the losing
   * team's down by the same, per player and role. `null`/`0` disables it.
   */
  setPointsPerWin(workspaceId: number, gameId: number, pointsPerWin: number | null): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/points-per-win`, {
      method: "PUT",
      body: { points_per_win: pointsPerWin },
    }).then((r) => r.json());
  },

  /**
   * Swap two seated players between teams, same role only -- a same-role swap
   * can never break a team's role quota, so it needs no eligibility check
   * beyond "both exist and share a role". `variantIndex` edits whichever
   * balance option is on screen, not always the first.
   */
  swapSeats(
    workspaceId: number,
    gameId: number,
    variantIndex: number,
    firstUuid: string,
    secondUuid: string,
  ): Promise<CustomGame> {
    return apiFetch(`/api/balancer/workspaces/${workspaceId}/custom-games/${gameId}/teams/swap`, {
      method: "POST",
      body: { variant_index: variantIndex, first_uuid: firstUuid, second_uuid: secondUuid },
    }).then((r) => r.json());
  },
};
