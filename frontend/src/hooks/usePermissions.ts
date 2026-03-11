"use client";

import { useAuthProfileStore } from "@/stores/auth-profile.store";

// ─── Typed role names ────────────────────────────────────────────────────────

export type AppRole = "admin" | "tournament_organizer" | "moderator" | "user";

// ─── Typed permission names ──────────────────────────────────────────────────

export type AppPermission =
  | "achievement.calculate"
  | "achievement.create"
  | "achievement.delete"
  | "achievement.read"
  | "achievement.update"
  | "user.read"
  | "user.create"
  | "user.update"
  | "user.delete"
  | "auth_user.read"
  | "auth_user.update"
  | "tournament.read"
  | "tournament.create"
  | "tournament.update"
  | "tournament.delete"
  | "team.read"
  | "team.create"
  | "team.import"
  | "team.update"
  | "team.delete"
  | "player.read"
  | "player.create"
  | "player.update"
  | "player.delete"
  | "match.read"
  | "match.create"
  | "match.update"
  | "match.delete"
  | "match.sync"
  | "standing.read"
  | "standing.update"
  | "standing.delete"
  | "standing.recalculate"
  | "hero.read"
  | "hero.create"
  | "hero.update"
  | "hero.delete"
  | "hero.sync"
  | "gamemode.read"
  | "gamemode.create"
  | "gamemode.update"
  | "gamemode.delete"
  | "gamemode.sync"
  | "map.read"
  | "map.create"
  | "map.update"
  | "map.delete"
  | "map.sync"
  | "role.read"
  | "role.create"
  | "role.update"
  | "role.delete"
  | "role.assign"
  | "permission.read"
  | "analytics.read"
  | "analytics.update"
  | "admin.*";

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePermissions() {
  const user = useAuthProfileStore((s) => s.user);
  const status = useAuthProfileStore((s) => s.status);

  const isLoaded = status !== "idle" && status !== "loading";
  const isAuthenticated = status === "authenticated";

  // "admin.*" permission or is_superuser flag → wildcard, passes any permission check
  const hasWildcard = (user?.isSuperuser ?? false) || (user?.permissions.includes("admin.*") ?? false);

  // ─── Role checks ────────────────────────────────────────────────────────────

  /** Returns true if the current user has the given role (or is superuser / has admin role). */
  const hasRole = (role: AppRole): boolean => {
    if (!isAuthenticated || !user) return false;
    if (user.isSuperuser || user.roles.includes("admin")) return true;
    return user.roles.includes(role);
  };

  /** Returns true if the user has at least one of the given roles. */
  const hasAnyRole = (roles: AppRole[]): boolean => roles.some((r) => hasRole(r));

  /** Returns true if the user has ALL of the given roles. */
  const hasAllRoles = (roles: AppRole[]): boolean => roles.every((r) => hasRole(r));

  // ─── Permission checks ──────────────────────────────────────────────────────

  /** Returns true if the user has the given permission.
   *  Superusers and users with "admin.*" pass every check. */
  const hasPermission = (permission: AppPermission): boolean => {
    if (!isAuthenticated) return false;
    if (hasWildcard) return true;
    return user?.permissions.includes(permission) ?? false;
  };

  /** Returns true if the user has at least one of the given permissions. */
  const hasAnyPermission = (permissions: AppPermission[]): boolean =>
    permissions.some((p) => hasPermission(p));

  /** Returns true if the user has ALL of the given permissions. */
  const hasAllPermissions = (permissions: AppPermission[]): boolean =>
    permissions.every((p) => hasPermission(p));

  // ─── Semantic shortcuts ─────────────────────────────────────────────────────

  return {
    // Loading state — use to avoid flickering UI before auth resolves
    isLoaded,
    isAuthenticated,

    // Role checks
    hasRole,
    hasAnyRole,
    hasAllRoles,

    // Permission checks
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,

    // Semantic flags
    isSuperuser: user?.isSuperuser ?? false,
    isAdmin: hasRole("admin"),
    isOrganizer: hasRole("tournament_organizer"),
    isModerator: hasRole("moderator"),
  };
}
