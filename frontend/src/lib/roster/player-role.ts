/**
 * OW-shaped roster presentation names. Ontology codes are normalized at the
 * shared icon boundary. `Flex` displays an unassigned roster role, not an
 * ontology node, and never applies to a hero's tank/damage/support class.
 */
export type PlayerRoleOption = "Tank" | "Damage" | "Support" | "Flex";

/**
 * Case-insensitive alias table shared by every normalizer below, so every
 * caller resolves a stored role spelling identically instead of keeping its
 * own copy. Mirrors the backend's `HeroClass.parse` -- the canonical name,
 * lowercase. No other synonyms: a caller needing free-text aliases (e.g.
 * sheet-import value maps) owns that mapping itself instead of this table
 * silently widening it.
 */
const ROLE_ALIASES: Record<string, "tank" | "damage" | "support" | "flex"> = {
  tank: "tank",
  damage: "damage",
  support: "support",
  flex: "flex"
};

function resolveRoleAlias(role: string | null | undefined): "tank" | "damage" | "support" | "flex" | null {
  if (!role) return null;
  return ROLE_ALIASES[role.trim().toLowerCase()] ?? null;
}

/**
 * Coerce any stored role spelling (`damage`, `TANK`, `flex`, `null`) to a
 * canonical option.
 *
 * Unknown and absent values still fall back to `Damage`: `Damage` is the
 * historical default of every roster editor, and widening the fallback to
 * `Flex` would silently promote corrupt or missing data into a real, savable
 * role. `flex` is matched explicitly instead — without that case the default
 * branch rewrote every flex player to `Damage` on save.
 */
export function normalizePlayerRole(role: string | null | undefined): PlayerRoleOption {
  switch (resolveRoleAlias(role)) {
    case "tank":
      return "Tank";
    case "support":
      return "Support";
    case "flex":
      return "Flex";
    default:
      return "Damage";
  }
}

/** Canonical role as the `player_sub_role` catalog spells it. */
export type SubRoleCatalogRole = "tank" | "damage" | "support";

/**
 * i18n message key per role. Single source of truth — `PlayerRoleIcon` and the
 * list/filter utilities both read this map instead of keeping their own copies.
 *
 * Values stay literal (`as const`) so call sites can derive a message-key type
 * from them; `satisfies` still enforces one key per role.
 */
export const PLAYER_ROLE_LABEL_KEY = {
  Tank: "common.roles.tank",
  Damage: "common.roles.damage",
  Support: "common.roles.support",
  Flex: "common.roles.flex"
} as const satisfies Record<PlayerRoleOption, string>;

/** Lowercase tint/variant key, matching the `--aqt-<role>` CSS hues. */
export type PlayerRoleTint = "tank" | "damage" | "support" | "flex";

/** Tint key for a role, or `null` for an absent role (nothing to tint). */
export function playerRoleTint(role: string | null | undefined): PlayerRoleTint | null {
  if (role === null || role === undefined || role.trim() === "") return null;
  const normalized = normalizePlayerRole(role);
  if (normalized === "Tank") return "tank";
  if (normalized === "Support") return "support";
  if (normalized === "Flex") return "flex";
  return "damage";
}

/**
 * Lowercase role key excluding `Flex` — hero-class tinting/selection never
 * sees a flex hero (no hero has that class), so this is `PlayerRoleTint`
 * minus its one player-only member.
 */
export type AqtRoleKey = SubRoleCatalogRole;

/**
 * Strict variant of {@link playerRoleTint}: `null` for input that names no
 * recognized role at all (vs. `playerRoleTint`, which defaults unrecognized
 * input to Damage). Used where "no role" and "Damage" must stay distinguishable
 * — e.g. ordering pick/ban rows only when the catalog actually knows a role.
 */
export function normalizeRole(role: string | null | undefined): AqtRoleKey | null {
  const alias = resolveRoleAlias(role);
  return alias && alias !== "flex" ? alias : null;
}

/** {@link normalizeRole}, defaulting to Damage instead of `null`. */
export function heroVariantFromRole(role: string | null | undefined): AqtRoleKey {
  return normalizeRole(role) ?? "damage";
}

/**
 * Draft/balancer/registration wire spelling — mirrors the backend's
 * `HeroClass.slot_code`, which is now just the lowercased canonical name.
 * Identical to {@link PlayerRoleTint} by construction; kept separate because
 * one names a wire/storage contract and the other a CSS hue.
 */
export type PlayerRoleSlotCode = "tank" | "damage" | "support" | "flex";

/** {@link PlayerRoleOption} -> {@link PlayerRoleSlotCode}. */
export function playerRoleSlotCode(role: PlayerRoleOption): PlayerRoleSlotCode {
  return role.toLowerCase() as PlayerRoleSlotCode;
}

/**
 * Strict variant of {@link playerRoleTint} that also recognizes `Flex` and
 * returns `null` for input naming no role at all (vs. defaulting to Damage).
 */
export function normalizeRoleTint(role: string | null | undefined): PlayerRoleTint | null {
  return resolveRoleAlias(role);
}
