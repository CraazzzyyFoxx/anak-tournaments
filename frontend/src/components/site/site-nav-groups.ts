import {
  ChartColumn,
  Crown,
  Layers,
  ListOrdered,
  Shuffle,
  Swords,
  Trophy,
  Users,
  type LucideIcon
} from "lucide-react";

import type { DisciplineCapabilities, DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The public site's navigation tree — the single definition.
 *
 * Data-driven by stable keys; the visible text (group labels, item titles and
 * the one-line descriptions under them) is resolved from the `nav.*` message
 * namespace at render time, because module scope has no `t()`. `href` drives
 * current-page matching, `key` drives translation lookup.
 *
 * Two shapes: `NAV_GROUPS` are the disclosure menus (header dropdown, sheet
 * group), `NAV_LINKS` are the flat links that sit beside them. Every entry is
 * public — the admin entry is permission-gated and lives in the account menu.
 * An entry that `requires` a game capability is offered only while some game
 * of the viewed scope declares it (`navItemAvailable`).
 */

type NavGroupKey = "tournaments" | "users";

export interface NavItem {
  key: string;
  href: string;
  icon: LucideIcon;
  /** A game capability the page needs (e.g. `analytics`): without a game declaring it, the page has nothing to show. */
  requires?: keyof DisciplineCapabilities;
}

export interface NavGroup {
  key: NavGroupKey;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: "tournaments",
    items: [
      { key: "tournaments", href: "/tournaments", icon: Trophy },
      { key: "encounters", href: "/encounters", icon: Swords },
      { key: "analytics", href: "/tournaments/analytics", icon: ChartColumn, requires: "analytics" }
    ]
  },
  {
    key: "users",
    items: [
      { key: "users", href: "/users", icon: Users },
      { key: "compare", href: "/users/compare", icon: Layers },
      { key: "heroesLeaderboard", href: "/users/heroes-compare", icon: ListOrdered },
      { key: "achievements", href: "/achievements", icon: Crown }
    ]
  }
];

/**
 * What a player joins or hosts rather than browses. Viewing a mix is public,
 * so it hangs off no section.
 */
export const NAV_LINKS: readonly NavItem[] = [
  { key: "mixes", href: "/balancer/mix", icon: Shuffle }
];

/**
 * Whether a nav entry is offered for the viewed scope's games: an entry without `requires` always is; one with it
 * while some enabled game declares that capability. An unknown list (`undefined`: still loading, or failed) keeps
 * the entry — absence is only concluded from a loaded list.
 */
export function navItemAvailable(
  item: Pick<NavItem, "requires">,
  games: readonly Pick<DisciplineDescriptor, "enabled" | "capabilities">[] | undefined
): boolean {
  const capability = item.requires;
  if (!capability || games === undefined) return true;
  return games.some((game) => game.enabled && game.capabilities[capability]);
}

/**
 * The href of the item the reader is on: the longest item href that is the
 * path itself or a parent of it. Longest, because `/tournaments/analytics`
 * sits under `/tournaments` and `/users/compare` under `/users` — a plain
 * prefix test would mark both as current. A detail page (`/tournaments/x`)
 * resolves to its list page.
 */
export function currentNavHref(pathname: string): string | undefined {
  let current: string | undefined;
  for (const { href } of [...NAV_GROUPS.flatMap((group) => group.items), ...NAV_LINKS]) {
    const within = pathname === href || pathname.startsWith(`${href}/`);
    if (within && href.length > (current?.length ?? 0)) current = href;
  }
  return current;
}
