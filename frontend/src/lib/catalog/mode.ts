import type { CatalogEntityRead } from "@/types/catalog.types";

type Named = Pick<CatalogEntityRead, "id" | "name">;
type MapRef = Pick<CatalogEntityRead, "name" | "parent_id">;

/**
 * A match's mode where its map does not already say it. A map filed under one mode (every Overwatch map) names it, so
 * the match's mode adds nothing there; a map several modes share (Deadlock's Midtown hosts the 6v6 game and Street
 * Brawl) has no parent, and only the match knows which one was played.
 */
export function modeBeyondMap<M extends Named>(
  map: Pick<CatalogEntityRead, "parent_id"> | null | undefined,
  mode: M | null | undefined
): M | null {
  return mode != null && mode.id !== map?.parent_id ? mode : null;
}

/** "Midtown · Street Brawl"; just the map's name where the map already says its mode; null without a map. */
export function mapWithModeName(map: MapRef, mode: Named | null | undefined): string;
export function mapWithModeName(map: MapRef | null | undefined, mode: Named | null | undefined): string | null;
export function mapWithModeName(map: MapRef | null | undefined, mode: Named | null | undefined): string | null {
  if (map == null) return null;
  const extra = modeBeyondMap(map, mode);
  return extra == null ? map.name : `${map.name} · ${extra.name}`;
}
