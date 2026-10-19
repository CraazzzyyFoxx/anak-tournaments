import type { WorkspaceMember, WorkspaceSystemRole } from "@/types/workspace.types";

export const SYSTEM_ROLES: WorkspaceSystemRole[] = ["owner", "admin", "referee", "host", "player"];
export function isSystemRoleName(name: string): name is WorkspaceSystemRole {
  return (SYSTEM_ROLES as string[]).includes(name);
}

/** Best human-readable handle for a member, used in control names and confirmations. */
export function memberLabel(member: WorkspaceMember): string {
  return member.username ?? member.email ?? `User #${member.auth_user_id}`;
}

/** The custom (non-system) role ids currently held by a member. */
export function memberCustomRoleIds(member: WorkspaceMember): number[] {
  return member.rbac_roles.filter((role) => !role.is_system).map((role) => role.id);
}

/**
 * Highest-priority system role a member holds, mirroring the backend's RBAC
 * derivation. `undefined` when the member holds no system role at all -- a real
 * state the "Fill missing roles" action exists to repair.
 */
export function memberPrimaryRole(member: WorkspaceMember): WorkspaceSystemRole | undefined {
  return SYSTEM_ROLES.find((name) =>
    member.rbac_roles.some((role) => role.is_system && role.name === name)
  );
}
