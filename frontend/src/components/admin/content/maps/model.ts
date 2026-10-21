import type { CatalogEntityRead, CatalogEntityWrite } from "@/types/catalog.types";

export interface MapForm {
  name: string;
  /** The map's mode (`parent_id`); only a game that declares `mode` has one. */
  parent_id: number;
  in_competitive: boolean;
  image_path: string;
  aliases: string[];
  active: boolean;
}

// Key order matters: `hasUnsavedChanges` compares JSON, so `getMapForm` below
// must list the same fields in the same order or every dialog opens dirty.
export const EMPTY_FORM: MapForm = { name: "", parent_id: 0, in_competitive: true, image_path: "", aliases: [], active: true };

export function getMapForm(entity: CatalogEntityRead | null): MapForm {
  if (!entity) return { ...EMPTY_FORM };
  return {
    name: entity.name,
    parent_id: entity.parent_id ?? 0,
    in_competitive: entity.attrs.in_competitive !== false,
    image_path: entity.image_path ?? "",
    aliases: entity.aliases ?? [],
    active: entity.active,
  };
}

/** A game without modes has no parent and no competitive pool: send only what its maps carry. */
export function toWrite(hasModes: boolean, form: MapForm): CatalogEntityWrite {
  return {
    name: form.name,
    image_path: form.image_path || null,
    aliases: form.aliases,
    active: form.active,
    ...(hasModes && { parent_id: form.parent_id, attrs: { in_competitive: form.in_competitive } }),
  };
}
