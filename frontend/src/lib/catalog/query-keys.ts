import type { CatalogKind, CatalogListFilters } from "@/types/catalog.types";

/**
 * The catalog is global per discipline: no workspace axis, and no key without a concrete discipline, so one game's
 * rows can never answer another game's picker.
 */
export type CatalogScope = { discipline: string };

export const catalogQueryKeys = {
  /** Root of everything one discipline's catalog caches (public and admin); a sync invalidates it. */
  discipline: (discipline: string) => ["catalog", discipline] as const,
  /** Every cached read of one kind — what a create, edit, alias attach or active toggle invalidates. */
  kind: (scope: CatalogScope, kind: CatalogKind) => ["catalog", scope.discipline, kind] as const,
  list: (scope: CatalogScope, kind: CatalogKind, filters: CatalogListFilters) =>
    ["catalog", scope.discipline, kind, "list", filters] as const,
  detail: (scope: CatalogScope, kind: CatalogKind, id: number) =>
    ["catalog", scope.discipline, kind, "detail", id] as const,
  adminList: (scope: CatalogScope, kind: CatalogKind, filters: CatalogListFilters) =>
    ["catalog", scope.discipline, kind, "admin", filters] as const,
  /** The discipline's sync snapshot: outside the `["catalog", discipline]` root, so the refresh a finished sync
   *  triggers does not refetch the snapshot that triggered it. */
  syncState: (discipline: string) => ["catalog-sync", discipline] as const
};
