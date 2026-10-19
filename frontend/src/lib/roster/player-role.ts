/**
 * The last fixed role vocabulary, kept only for its remaining callers (analytics `PlayerDetail`, `rank.types`);
 * every other surface names and tints roles from the owner game's ontology.
 */

/** Lowercase role key excluding the open slot. */
export type AqtRoleKey = "tank" | "damage" | "support";

const ROLE_ALIASES: Record<string, AqtRoleKey | "flex"> = {
  tank: "tank",
  damage: "damage",
  support: "support",
  flex: "flex"
};

/** A stored role spelling (case-insensitive) as its tint key, or `null` for input naming no known role. */
export function normalizeRoleTint(role: string | null | undefined): AqtRoleKey | "flex" | null {
  if (!role) return null;
  return ROLE_ALIASES[role.trim().toLowerCase()] ?? null;
}
