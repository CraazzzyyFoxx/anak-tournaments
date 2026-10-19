import {
  Activity,
  Award,
  Bell,
  Building2,
  Gamepad2,
  Gauge,
  History,
  LayoutDashboard,
  Megaphone,
  type LucideIcon,
  Settings2,
  Shield,
  Swords,
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
} from "@/lib/auth/admin-permissions";

/** One view of a multi-view browser, offered by the command palette (P1-5). */
export type AdminNavView = {
  key: string;
  label: string;
  href: string;
};

export type AdminNavItem = {
  title: string;
  href: string;
  /**
   * Path prefix that marks this entry active, when `href` points deeper than
   * the section it owns (`/admin/content/heroes` is the landing section of
   * `/admin/content`, and `/admin/content/unresolved` must still light it up).
   */
  activePrefix?: string;
  icon: LucideIcon;
  description: string;
  /** Extra search terms for the command palette (D11). */
  aliases?: string[];
  /** Views of a `?view=`/sub-route browser, listed separately in the palette. */
  views?: AdminNavView[];
  /**
   * Queue size shown beside the entry (unresolved names, disputed reports).
   *
   * A function, so the count can be read at render time rather than frozen
   * into this static config. It runs inside a `.map()` over the items, so it
   * MUST NOT call hooks — read the query cache (`queryClient.getQueryData`)
   * or a store's `getState()`. Returning `undefined` renders no badge.
   */
  badge?: () => number | undefined;
  permissions?: AppPermission[];
  superuserOnly?: boolean;
  workspaceAdminVisible?: boolean;
  globalOnly?: boolean;
};

export type AdminNavGroup = {
  /** Eyebrow above the group. Empty for the leading, unlabelled group. */
  title: string;
  items: AdminNavItem[];
  superuserOnly?: boolean;
};

/**
 * The Access hub's six sections, in tab order.
 *
 * Shared with the hub's landing redirect: Access mixes three gate classes
 * (global-RBAC reads, workspace-admin surfaces, superuser-only sessions), so
 * the entry cannot point at a fixed section — `/admin/access` forwards to the
 * first of these the caller may actually open.
 */
export const accessSectionViews: AdminNavView[] = [
  { key: "accounts", label: "nav.accounts", href: "/admin/access/accounts" },
  { key: "roles", label: "nav.roles", href: "/admin/access/roles" },
  { key: "permissions", label: "nav.permissions", href: "/admin/access/permissions" },
  { key: "api-keys", label: "nav.apiKeys", href: "/admin/access/api-keys" },
  { key: "oauth", label: "nav.oauth", href: "/admin/access/oauth" },
  { key: "sessions", label: "nav.sessions", href: "/admin/access/sessions" },
];

/**
 * The sidebar: 14 entries in four groups.
 *
 * Three contexts of work instead of six catalogues: what happens in the
 * community (DATA), how the community is configured (WORKSPACE), and the
 * platform itself (PLATFORM). Tournaments sit at the root because they are
 * most of the daily work.
 *
 * An entry that used to be its own page is now a view of one browser
 * (`Matches` swallowed encounters/reports/parsed/standings) or a section of
 * one settings hub (`Settings` swallowed divisions/statuses/sub-roles). Every
 * alias those pages carried is re-homed here, so a palette query that used to
 * find them still lands on the screen that absorbed them.
 */
