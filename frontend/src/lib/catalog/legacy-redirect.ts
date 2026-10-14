/**
 * Links saved before the catalog migration carry old hero/map ids (D84). New ids start above every old one, so a
 * number that resolves through `GET /api/v1/catalog/legacy/{kind}/{id}` is an old id, and the page is redirected to
 * the entity it became. Removed with `catalog.entity_legacy` (`discipline02`).
 */

export type LegacyKind = "hero" | "map";
export type LegacyResolver = (kind: LegacyKind, id: string) => Promise<number | null>;

const PAGES: ReadonlyArray<{ path: RegExp; params: Readonly<Record<string, LegacyKind>> }> = [
  { path: /^\/users\/heroes-compare\/?$/, params: { hero_id: "hero" } },
  {
    path: /^\/users\/compare\/?$/,
    params: { left_hero_id: "hero", right_hero_id: "hero", map_id: "map" }
  },
  { path: /^\/tournaments\/[^/]+\/matches\/?$/, params: { map: "map" } }
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
  let moved = false;
  for (const [param, kind] of Object.entries(page.params)) {
    const value = search.get(param);
    if (!value || !/^\d+$/.test(value)) continue;
    const entityId = await resolve(kind, value);
    if (entityId !== null && String(entityId) !== value) {
      next.set(param, String(entityId));
      moved = true;
    }
  }
  return moved ? `?${next.toString()}` : null;
}
