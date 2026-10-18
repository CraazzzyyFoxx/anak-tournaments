import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { catalogDetailQueryOptions, catalogListQueryOptions, WHOLE_CATALOG } from "@/lib/catalog/query-options";
import type { CatalogEntityRead, CatalogKind, CatalogListFilters } from "@/types/catalog.types";
import type { PaginatedResponse } from "@/types/pagination.types";

/** Module-level so the observer's select identity is stable across renders. */
const toResults = (page: PaginatedResponse<CatalogEntityRead>): CatalogEntityRead[] => page.results;

/** The discipline is the caller's explicit scope: while it is unknown (`null`) nothing is requested. */
type DisciplineScope = string | null | undefined;

/**
 * One kind of one discipline's catalog, name-sorted by default and cached once per `(discipline, kind, filters)`. A
 * caller that needs another order sorts the returned array. No previous-game placeholder: another discipline's rows
 * never stand in while this one loads. Filtering (retired rows, off-rotation maps) belongs at the call site unless it
 * is passed as `filters`, which join the key.
 */
export function useCatalogEntities(
  discipline: DisciplineScope,
  kind: CatalogKind,
  { enabled = true, filters = WHOLE_CATALOG }: { enabled?: boolean; filters?: CatalogListFilters } = {}
): UseQueryResult<CatalogEntityRead[]> {
  return useQuery({
    ...catalogListQueryOptions(discipline ?? "", kind, filters),
    select: toResults,
    enabled: enabled && Boolean(discipline)
  });
}

export function useCatalogEntity(
  discipline: DisciplineScope,
  kind: CatalogKind,
  id: number | null | undefined,
  { enabled = true }: { enabled?: boolean } = {}
): UseQueryResult<CatalogEntityRead> {
  return useQuery({
    ...catalogDetailQueryOptions(discipline ?? "", kind, id ?? 0),
    enabled: enabled && Boolean(discipline) && id != null
  });
}
