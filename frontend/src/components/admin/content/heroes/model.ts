import type { CatalogEntityRead, CatalogEntityWrite } from "@/types/catalog.types";

/**
 * Neutral blue: the form default, the color-picker fallback and the hex hint.
 *
 * Exempt from the design-token rule: `color` is a persisted character attribute the
 * admin edits, so this literal is the initial *value* of a data field and is
 * also what `<input type="color">` requires — not chrome this page paints with.
 */
export const DEFAULT_COLOR = "#3b82f6";

export interface CharacterForm {
  name: string;
  /** The module's character class (`attrs.class`); empty when the game declares none. */
  class: string;
  color: string;
  image_path: string;
  aliases: string[];
  active: boolean;
}

// Key order matters: `hasUnsavedChanges` compares JSON, so `getCharacterForm` below
// must list the same fields in the same order or every dialog opens dirty.
export const emptyForm = (classes: readonly string[]): CharacterForm => ({
  name: "",
  class: classes[0] ?? "",
  color: DEFAULT_COLOR,
  image_path: "",
  aliases: [],
  active: true,
});

export function getCharacterForm(classes: readonly string[], entity: CatalogEntityRead | null): CharacterForm {
  if (!entity) return emptyForm(classes);
  return {
    name: entity.name,
    class: typeof entity.attrs.class === "string" ? entity.attrs.class : (classes[0] ?? ""),
    color: typeof entity.attrs.color === "string" ? entity.attrs.color : DEFAULT_COLOR,
    image_path: entity.image_path ?? "",
    aliases: entity.aliases ?? [],
    active: entity.active,
  };
}

/** Attrs merge on update: send only what this game's character form owns. */
export function toWrite(classes: readonly string[], form: CharacterForm): CatalogEntityWrite {
  return {
    name: form.name,
    image_path: form.image_path || null,
    aliases: form.aliases,
    active: form.active,
    attrs: { ...(classes.length > 0 && { class: form.class }), color: form.color },
  };
}
