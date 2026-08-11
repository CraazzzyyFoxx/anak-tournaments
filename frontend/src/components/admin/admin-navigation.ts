import {
  Activity,
  Award,
  BadgeCheck,
  BarChart3,
  Building2,
  ClipboardCheck,
  Gamepad2,
  Layers,
  LayoutDashboard,
  Map,
  type LucideIcon,
  Settings2,
  Shapes,
  Shield,
  Swords,
  Tags,
  Trophy,
  UserCircle,
  UserCog,
  Users,
} from "lucide-react";

import type { AppPermission } from "@/hooks/usePermissions";
import {
  accessAdminPermissions,
  accessApiKeysPermissions,
  accessPermissionsPermissions,
  accessRolesPermissions,
  accessUsersPermissions,
  adminEntryPermissions,
  overviewPermissions,
} from "@/lib/admin-permissions";

export type AdminNavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** Extra search terms for the command palette (D11). */
  aliases?: string[];
  permissions?: AppPermission[];
  superuserOnly?: boolean;
  workspaceAdminVisible?: boolean;
  globalOnly?: boolean;
};

export type AdminNavGroup = {
  title: string;
  items: AdminNavItem[];
  superuserOnly?: boolean;
};

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
        workspaceAdminVisible: true,
      },
    ],
  },
  {
    title: "Tournaments",
    items: [
      {
        title: "Tournaments",
        href: "/admin/tournaments",
        icon: Trophy,
        description: "Manage tournament lifecycle, stages, and schedules.",
        permissions: ["tournament.read"],
      },
    ],
  },
  {
    title: "Data browser",
    items: [
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
        title: "Match reports",
        href: "/admin/match-reports",
        icon: ClipboardCheck,
        description: "Captain-submitted results and the disputes between them.",
        permissions: ["match.read"],
      },
      {
        title: "Parsed matches",
        href: "/admin/matches",
        icon: Map,
        description: "Played maps from the log parser, and the upload each came from.",
        permissions: ["match.read"],
      },
      {
        title: "Standings",
        href: "/admin/standings",
        icon: BarChart3,
        description: "Audit bracket health and ranking outputs.",
        permissions: ["standing.read"],
      },
    ],
  },
  {
    title: "Workspace",
    items: [
      {
        title: "Divisions",
        href: "/admin/divisions",
        icon: Layers,
        description: "Configure division grids and rank thresholds per workspace.",
        workspaceAdminVisible: true,
      },
      {
        title: "Balancer statuses",
        href: "/admin/balancer",
        icon: Settings2,
        description: "Manage workspace-specific registration and balancer statuses.",
        permissions: ["team.read"],
      },
      {
        title: "Sub-roles",
        href: "/admin/sub-roles",
        icon: Shapes,
        description: "Manage the workspace sub-role catalog used by forms, rosters, and balancer.",
        aliases: ["subroles", "main tank", "off tank", "flex"],
        permissions: ["player.read"],
      },
      {
        title: "Achievements",
        href: "/admin/achievements",
        icon: Award,
        description: "Manage achievements with condition tree evaluation engine.",
        permissions: ["achievement.read"],
      },
      {
        title: "Members",
        href: "/admin/workspaces/members",
        icon: UserCog,
        description: "Manage workspace member access and roles.",
        workspaceAdminVisible: true,
      },
    ],
  },
  {
    title: "Game content",
    items: [
      {
        title: "Heroes",
        href: "/admin/heroes",
        icon: Shield,
        description: "Curate hero inventory used by analytics and admin tools.",
        superuserOnly: true,
      },
      {
        title: "Gamemodes",
        href: "/admin/gamemodes",
        icon: Gamepad2,
        description: "Maintain mode metadata and competitive rulesets.",
        superuserOnly: true,
      },
      {
        title: "Maps",
        href: "/admin/maps",
        icon: Map,
        description: "Manage map pool coverage for tournaments and stats.",
        superuserOnly: true,
      },
      {
        title: "Aliases",
        href: "/admin/aliases",
        icon: Tags,
        description: "Attach unresolved match-log names to the hero, map or mode they mean.",
        aliases: ["unresolved names", "log names", "translations", "alias queue"],
        superuserOnly: true,
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        title: "Staff access",
        href: "/admin/access",
        icon: Shield,
        description: "Staff accounts, roles, permissions, API keys, and sessions.",
        permissions: accessAdminPermissions,
        workspaceAdminVisible: true,
        aliases: ["staff", "roles", "permissions", "api keys", "sessions"],
      },
      {
        title: "Player identities",
        href: "/admin/users",
        icon: UserCircle,
        description: "Resolve Discord, BattleTag, and Twitch identities.",
        permissions: ["user.read"],
        // Players are global entities, so the backend gate (`users_admin.py`
        // `_gate`) demands a GLOBAL `user.<action>` grant. A workspace owner
        // holds none, so without `globalOnly` they would see the link and then
        // get a 403 from every request behind it.
        globalOnly: true,
        aliases: ["identities", "discord", "battletag", "twitch"],
      },
      {
        title: "Rank collection",
        href: "/admin/rank",
        icon: Activity,
        description: "OverFast rank collection status and manual re-fetch per player.",
        permissions: ["rank.read"],
        aliases: ["settings"],
      },
      {
        title: "Subscription collection",
        href: "/admin/subscriptions",
        icon: BadgeCheck,
        description: "Boosty/Twitch subscription check health, history and per-player re-check.",
        permissions: ["subscription.read"],
        // `twitch` deliberately omitted: /admin/users already claims it, and the
        // palette requires every alias to resolve to exactly one entry.
        aliases: ["subscriptions", "boosty", "entitlements"],
      },
      {
        title: "Workspaces",
        href: "/admin/workspaces",
        icon: Building2,
        description: "Manage workspaces and their settings.",
        workspaceAdminVisible: true,
      },
    ],
  },
];

