import type { CSSProperties } from "react";

/** A role's accent, derived from its ontology presentation color — never from a role name. */
export interface RoleAccent {
  /** Filled chip behind the role glyph / the selected segment. */
  tile: CSSProperties;
  /** Border and wash of a selected card. */
  selectedCard: CSSProperties;
}

/** A role (or the open slot) with no declared color reads as a neutral accent rather than another role's hue. */
const NEUTRAL = "var(--aqt-fg-muted)";

export function roleAccent(color: string | null | undefined): RoleAccent {
  const base = color ?? NEUTRAL;
  return {
    tile: { backgroundColor: `color-mix(in srgb, ${base} 18%, transparent)`, color: base },
    selectedCard: {
      borderColor: `color-mix(in srgb, ${base} 75%, transparent)`,
      backgroundColor: `color-mix(in srgb, ${base} 10%, transparent)`,
    },
  };
}
