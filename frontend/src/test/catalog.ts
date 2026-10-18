import type { CatalogEntityRead, CatalogKind } from "@/types/catalog.types";

/** A catalog row as the public/admin catalog reads return it; override only what the test is about. */
export function catalogEntity(overrides: Partial<CatalogEntityRead> & { id: number }): CatalogEntityRead {
  return {
    created_at: "1970-01-01T00:00:00Z",
    updated_at: null,
    discipline: "overwatch",
    kind: "character",
    slug: `entity-${overrides.id}`,
    name: `Entity ${overrides.id}`,
    image_path: null,
    parent_id: null,
    attrs: {},
    aliases: [],
    active: true,
    parent: null,
    ...overrides
  };
}

/** A map row whose mode is its `parent`, the shape every map consumer reads. */
export function catalogMap(
  id: number,
  mode: CatalogEntityRead,
  overrides: Partial<CatalogEntityRead> = {}
): CatalogEntityRead {
  return catalogEntity({
    id,
    kind: "map" satisfies CatalogKind,
    discipline: mode.discipline,
    name: `Map ${id}`,
    parent_id: mode.id,
    parent: mode,
    attrs: { in_competitive: true },
    ...overrides
  });
}

export function catalogMode(id: number, name: string, discipline = "overwatch"): CatalogEntityRead {
  return catalogEntity({ id, kind: "mode", discipline, name, slug: name.toLowerCase() });
}