export const adminRoutePermissions: Array<{
  prefix: string;
  permissions: AppPermission[];
  superuserOnly?: boolean;
  workspaceAdminVisible?: boolean;
  globalOnly?: boolean;
}> = [
  { prefix: "/admin/access/users", permissions: accessUsersPermissions, globalOnly: true },
  { prefix: "/admin/access/roles", permissions: accessRolesPermissions, workspaceAdminVisible: true },
  { prefix: "/admin/access/oauth", permissions: accessUsersPermissions, globalOnly: true },
  { prefix: "/admin/access/api-keys", permissions: accessApiKeysPermissions, workspaceAdminVisible: true },
  { prefix: "/admin/access/sessions", permissions: [], superuserOnly: true },
  { prefix: "/admin/access/permissions", permissions: accessPermissionsPermissions, globalOnly: true },
  { prefix: "/admin/access", permissions: accessAdminPermissions, workspaceAdminVisible: true },
  { prefix: "/admin/workspaces/members", permissions: [], workspaceAdminVisible: true },
  { prefix: "/admin/workspaces", permissions: [], workspaceAdminVisible: true },
  { prefix: "/admin/balancer", permissions: ["team.read"] },
  { prefix: "/admin/tournaments", permissions: ["tournament.read"] },
  { prefix: "/admin/teams", permissions: ["team.read"] },
  { prefix: "/admin/players", permissions: ["player.read"] },
  { prefix: "/admin/sub-roles", permissions: ["player.read"] },
  { prefix: "/admin/encounters", permissions: ["match.read"] },
  { prefix: "/admin/match-reports", permissions: ["match.read"] },
  { prefix: "/admin/matches", permissions: ["match.read"] },
  { prefix: "/admin/standings", permissions: ["standing.read"] },
  { prefix: "/admin/users", permissions: ["user.read"], globalOnly: true },
  { prefix: "/admin/rank", permissions: ["rank.read"] },
  { prefix: "/admin/subscriptions", permissions: ["subscription.read"] },
  { prefix: "/admin/heroes", permissions: [], superuserOnly: true },
  { prefix: "/admin/gamemodes", permissions: [], superuserOnly: true },
  { prefix: "/admin/maps", permissions: [], superuserOnly: true },
  { prefix: "/admin/aliases", permissions: [], superuserOnly: true },
  { prefix: "/admin/achievements", permissions: ["achievement.read"] },
  { prefix: "/admin/divisions", permissions: [], workspaceAdminVisible: true },
  { prefix: "/admin", permissions: adminEntryPermissions, workspaceAdminVisible: true },
];

export function getMatchingAdminRoute(pathname: string) {
  return adminRoutePermissions.find((route) => {
    if (route.prefix === "/admin") {
      return pathname === "/admin";
    }

    return pathname === route.prefix || pathname.startsWith(`${route.prefix}/`);
  });
}

/**
 * Given all nav hrefs, returns the one that best matches the pathname
 * (longest prefix). This prevents parent routes from being active when
 * a more specific child route matches.
 */
export function getActiveAdminNavHref(pathname: string, allHrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of allHrefs) {
    if (href === "/admin") {
      if (pathname === "/admin") best = href;
      continue;
    }
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (!best || href.length > best.length) {
        best = href;
      }
    }
  }
  return best;
}

export function getVisibleAdminNavigationGroups(
  canAccessItem: (
    item: Pick<
      AdminNavItem,
      "permissions" | "superuserOnly" | "workspaceAdminVisible" | "globalOnly"
    >,
  ) => boolean,
) {
  return adminNavigationGroups
    .filter((group) => !group.superuserOnly)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessItem(item)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Search haystack for the admin command palette: title + description + aliases (D11). */
export function adminNavItemSearchValue(
  item: Pick<AdminNavItem, "title" | "description" | "aliases">,
): string {
  return [item.title, item.description, ...(item.aliases ?? [])].join(" ");
}
