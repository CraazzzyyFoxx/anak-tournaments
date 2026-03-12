import {
  BarChart3,
  Gamepad2,
  LayoutDashboard,
  Map,
  type LucideIcon,
  Settings2,
  Shield,
  Swords,
  Trophy,
  UserCircle,
  Users,
} from "lucide-react";

import type { AppPermission } from "@/hooks/usePermissions";

export type AdminNavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
  permissions?: AppPermission[];
  superuserOnly?: boolean;
};

export type AdminNavGroup = {
  title: string;
  items: AdminNavItem[];
  superuserOnly?: boolean;
};

export const overviewPermissions: AppPermission[] = [
  "tournament.read",
  "team.read",
  "player.read",
  "match.read",
  "standing.read",
  "user.read",
  "hero.read",
  "gamemode.read",
  "map.read",
  "analytics.read",
];

export const accessUsersPermissions: AppPermission[] = ["auth_user.read"];
export const accessRolesPermissions: AppPermission[] = ["role.read"];
export const accessPermissionsPermissions: AppPermission[] = ["permission.read"];
export const accessAdminPermissions: AppPermission[] = [
  ...accessUsersPermissions,
  ...accessRolesPermissions,
  ...accessPermissionsPermissions,
];

export const adminEntryPermissions: AppPermission[] = [
  ...overviewPermissions,
  ...accessAdminPermissions,
  "achievement.read",
];

export const adminNavigationGroups: AdminNavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        title: "Dashboard",
        href: "/admin",
        icon: LayoutDashboard,
        description: "Operations overview, live issues, and priority actions.",
        permissions: overviewPermissions,
      },
    ],
  },
  {
    title: "Competition",
    items: [
      {
        title: "Tournaments",
        href: "/admin/tournaments",
        icon: Trophy,
        description: "Manage tournament lifecycle, groups, and schedules.",
        permissions: ["tournament.read"],
      },
      {
        title: "Teams",
        href: "/admin/teams",
        icon: Users,
        description: "Review rosters, imports, and team readiness.",
        permissions: ["team.read"],
      },
      {
        title: "Players",
        href: "/admin/players",
        icon: UserCircle,
        description: "Inspect player records and competitive data.",
        permissions: ["player.read"],
      },
      {
        title: "Encounters",
        href: "/admin/encounters",
        icon: Swords,
        description: "Track matches, logs, and sync coverage.",
        permissions: ["match.read"],
      },
      {
        title: "Standings",
        href: "/admin/standings",
        icon: BarChart3,
        description: "Audit bracket health and ranking outputs.",
        permissions: ["standing.read"],
      },
      {
        title: "Player Identities",
        href: "/admin/users",
        icon: UserCircle,
        description: "Resolve Discord, BattleTag, and Twitch identities.",
        permissions: ["user.read"],
      },
    ],
  },
  {
    title: "Game Content",
    items: [
      {
        title: "Heroes",
        href: "/admin/heroes",
        icon: Shield,
        description: "Curate hero inventory used by analytics and admin tools.",
        permissions: ["hero.read"],
      },
      {
        title: "Gamemodes",
        href: "/admin/gamemodes",
        icon: Gamepad2,
        description: "Maintain mode metadata and competitive rulesets.",
        permissions: ["gamemode.read"],
      },
      {
        title: "Maps",
        href: "/admin/maps",
        icon: Map,
        description: "Manage map pool coverage for tournaments and stats.",
        permissions: ["map.read"],
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        title: "Users",
        href: "/admin/access/users",
        icon: Users,
        description: "Admin account access and assignments.",
        permissions: accessUsersPermissions,
      },
      {
        title: "Roles",
        href: "/admin/access/roles",
        icon: Shield,
        description: "Role catalog and permission bundles.",
        permissions: accessRolesPermissions,
      },
      {
        title: "Permissions",
        href: "/admin/access/permissions",
        icon: Shield,
        description: "Permission visibility and governance.",
        permissions: accessPermissionsPermissions,
      },
      {
        title: "Settings",
        href: "/admin/settings",
        icon: Settings2,
        description: "System-level settings for the admin workspace.",
        superuserOnly: true,
      },
    ],
  },
];

export const adminRoutePermissions: Array<{
  prefix: string;
  permissions: AppPermission[];
  superuserOnly?: boolean;
}> = [
  { prefix: "/admin/access/users", permissions: accessUsersPermissions },
  { prefix: "/admin/access/roles", permissions: accessRolesPermissions },
  { prefix: "/admin/access/permissions", permissions: accessPermissionsPermissions },
  { prefix: "/admin/access", permissions: accessAdminPermissions },
  { prefix: "/admin/settings", permissions: [], superuserOnly: true },
  { prefix: "/admin/balancer", permissions: ["team.import"] },
  { prefix: "/admin/tournaments", permissions: ["tournament.read"] },
  { prefix: "/admin/teams", permissions: ["team.read"] },
  { prefix: "/admin/players", permissions: ["player.read"] },
  { prefix: "/admin/encounters", permissions: ["match.read"] },
  { prefix: "/admin/standings", permissions: ["standing.read"] },
  { prefix: "/admin/users", permissions: ["user.read"] },
  { prefix: "/admin/heroes", permissions: ["hero.read"] },
  { prefix: "/admin/gamemodes", permissions: ["gamemode.read"] },
  { prefix: "/admin/maps", permissions: ["map.read"] },
  { prefix: "/admin/achievements", permissions: ["achievement.read"] },
  { prefix: "/admin", permissions: adminEntryPermissions },
];

export function getMatchingAdminRoute(pathname: string) {
  return adminRoutePermissions.find((route) => {
    if (route.prefix === "/admin") {
      return pathname === "/admin";
    }

    return pathname === route.prefix || pathname.startsWith(`${route.prefix}/`);
  });
}

export function isAdminNavItemActive(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === "/admin";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getVisibleAdminNavigationGroups(
  isSuperuser: boolean,
  hasAnyPermission: (permissions: AppPermission[]) => boolean,
) {
  return adminNavigationGroups
    .filter((group) => !group.superuserOnly || isSuperuser)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.superuserOnly) {
          return isSuperuser;
        }

        if (!item.permissions || item.permissions.length === 0) {
          return true;
        }

        return isSuperuser || hasAnyPermission(item.permissions);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function getActiveAdminNavigation(pathname: string, groups: AdminNavGroup[]) {
  for (const group of groups) {
    for (const item of group.items) {
      if (isAdminNavItemActive(pathname, item.href)) {
        return { group, item };
      }
    }
  }

  return null;
}
