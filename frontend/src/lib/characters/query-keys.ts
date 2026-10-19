import type { KeyPart } from "@/lib/query-keys";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

/**
 * One game's character statistic reads (§4.3): `["character-stats", axis, discipline, …]`. The discipline sits at a
 * fixed position so a catalog sync of that game drops them (`invalidateCatalogSync`). The catalog itself is keyed by
 * `catalogQueryKeys`.
 */
export const characterStatsQueryKeys = {
  playtime: (axis: WorkspaceAxis, discipline: string, filters: { userId: KeyPart; tournamentId: KeyPart; perPage: KeyPart }) =>
    ["character-stats", axis, discipline, "playtime", filters] as const,
  leaderboard: (axis: WorkspaceAxis, discipline: string, entityId: KeyPart, filters: { stat: KeyPart; tournamentId: KeyPart }) =>
    ["character-stats", axis, discipline, "leaderboard", entityId, filters] as const
};
