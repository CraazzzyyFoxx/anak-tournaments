import type { CatalogListFilters } from "@/types/catalog.types";

const SORTABLE = ["id", "name", "slug", "parent_id", "created_at", "updated_at"] as const;

/** A table column id the catalog list can sort by server-side, or `undefined` (page-only columns are unsortable). */
export function catalogSort(field: string | null): CatalogListFilters["sort"] {
  return SORTABLE.find((candidate) => candidate === field);
}