export const adminNavigationGroups: AdminNavGroup[] = [
  {
    title: "",
    items: [
      {
        title: "nav.dashboard",
        href: "/admin",
        icon: LayoutDashboard,
        description: "nav.dashboardDescription",
        permissions: overviewPermissions,
        workspaceAdminVisible: true,
      },
      {
        title: "nav.tournaments",
        href: "/admin/tournaments",
        icon: Trophy,
        description: "nav.tournamentsDescription",
        permissions: ["tournament.read"],
      },
    ],
  },
  {
    title: "nav.data",
    items: [
      {
        title: "nav.people",
        href: "/admin/people",
        icon: UserCircle,
        description: "nav.peopleDescription",
        // `player.read`'s cross-tournament table became the Participations tab
        // of a person's card, so the old /admin/players aliases live here now.
        aliases: ["identities", "discord", "battletag", "twitch", "players", "participations"],
        permissions: ["user.read"],
        // Workspace-grantable read: `user.read` is in the workspace catalog (a
        // workspace `member` holds it, `admin`/`owner` hold all of `user.*`), and
        // the backend list gate takes `workspace_id` as both the authorization
        // scope and the row filter (`users_admin._scope`), so an owner sees their
        // own roster's identities. Writes to the global identity still demand a
        // GLOBAL grant, which is why the page gates its actions on `hasPermission`.
      },
      {
        title: "nav.ranks",
        href: "/admin/ranks",
        icon: Gauge,
        description:
          "nav.ranksDescription",
        // "rank" belongs to Collectors; aliases are unique across the sidebar.
        aliases: ["canon", "author ranks", "hidden rating", "effective", "sr", "mmr"],
        // `team.update`, not `rank.read`: the table exposes each organiser's
        // private book and the seeding weight of the roster, which is the
        // roster owner's data. The endpoint gates on the same grant.
        permissions: ["team.update"],
      },
      {
        title: "nav.teams",
        href: "/admin/teams",
        icon: Users,
        description: "nav.teamsDescription",
        permissions: ["team.read"],
      },
      {
        title: "nav.matches",
        href: "/admin/matches",
        icon: Swords,
        description:
          "nav.matchesDescription",
        aliases: ["encounters", "match reports", "parsed maps", "logs", "results"],
        views: [
          { key: "encounters", label: "nav.encounters", href: "/admin/matches?view=encounters" },
          { key: "standings", label: "nav.standings", href: "/admin/matches?view=standings" },
          { key: "reports", label: "nav.reports", href: "/admin/matches?view=reports" },
          { key: "parsed", label: "nav.parsedMaps", href: "/admin/matches?view=parsed" },
          { key: "logs", label: "nav.logs", href: "/admin/matches?view=logs" },
        ],
        permissions: ["match.read"],
      },
      {
        title: "nav.achievements",
        href: "/admin/achievements",
        icon: Award,
        description: "nav.achievementsDescription",
        permissions: ["achievement.read"],
      },
    ],
  },
  {
    title: "nav.workspace",
    items: [
      {
        title: "nav.settings",
        href: "/admin/settings",
        activePrefix: "/admin/settings",
        icon: Settings2,
        description:
          "nav.settingsDescription",
        aliases: [
          "divisions",
          "balancer",
          "statuses",
          "subroles",
          "sub-roles",
          "main tank",
          "off tank",
          "flex",
          "branding",
          "domain",
          "entitlements",
          "subscription providers",
        ],
        views: [
          { key: "overview", label: "nav.overview", href: "/admin/settings" },
          { key: "general", label: "nav.general", href: "/admin/settings/general" },
          { key: "branding", label: "nav.branding", href: "/admin/settings/branding" },
          { key: "visibility", label: "nav.visibilitySeo", href: "/admin/settings/visibility" },
          { key: "domain", label: "nav.domain", href: "/admin/settings/domain" },
          { key: "discord", label: "nav.discord", href: "/admin/settings/discord" },
          { key: "divisions", label: "nav.divisions", href: "/admin/settings/divisions" },
          { key: "statuses", label: "nav.balancerStatuses", href: "/admin/settings/statuses" },
          { key: "sub-roles", label: "nav.subRoles", href: "/admin/settings/sub-roles" },
          { key: "subscriptions", label: "nav.subscriptions", href: "/admin/settings/subscriptions" },
        ],
        workspaceAdminVisible: true,
      },
      {
        title: "nav.members",
        href: "/admin/members",
        icon: UserCog,
        description: "nav.membersDescription",
        workspaceAdminVisible: true,
      },
    ],
  },
  {
    title: "nav.platform",
    items: [
      {
        title: "nav.gameContent",
        href: "/admin/content/heroes",
        activePrefix: "/admin/content",
        icon: Gamepad2,
        description: "nav.gameContentDescription",
        aliases: [
          "heroes",
          "champions",
          "characters",
          "maps",
          "gamemodes",
          "modes",
          "unresolved names",
          "log names",
          "translations",
          "alias queue",
        ],
        views: [
          { key: "heroes", label: "nav.characters", href: "/admin/content/heroes" },
          { key: "maps", label: "nav.maps", href: "/admin/content/maps" },
          { key: "gamemodes", label: "nav.modes", href: "/admin/content/gamemodes" },
          { key: "unresolved", label: "nav.unresolvedNames", href: "/admin/content/unresolved" },
        ],
        superuserOnly: true,
      },
      {
        title: "nav.collectors",
        href: "/admin/collectors/rank",
        activePrefix: "/admin/collectors",
        icon: Activity,
        description: "nav.collectorsDescription",
        // `canAccessAdminRoute` treats a permission list as OR
        // (`permissions.some`, `hooks/usePermissions.ts`), so one entry covers
        // all three collectors. `globalOnly` belongs to the streams prefix in
        // `adminRoutePermissions`, not to this menu entry: a workspace-scoped
        // `rank.read` holder still has a collector to look at.
        aliases: ["rank", "subscriptions", "boosty", "streams", "poller", "live", "overfast"],
        views: [
          { key: "rank", label: "nav.ranks", href: "/admin/collectors/rank" },
          { key: "subscriptions", label: "nav.subscriptions", href: "/admin/collectors/subscriptions" },
          { key: "streams", label: "nav.streams", href: "/admin/collectors/streams" },
        ],
        permissions: ["rank.read", "subscription.read", "stream.read"],
      },
      {
        title: "nav.access",
        href: "/admin/access",
        activePrefix: "/admin/access",
        icon: Shield,
        description: "nav.accessDescription",
        aliases: ["staff", "roles", "permissions", "api keys", "sessions", "oauth", "accounts"],
        views: accessSectionViews,
        permissions: accessAdminPermissions,
        workspaceAdminVisible: true,
      },
      {
        title: "nav.workspaces",
        href: "/admin/workspaces",
        icon: Building2,
        description: "nav.workspacesDescription",
        workspaceAdminVisible: true,
      },
      {
        title: "nav.announcements",
        href: "/admin/announcements",
        icon: Megaphone,
        description:
          "nav.announcementsDescription",
        aliases: ["announcement", "banner", "notice", "broadcast"],
        permissions: ["announcement.read"],
        workspaceAdminVisible: true,
      },
      {
        title: "nav.notifications",
        href: "/admin/notifications",
        icon: Bell,
        description:
          "nav.notificationsDescription",
        aliases: ["notification", "inbox", "retire", "registration approved"],
        permissions: ["notification.read"],
        workspaceAdminVisible: true,
      },
      {
        title: "nav.auditLog",
        href: "/admin/audit",
        icon: History,
        description:
          "nav.auditLogDescription",
        aliases: ["audit", "who changed this", "change log", "trail"],
        permissions: ["audit.read"],
        workspaceAdminVisible: true,
      },
    ],
  },
];

