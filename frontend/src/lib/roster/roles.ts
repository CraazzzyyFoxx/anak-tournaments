import type { SubroleCatalog, SubroleOption } from "@/types/registration.types";

/**
 * Sub-role resolution for registration. Sub-role *options* are data-driven from
 * the workspace `PlayerSubRole` catalog embedded in the form payload
 * (`form.subrole_catalog`); the `roles` field's `params.subroles` only selects
 * which catalog slugs are offered. Which roles a game has, and what they are
 * called, is the owner game's ontology (`lib/roster/ontology.ts`).
 */

const SUBROLE_ACRONYMS = new Set(["pov", "vk"]);

/** Humanize a sub-role slug as a fallback when no catalog label is available. */
export function formatSubroleSlug(slug: string): string {
  return slug
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => (SUBROLE_ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * The sub-role options a role offers, from the workspace catalog narrowed by
 * the `roles` builtin's `subroles` allowlist.
 *
 * - role absent from `subroles` → offer all catalog options for it.
 * - role present with `[]` → explicit opt-out, offer none.
 * - role present and non-empty → offer the catalog options it names.
 *
 * The allowlist no longer splits primary from additional: one map per role,
 * whatever slot the role is taken in.
 */
export function getSubroleOptions(
  catalog: SubroleCatalog | undefined,
  subroles: Record<string, string[]>,
  role: string,
): SubroleOption[] {
  const all = catalog?.[role] ?? [];
  const selection = subroles[role];
  if (selection === undefined) {
    return all;
  }
  const enabled = new Set(selection);
  return all.filter((option) => enabled.has(option.slug));
}

/** Look up a sub-role's display label from the catalog, with a humanized fallback. */
export function getSubroleLabel(
  catalog: SubroleCatalog | undefined,
  role: string,
  slug: string,
): string {
  const match = (catalog?.[role] ?? []).find((option) => option.slug === slug);
  return match?.label ?? formatSubroleSlug(slug);
}
