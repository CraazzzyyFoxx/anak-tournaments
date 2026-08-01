import type { PlayerSubRole } from "@/types/admin.types";

/** Canonical roster role names — the only values `PlayerRoleIcon` maps to a glyph. */
export type PlayerRoleOption = "Tank" | "Damage" | "Support";

/** Selector order: tank, damage, support — the order every roster table sorts by. */
export const PLAYER_ROLE_OPTIONS: PlayerRoleOption[] = ["Tank", "Damage", "Support"];

/**
 * Coerce any stored/legacy role spelling (`dps`, `damage`, `TANK`, `null`) to a
 * canonical option. Unknown values fall back to `Damage`, matching what the
 * roster editors have always done.
 */
export function normalizePlayerRole(role: string | null | undefined): PlayerRoleOption {
  switch (role?.trim().toLowerCase()) {
    case "tank":
      return "Tank";
    case "support":
      return "Support";
    default:
      return "Damage";
  }
}

/** Canonical role as the `player_sub_role` catalog spells it. */
export function subRoleCatalogRole(role: string | null | undefined): "tank" | "damage" | "support" {
  const normalized = normalizePlayerRole(role);
  if (normalized === "Tank") return "tank";
  if (normalized === "Support") return "support";
  return "damage";
}

/** Sub-roles offered for a role. */
export function filterSubRoleOptions(
  subRoles: PlayerSubRole[] | undefined,
  role: string | null | undefined
): PlayerSubRole[] {
  const catalogRole = subRoleCatalogRole(role);
  return (subRoles ?? []).filter((subRole) => subRole.role === catalogRole);
}
