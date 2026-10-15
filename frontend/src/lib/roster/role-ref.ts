/** Leaf role references and their derived parents (D86, D92; OW-shaped UI until P7). */
import type { RoleRef } from "@/lib/roster/team-format";

export type { RoleRef };

export function roleOf(ref: RoleRef | null | undefined): string | null {
  return ref ? ref.parent ?? ref.role : null;
}

export function subRoleOf(ref: RoleRef | null | undefined): string | null {
  return ref?.parent ? ref.role : null;
}

export function toRoleRef(
  role: string | null | undefined,
  subRole: string | null | undefined,
  dimension: string,
): RoleRef | null {
  return role ? { dimension, role: subRole || role } : null;
}
