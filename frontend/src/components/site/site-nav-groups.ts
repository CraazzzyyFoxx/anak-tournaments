/**
 * The public site's navigation tree — the single definition.
 *
 * It is data-driven by stable keys; the visible text (group labels, item titles
 * and descriptions) is resolved from the `nav.*` message namespace at render
 * time, because module scope has no `t()`. `href` drives active-state matching,
 * `key` drives translation lookup.
 */

export type NavGroupKey = "tournaments" | "users" | "matches" | "organization";

export interface NavItem {
  key: string;
  href: string;
  requiresAdminAccess?: boolean;
}

export interface NavGroup {
  key: NavGroupKey;
  items: readonly NavItem[];
}

// Annotated rather than `as const satisfies`: `as const` narrows each item to a
// literal shape, so items without `requiresAdminAccess` lose the property and
// consumers cannot read it off the union.
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: "tournaments",
    items: [
      { key: "tournaments", href: "/tournaments" },
      { key: "teams", href: "/teams" },
      { key: "analytics", href: "/tournaments/analytics" }
    ]
  },
  {
    key: "users",
    items: [
      { key: "users", href: "/users" },
      { key: "compare", href: "/users/compare" },
      { key: "heroesLeaderboard", href: "/users/heroes-compare" },
      { key: "achievements", href: "/achievements" }
    ]
  },
  {
    key: "matches",
    items: [
      { key: "encounters", href: "/encounters" },
      { key: "matches", href: "/matches" }
    ]
  },
  {
    key: "organization",
    items: [{ key: "admin", href: "/admin", requiresAdminAccess: true }]
  }
];

export function isNavGroupActive(items: readonly { href: string }[], pathname: string): boolean {
  return items.some((item) => {
    if (item.href === "/") return pathname === "/";
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  });
}
