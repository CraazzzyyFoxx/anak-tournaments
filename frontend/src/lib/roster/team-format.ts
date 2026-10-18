import type { Schema } from "@/types/api";
import { findRole, ratedDimension, selectableRoles, type RoleOntology } from "./ontology";

export interface RoleRef {
  dimension: string;
  role: string;
  /** Read-derived only. Writers strip this key. */
  parent?: string | null;
}
export interface TeamFormatDimension {
  dimension: string;
  mode: "off" | "informational" | "preference" | "enforced";
  player_min_assignments?: number | null;
  player_max_assignments?: number | null;
}
export interface TeamFormatRule {
  role: RoleRef;
  hard_min?: number | null;
  hard_max?: number | null;
  recommended_min?: number | null;
  recommended_max?: number | null;
  include_descendants?: boolean;
}
export interface TeamFormatWrite {
  name: string;
  preset_code: string | null;
  starter_min: number;
  starter_max: number;
  substitute_min?: number;
  substitute_max?: number;
  dimensions: TeamFormatDimension[];
  rules: TeamFormatRule[];
}
export type TeamFormatRead = Schema<"tournament.TeamFormatRead">;

/** Native read→write, not a slot projection. Untouched absence, null and zero stay distinct. */
export function teamFormatPayload(format: Omit<TeamFormatWrite, "dimensions" | "rules"> & Partial<Pick<TeamFormatWrite, "dimensions" | "rules">>): TeamFormatWrite {
  return {
    name: format.name, preset_code: format.preset_code,
    starter_min: format.starter_min, starter_max: format.starter_max,
    ...(format.substitute_min !== undefined ? { substitute_min: format.substitute_min } : {}),
    ...(format.substitute_max !== undefined ? { substitute_max: format.substitute_max } : {}),
    dimensions: (format.dimensions ?? []).map(entry => ({ ...entry })),
    rules: (format.rules ?? []).map(rule => ({ ...rule, role: { dimension: rule.role.dimension, role: rule.role.role } })),
  };
}

/** Compare native server defaults without normalizing the editable/write payload. Zero stays explicit. */
export function teamFormatsEqual(left: TeamFormatWrite, right: TeamFormatWrite): boolean {
  const comparable = (format: TeamFormatWrite) => ({
    name: format.name.trim(), preset_code: format.preset_code,
    starter_min: format.starter_min, starter_max: format.starter_max,
    substitute_min: format.substitute_min ?? 0, substitute_max: format.substitute_max ?? 0,
    dimensions: format.dimensions.map(entry => ({
      dimension: entry.dimension, mode: entry.mode,
      player_min_assignments: entry.player_min_assignments ?? null,
      player_max_assignments: entry.player_max_assignments ?? null,
    })).sort((a, b) => a.dimension.localeCompare(b.dimension)),
    rules: format.rules.map(rule => ({
      dimension: rule.role.dimension, role: rule.role.role,
      hard_min: rule.hard_min ?? null, hard_max: rule.hard_max ?? null,
      recommended_min: rule.recommended_min ?? null, recommended_max: rule.recommended_max ?? null,
      include_descendants: rule.include_descendants ?? true,
    })).sort((a, b) => a.dimension.localeCompare(b.dimension) || a.role.localeCompare(b.role)),
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

/** Early form feedback only; existing P2 backend validators remain authoritative. */
export function teamFormatErrors(format: TeamFormatWrite, ontology: RoleOntology): string[] {
  const errors: string[] = [];
  const rated = ratedDimension(ontology);
  if (!rated) errors.push("rated_dimension");
  if (!format.name.trim() || format.name.length > 128) errors.push("name");
  const rangeBad = (low: number | null | undefined, high: number | null | undefined) =>
    (low != null && (!Number.isInteger(low) || low < 0)) ||
    (high != null && (!Number.isInteger(high) || high < 0)) || (low != null && high != null && low > high);
  if (rangeBad(format.starter_min, format.starter_max) || format.starter_min < 1 || format.starter_max > 12 ||
      rangeBad(format.substitute_min ?? 0, format.substitute_max ?? 0)) errors.push("sizes");
  const listed = new Set<string>();
  for (const entry of format.dimensions) {
    if (!ontology.dimensions.some(d => d.code === entry.dimension && d.active)) errors.push("dimension_unavailable");
    if (listed.has(entry.dimension)) errors.push("duplicate_dimension");
    listed.add(entry.dimension);
    if (rangeBad(entry.player_min_assignments, entry.player_max_assignments)) errors.push("assignments");
  }
  const ruled = new Set<string>();
  for (const rule of format.rules) {
    const key = JSON.stringify([rule.role.dimension, rule.role.role]);
    if (!listed.has(rule.role.dimension)) errors.push("dimension_unavailable");
    if (!selectableRoles(ontology, rule.role.dimension).some(role => role.code === rule.role.role)) errors.push("role_unavailable");
    if (ruled.has(key)) errors.push("duplicate_role");
    ruled.add(key);
    if (rangeBad(rule.hard_min, rule.hard_max) || rangeBad(rule.recommended_min, rule.recommended_max)) errors.push("quota_range");
  }
  if (rated && format.dimensions.some(d => d.dimension === rated.code && d.mode === "enforced")) {
    const required = format.rules.reduce((sum, rule) => {
      const role = findRole(ontology, rule.role);
      return sum + (role?.dimension === rated.code && role.parent_id === null ? rule.hard_min ?? 0 : 0);
    }, 0);
    if (required > format.starter_max) errors.push("slots_exceed_starters");
  }
  return [...new Set(errors)];
}
