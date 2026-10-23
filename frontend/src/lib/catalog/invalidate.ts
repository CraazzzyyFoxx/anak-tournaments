import type { QueryClient } from "@tanstack/react-query";

import { catalogQueryKeys } from "@/lib/catalog/query-keys";

/**
 * A catalog sync adds rows, aliases and images for the whole discipline: drop every cached catalog read of that
 * game (public and admin, all three kinds) and the character/map statistic families that embed catalog rows. Other
 * games' caches are untouched.
 *
 * The statistic families carry the discipline at a fixed position (`["character-stats", axis, discipline, …]`,
 * `["user-stats", userId, axis, discipline, …]`, §4.3), so they are matched by predicate, not by prefix.
 */
export function invalidateCatalogSync(client: QueryClient, discipline: string): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: catalogQueryKeys.discipline(discipline) }),
    client.invalidateQueries({
      predicate: ({ queryKey }) =>
        (queryKey[0] === "character-stats" && queryKey[2] === discipline) ||
        (queryKey[0] === "user-stats" && queryKey[3] === discipline)
    })
  ]);
}