/**
 * Per-prefix gate for the route guard in `AdminLayoutClient`.
 *
 * Denser than the menu: one menu entry can own several routes with different
 * gates (Collectors' `streams` is global, its siblings are workspace-scoped).
 * First match wins and matching is exact-or-slash, so a more specific prefix
 * MUST precede the section it lives in.
 *
 * Every prefix here names a route that exists. The old ones lived alongside
 * the new ones through the migration, because dropping a prefix before its
 * screen would silently hand the surviving page the `/admin` catch-all gate
 * (`/admin/heroes` would have lost `superuserOnly`); the last of them left
 * with P5.
 */
const adminRoutePermissions: Array<{
  prefix: string;
  permissions: AppPermission[];
  superuserOnly?: boolean;
  workspaceAdminVisible?: boolean;
  globalOnly?: boolean;
}> = [
  // ── Access (per-tab gates; `accounts` replaces `users`) ──
  { prefix: "/admin/access/accounts", permissions: accessUsersPermissions, globalOnly: true },
  { prefix: "/admin/access/roles", permissions: accessRolesPermissions, workspaceAdminVisible: true },
  { prefix: "/admin/access/oauth", permissions: accessUsersPermissions, globalOnly: true },
  { prefix: "/admin/access/api-keys", permissions: accessApiKeysPermissions, workspaceAdminVisible: true },
  { prefix: "/admin/access/sessions", permissions: [], superuserOnly: true },
  { prefix: "/admin/access/permissions", permissions: accessPermissionsPermissions, globalOnly: true },
  { prefix: "/admin/access", permissions: accessAdminPermissions, workspaceAdminVisible: true },

  // ── Workspace settings hub (sections keep the gate of the screen they replace) ──
  { prefix: "/admin/settings/statuses", permissions: ["team.read"] },
  { prefix: "/admin/settings/sub-roles", permissions: ["player.read"] },
  { prefix: "/admin/settings", permissions: [], workspaceAdminVisible: true },
  { prefix: "/admin/members", permissions: [], workspaceAdminVisible: true },

  // ── Platform ──
  { prefix: "/admin/content", permissions: [], superuserOnly: true },
  // One poller, one Redis key: `GET /api/v1/streams/health` authorizes against a
  // GLOBAL `stream.read`, so a workspace-scoped holder must not reach it.
  { prefix: "/admin/collectors/streams", permissions: ["stream.read"], globalOnly: true },
  { prefix: "/admin/collectors/subscriptions", permissions: ["subscription.read"] },
  { prefix: "/admin/collectors/rank", permissions: ["rank.read"] },
  {
    prefix: "/admin/collectors",
    permissions: ["rank.read", "subscription.read", "stream.read"],
  },

  // ── Data browsers ──
  { prefix: "/admin/people", permissions: ["user.read"] },
  { prefix: "/admin/ranks", permissions: ["team.update"] },
  { prefix: "/admin/tournaments", permissions: ["tournament.read"] },
  { prefix: "/admin/teams", permissions: ["team.read"] },
  { prefix: "/admin/matches", permissions: ["match.read"] },
  { prefix: "/admin/achievements", permissions: ["achievement.read"] },
  // Reading the feed is the gate; publishing to it is a second grant the page
  // asks for separately, and a platform-wide one needs the superuser besides.
  { prefix: "/admin/announcements", permissions: ["announcement.read"], workspaceAdminVisible: true },
  // Retiring is a second grant the page asks for separately, exactly like
  // publishing an announcement.
  { prefix: "/admin/notifications", permissions: ["notification.read"], workspaceAdminVisible: true },
  { prefix: "/admin/audit", permissions: ["audit.read"], workspaceAdminVisible: true },
  { prefix: "/admin/workspaces", permissions: [], workspaceAdminVisible: true },

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
 * The gate arguments for a pathname, ready for `canAccessAdminRoute`.
 *
 * The route table is the single source of truth for who may open what, so the
 * layout guard, the Access landing redirect and the command palette all ask it
 * the same way — a link one of them offers and the guard rejects is a dead end.
 */
export function adminRouteAccessOptions(
  pathname: string,
  currentWorkspaceId: number | null,
): {
  permissions: AppPermission[];
  workspaceId: number | null;
  globalOnly?: boolean;
  workspaceAdminVisible?: boolean;
  superuserOnly?: boolean;
} {
  const route = getMatchingAdminRoute(pathname);
  if (!route) {
    return { permissions: adminEntryPermissions, workspaceId: currentWorkspaceId };
  }
  return {
    permissions: route.permissions,
    workspaceId: route.workspaceAdminVisible ? null : currentWorkspaceId,
    globalOnly: route.globalOnly,
    workspaceAdminVisible: route.workspaceAdminVisible,
    superuserOnly: route.superuserOnly,
  };
}

/**
 * Given the visible nav items, returns the href of the one that best matches
 * the pathname (longest prefix). This prevents parent routes from being active
 * when a more specific child route matches. An item whose `href` points at a
 * landing section is matched on its `activePrefix` instead.
 */
export function getActiveAdminNavHref(
  pathname: string,
  items: ReadonlyArray<Pick<AdminNavItem, "href" | "activePrefix">>,
): string | null {
  let best: { href: string; length: number } | null = null;
  for (const item of items) {
    const prefix = item.activePrefix ?? item.href;
    if (prefix === "/admin") {
      if (pathname === "/admin") best = { href: item.href, length: prefix.length };
      continue;
    }
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best.length) {
        best = { href: item.href, length: prefix.length };
      }
    }
  }
  return best?.href ?? null;
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
