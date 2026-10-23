/** Leaf role references and their derived parents (D86, D92; OW-shaped UI until P7). */
import type { RoleRef } from "@/lib/roster/team-format";

export type { RoleRef };

export function roleOf(ref: RoleRef): string;
export function roleOf(ref: RoleRef | null | undefined): string | null;
export function roleOf(ref: RoleRef | null | undefined): string | null {
  return ref ? ref.parent ?? ref.role : null;
}

export function subRoleOf(ref: RoleRef | null | undefined): string | null {
  return ref?.parent ? ref.role : null;
}

/** Form answers and the workspace sub-role catalog use suffixes, not leaf codes (Deviation 4). */
export function subRoleSlugOf(ref: RoleRef | null | undefined): string | null {
  const leaf = subRoleOf(ref);
  const prefix = `${roleOf(ref)}_`;
  return leaf?.startsWith(prefix) ? leaf.slice(prefix.length) : leaf;
}

export function toRoleRef(role: string, subRole: string | null | undefined, dimension: string): RoleRef;
export function toRoleRef(role: string | null | undefined, subRole: string | null | undefined, dimension: string): RoleRef | null;
export function toRoleRef(
  role: string | null | undefined,
  subRole: string | null | undefined,
  dimension: string,
): RoleRef | null {
  return role ? { dimension, role: subRole || role } : null;
}

/**
 * Parent-level map totals; dimensions keep same-named roles from different games apart. A parent keeps its first
 * row's other fields (a profile role's `division`): the profile sends its roles newest-ranked first, so that is the
 * parent's current division.
 */
export function aggregateRoleStats<T extends {
  role: RoleRef | null;
  maps: number;
  maps_won: number;
  tournaments?: number;
}>(rows: readonly T[]): T[] {
  const totals = new Map<string, T>();
  for (const row of rows) {
    const role = row.role ? { dimension: row.role.dimension, role: row.role.parent ?? row.role.role } : null;
    const key = role ? `${role.dimension}:${role.role}` : "unassigned";
    const total = totals.get(key);
    if (total) {
      total.maps += row.maps;
      total.maps_won += row.maps_won;
      if (row.tournaments !== undefined) total.tournaments = (total.tournaments ?? 0) + row.tournaments;
    } else {
      totals.set(key, { ...row, role });
    }
  }
  return [...totals.values()];
}
