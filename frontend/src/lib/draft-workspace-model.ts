import type { RosterShape } from "@/lib/roster-shape";
import type {
  DraftPick,
  DraftPickOption,
  DraftPickOptionsResponse,
  DraftPlayer,
  DraftRole
} from "@/types/draft.types";

export type DraftPoolRoleFilter = DraftRole | "all";
export type DraftPoolSort = "rank" | "name";
export type DraftMobileView = "pool" | "team" | "order";

export interface DraftViewParams {
  role: DraftPoolRoleFilter;
  sort: DraftPoolSort;
  view: DraftMobileView;
  query: string;
}

export function parseDraftViewParams(params: URLSearchParams): DraftViewParams {
  const roleValue = params.get("role");
  const sortValue = params.get("sort");
  const viewValue = params.get("view");
  return {
    role:
      roleValue === "tank" || roleValue === "dps" || roleValue === "support"
        ? roleValue
        : "all",
    sort: sortValue === "name" ? "name" : "rank",
    view: viewValue === "team" || viewValue === "order" ? viewValue : "pool",
    query: params.get("q")?.trim() ?? ""
  };
}

const ROLE_LABELS: Record<DraftRole, string[]> = {
  tank: ["tank"],
  dps: ["dps", "damage"],
  support: ["support", "sup", "heal"],
};

export function filterDraftPlayers(
  players: DraftPlayer[],
  filters: Pick<DraftViewParams, "role" | "sort" | "query">
): DraftPlayer[] {
  const query = filters.query.toLocaleLowerCase();
  return players
    .filter((player) => {
      const roles = new Set<DraftRole>([
        player.primary_role,
        ...((player.secondary_roles_json ?? []) as DraftRole[])
      ]);
      const haystack = [
        player.battle_tag ?? `#${player.id}`,
        player.sub_role ?? "",
        ...[player.primary_role, ...((player.secondary_roles_json ?? []) as DraftRole[])]
          .flatMap((r) => ROLE_LABELS[r] ?? [r]),
      ].join(" ").toLocaleLowerCase();
      return (filters.role === "all" || roles.has(filters.role)) && (!query || haystack.includes(query));
    })
    .sort((left, right) => {
      if (filters.sort === "name") {
        return (left.battle_tag ?? "").localeCompare(right.battle_tag ?? "");
      }
      return (right.effective_rank ?? -1) - (left.effective_rank ?? -1) || left.id - right.id;
    });
}

export function optionForSelection(
  response: DraftPickOptionsResponse | null,
  playerId: number,
  role: DraftRole
): DraftPickOption | null {
  return (
    response?.options.find((option) => option.player_id === playerId && option.role === role) ?? null
  );
}

export function playerRoles(player: DraftPlayer): DraftRole[] {
  return Array.from(
    new Set<DraftRole>([
      player.primary_role,
      ...((player.secondary_roles_json ?? []) as DraftRole[])
    ])
  );
}

export function buildRosterByTeam(players: DraftPlayer[]): Map<number, DraftPlayer[]> {
  const rosters = new Map<number, DraftPlayer[]>();
  for (const player of players) {
    if (player.drafted_by_team_id == null || player.status === "available") continue;
    const roster = rosters.get(player.drafted_by_team_id) ?? [];
    roster.push(player);
    rosters.set(player.drafted_by_team_id, roster);
  }
  return rosters;
}

export function normalizeTopHeroes(
  entries: DraftPlayer["role_top_heroes"][string] | undefined
): { slug: string; imagePath: string | null }[] {
  if (!entries) return [];
  return entries.map((e) =>
    typeof e === "string" ? { slug: e, imagePath: null } : { slug: e.slug, imagePath: e.image_path ?? null }
  );
}

export function roleTopHeroes(player: DraftPlayer, role: DraftRole) {
  return normalizeTopHeroes(player.role_top_heroes?.[role]);
}

/** Deduped hero list for a player across every role bucket in `role_top_heroes`. */
export function allPlayerHeroes(player: DraftPlayer): { slug: string; imagePath: string | null }[] {
  const seen = new Map<string, string | null>();
  for (const heroes of Object.values(player.role_top_heroes ?? {})) {
    for (const hero of normalizeTopHeroes(heroes)) {
      if (!seen.has(hero.slug)) seen.set(hero.slug, hero.imagePath);
    }
  }
  return [...seen].map(([slug, imagePath]) => ({ slug, imagePath }));
}

export interface DraftRoundGroup {
  round: number;
  picks: DraftPick[];
}

export function groupPicksByRound(picks: DraftPick[]): DraftRoundGroup[] {
  const byRound = new Map<number, DraftPick[]>();
  for (const pick of picks) {
    const list = byRound.get(pick.round_no) ?? [];
    list.push(pick);
    byRound.set(pick.round_no, list);
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, list]) => ({
      round,
      picks: [...list].sort((l, r) => l.pick_in_round - r.pick_in_round || l.overall_no - r.overall_no),
    }));
}

export function rosterRoleForPlayer(player: DraftPlayer, picks: DraftPick[]): DraftRole {
  const pick = picks.find((p) => p.picked_player_id === player.id && p.target_role != null);
  return (pick?.target_role as DraftRole | undefined) ?? player.primary_role;
}

/**
 * The rank that represents a player on their slot, mirroring the server's
 * `services.draft.ranks.slot_rank`. Role slots keep it role-specific; a
 * role-less (all-flex) roster assigns nobody a role, so the server's
 * shape-aware `effective_rank` — the player's best role rank — stands in. The
 * flex rule itself is never recomputed here.
 */
export function slotRankForPlayer(
  player: DraftPlayer,
  role: DraftRole,
  shape: Pick<RosterShape, "has_role_slots">
): number | null {
  if (!shape.has_role_slots) return player.effective_rank;
  return player.role_ranks?.[role] ?? player.rank_value ?? null;
}

/**
 * How many picks a team still has to wait before it is on the clock, or `null`
 * when it is already on the clock or has no pick left. Shared by the spectator
 * board and the captain command bar so both count the same way.
 */
export function picksUntilTeamTurn(picks: DraftPick[], teamId: number): number | null {
  const upcoming = picks
    .filter((pick) => pick.status === "upcoming" || pick.status === "on_clock")
    .sort((left, right) => left.overall_no - right.overall_no);
  const index = upcoming.findIndex((pick) => pick.draft_team_id === teamId);
  return index > 0 ? index : null;
}
