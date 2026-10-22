import { queryOptions } from "@tanstack/react-query";

import { catalogQueryKeys } from "@/lib/catalog/query-keys";
import catalogService from "@/services/catalog.service";
import type { CatalogKind, CatalogListFilters } from "@/types/catalog.types";

/**
 * Reference data, edited a few times a year (an alias, a sync): five minutes of staleness costs nothing and saves
 * a request on every pregame room, registration form and compare page mount.
 */
const CATALOG_STALE_MS = 5 * 60 * 1000;

/** Every row of a kind, name-sorted: the shape a picker or an id→entity map wants. */
export const WHOLE_CATALOG: CatalogListFilters = { per_page: -1, sort: "name", order: "asc" };

/**
 * One discipline's catalog read, cached once for the app. Extracted from the hooks so a route can prefetch it on the
 * server under the same key the hook then reads.
 */
export function catalogListQueryOptions(
  discipline: string,
  kind: CatalogKind,
  filters: CatalogListFilters = WHOLE_CATALOG
) {
  return queryOptions({
    queryKey: catalogQueryKeys.list({ discipline }, kind, filters),
    queryFn: ({ signal }) => catalogService.list(discipline, kind, filters, { signal }),
    staleTime: CATALOG_STALE_MS
  });
}

export function catalogDetailQueryOptions(discipline: string, kind: CatalogKind, id: number) {
  return queryOptions({
    queryKey: catalogQueryKeys.detail({ discipline }, kind, id),
    queryFn: ({ signal }) => catalogService.get(discipline, kind, id, { signal }),
    staleTime: CATALOG_STALE_MS
  });
}
