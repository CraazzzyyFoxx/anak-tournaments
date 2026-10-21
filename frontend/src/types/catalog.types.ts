import type { Schema } from "@/types/api";
import type { CatalogKind } from "@/types/discipline.types";

export type { CatalogKind };

/**
 * One `catalog.entity` row of any discipline and kind: the single catalog wire for public reads, admin CRUD and
 * every relationship embedded in other payloads. `parent` is the same shape, one level deep (a map's mode).
 * `attrs` carries kind-specific display metadata (`class`, `color`, `in_competitive`, …) and never confers a role.
 */
export type CatalogEntityRead = Omit<Schema<"app.CatalogEntityRead">, "kind" | "parent"> & {
  /** The generated enum, as the literal union every caller already spells. */
  kind: CatalogKind;
  parent: CatalogEntityRead | null;
};

/** What a portrait or chip needs of an entity — also what a stand-in for a name the catalog does not know carries. */
export type CatalogEntityChip = Pick<CatalogEntityRead, "name" | "slug" | "image_path" | "attrs">;

export interface CatalogEntityWrite {
  name?: string;
  slug?: string;
  image_path?: string | null;
  parent_id?: number | null;
  attrs?: Record<string, unknown>;
  aliases?: string[];
  active?: boolean;
}

/** What a catalog list can be narrowed by; every value ends up in the query key. */
export interface CatalogListFilters {
  page?: number;
  per_page?: number;
  sort?: "id" | "name" | "slug" | "parent_id" | "created_at" | "updated_at";
  order?: "asc" | "desc";
  search?: string;
  parent_id?: number;
  /** Rows whose `attrs` contain this object (`{ class: "tank" }`, `{ in_competitive: false }`). */
  attrs?: Record<string, unknown>;
  /** The public list defaults to active rows; `false` asks for the retired ones. */
  active?: boolean;
}

/**
 * One stage of a catalog sync: `source` (the module fetching its whole source), then each kind the game declares
 * in sync order (`mode`, `map`, `character`).
 */
export interface CatalogSyncStage {
  key: "source" | CatalogKind;
  state: "pending" | "running" | "done" | "failed";
  /** Images mirrored so far, out of `total` that actually needed downloading (`0` is valid: nothing to fetch). */
  done: number | null;
  total: number | null;
  /** Rows the kind added, set when it commits. */
  created: number | null;
}

/**
 * The whole sync snapshot of one discipline: the `POST`/`GET /admin/catalog-sync/{discipline}` body and the data of
 * every `catalog_sync.progress` event, always replaced wholesale.
 */
export interface CatalogSyncState {
  discipline: string;
  status: "running" | "done" | "failed";
  /** The module's source by name ("OverFast"); null until the sync reports it. */
  source: string | null;
  /** Auth user id of whoever started it. */
  started_by: number;
  started_at: string;
  updated_at: string;
  /** Set when failed: `catalog_source_unavailable`, a module refusal (`catalog_conflict`, …), `interrupted` or
   *  `internal_error`. */
  error: { code: string; msg: string } | null;
  stages: CatalogSyncStage[];
}
