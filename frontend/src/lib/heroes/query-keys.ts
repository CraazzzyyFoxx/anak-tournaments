import type { KeyPart } from "@/lib/query-keys";

/**
 * Hero statistic keys. The hero catalog itself is a native catalog read keyed by `catalogQueryKeys`.
 */
export const heroQueryKeys = {
  leaderboard: (heroId: KeyPart, tournamentId: KeyPart, scope: KeyPart) =>
    ["hero-leaderboard", heroId, tournamentId, scope] as const,
};
