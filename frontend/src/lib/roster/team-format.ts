/**
 * The team format on the wire (D35, D88) and the one adapter the slot-map editor needs until P7 rebuilds it on the
 * format: a slot map is exact quotas on the rated dimension plus open (`flex`) slots (D33).
 */
import type { RosterSlotMap } from "@/lib/roster/shape";

export interface RoleRef {
  dimension: string;
  role: string;
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
  dimensions: TeamFormatDimension[];
  rules: TeamFormatRule[];
}

export function slotsToTeamFormat(slots: RosterSlotMap, dimension: string): TeamFormatWrite {
  const counts = Object.entries(slots) as [string, number | undefined][];
  const roleSlots = counts.filter(([code, count]) => code !== "flex" && (count ?? 0) > 0) as [string, number][];
  const total = counts.reduce((sum, [, count]) => sum + (count ?? 0), 0);
  return {
    name: "Custom roster",
    preset_code: null,
    starter_min: total,
    starter_max: total,
    dimensions: [{ dimension, mode: roleSlots.length > 0 ? "enforced" : "off" }],
    rules: roleSlots.map(([role, count]) => ({ role: { dimension, role }, hard_min: count, hard_max: count }))
  };
}
