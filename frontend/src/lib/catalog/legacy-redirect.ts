/**
 * Links saved before the catalog migration carry old hero/map ids (D84). New ids start above every old one, so a
 * number that resolves through `GET /api/v1/catalog/legacy/{kind}/{id}` is an old id, and the page is redirected to
 * the entity it became. The resolver also names the entity's discipline: on the two compare pages (concrete browsing
 * surfaces) that discipline is added to the URL so the moved ids open in their own game. Removed with
 * `catalog.entity_legacy` (`discipline02`).
 */

import type { CatalogKind } from "@/types/catalog.types";

export type LegacyKind = "hero" | "map";
export type LegacyResolution = { entityId: number; discipline: string; kind: CatalogKind };
export type LegacyResolver = (kind: LegacyKind, id: string) => Promise<LegacyResolution | null>;

/** `browsing`: a concrete-browsing page that reads `?discipline=`; the tournament matches page is an owner surface. */
const PAGES: ReadonlyArray<{ path: RegExp; params: Readonly<Record<string, LegacyKind>>; browsing: boolean }> = [
  { path: /^\/users\/heroes-compare\/?$/, params: { hero_id: "hero" }, browsing: true },
  {
    path: /^\/users\/compare\/?$/,
    params: { left_hero_id: "hero", right_hero_id: "hero", map_id: "map" },
    browsing: true
  },
  { path: /^\/tournaments\/[^/]+\/matches\/?$/, params: { map: "map" }, browsing: false }
];

/** The query string to redirect to, or `null` when nothing in it is an old id. */
export async function legacyCatalogSearch(
  pathname: string,
  search: URLSearchParams,
  resolve: LegacyResolver
): Promise<string | null> {
  const page = PAGES.find(({ path }) => path.test(pathname));
  if (!page) return null;
  const next = new URLSearchParams(search);
  let discipline: string | null = null;
  for (const [param, kind] of Object.entries(page.params)) {
    const value = search.get(param);
    if (!value || !/^\d+$/.test(value)) continue;
    const resolution = await resolve(kind, value);
    if (resolution !== null && String(resolution.entityId) !== value) {
      next.set(param, String(resolution.entityId));
      discipline ??= resolution.discipline;
    }
  }
  if (discipline === null) return null;
  // An explicit `discipline` (even a different one) stays as typed: the page then names the mismatch instead of
  // relabelling a foreign entity.
  if (page.browsing && !search.has("discipline")) next.set("discipline", discipline);
  return `?${next.toString()}`;
}
