import { useCallback } from "react";
import { useTranslations } from "next-intl";

import type { WorkspaceMember, WorkspaceSystemRole } from "@/types/workspace.types";

export const SYSTEM_ROLES: WorkspaceSystemRole[] = ["owner", "admin", "referee", "host", "player"];
function isSystemRoleName(name: string): name is WorkspaceSystemRole {
  return (SYSTEM_ROLES as string[]).includes(name);
}

type RoleLike = Readonly<{ name: string; is_system: boolean }>;

function roleRank(role: RoleLike): number {
  return role.is_system && isSystemRoleName(role.name) ? SYSTEM_ROLES.indexOf(role.name) : SYSTEM_ROLES.length;
}

/** System roles in the backend's rank order (owner → player), then custom roles by name. */
export function sortRoles<T extends RoleLike>(roles: readonly T[]): T[] {
  return [...roles].sort((a, b) => roleRank(a) - roleRank(b) || a.name.localeCompare(b.name));
}

/**
 * One label per role, the same in the cell, the filter and its chips: system
 * roles translated, custom ones marked — a custom "Admin" is not the system admin.
 */
export function useRoleLabel(): (role: RoleLike) => string {
  const tm = useTranslations("adminAccess.member");
  return useCallback(
    (role: RoleLike) =>
      role.is_system && isSystemRoleName(role.name)
        ? tm(`${role.name}Role`)
        : tm("customRole", { name: role.name }),
    [tm]
  );
}

/** Best human-readable handle for a member, used in control names and confirmations. */
export function memberLabel(member: WorkspaceMember): string {
  return member.username ?? member.email ?? `User #${member.auth_user_id}`;
}
