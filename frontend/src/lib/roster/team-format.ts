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
  substitute_min?: number;
  substitute_max?: number;
  dimensions: TeamFormatDimension[];
  rules: TeamFormatRule[];
}

export function slotsToTeamFormat(
  slots: RosterSlotMap,
  dimension: string,
  current?: TeamFormatWrite
): TeamFormatWrite {
  const counts = Object.entries(slots) as [string, number | undefined][];
  const roleSlots = counts.filter(([code, count]) => code !== "flex" && (count ?? 0) > 0) as [
    string,
    number
  ][];
  const total = counts.reduce((sum, [, count]) => sum + (count ?? 0), 0);
  const rules: TeamFormatRule[] =
    current?.rules.flatMap((rule) => {
      if (rule.role.dimension !== dimension) return [rule];
      if (rule.recommended_min == null && rule.recommended_max == null) return [];
      return [{ ...rule, hard_min: undefined, hard_max: undefined }];
    }) ?? [];
  for (const [role, count] of roleSlots) {
    const prior = rules.find(
      (rule) => rule.role.dimension === dimension && rule.role.role === role
    );
    if (prior) Object.assign(prior, { hard_min: count, hard_max: count });
    else rules.push({ role: { dimension, role }, hard_min: count, hard_max: count });
  }
  return {
    name: current?.name ?? "Custom roster",
    preset_code: current?.preset_code ?? null,
    ...(current && {
      substitute_min: current.substitute_min,
      substitute_max: current.substitute_max
    }),
    starter_min: total,
    starter_max: total,
    dimensions: current
      ? current.dimensions.map((entry) =>
          entry.dimension === dimension && roleSlots.length > 0
            ? { ...entry, mode: "enforced" }
            : entry
        )
      : [{ dimension, mode: roleSlots.length > 0 ? "enforced" : "off" }],
    rules
  };
}
