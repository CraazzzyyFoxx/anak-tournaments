import { ArrowLeftRight, ClipboardList, type LucideIcon, Users } from "lucide-react";

import type { AppRole } from "@/hooks/usePermissions";

export type BalancerNavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
};

export const balancerEntryRoles: AppRole[] = ["admin", "tournament_organizer"];

export const balancerNavigationItems: BalancerNavItem[] = [
  {
    title: "Workspace",
    href: "/balancer",
    icon: ArrowLeftRight,
    description: "Run balance candidates, tweak rosters, and export.",
  },
  {
    title: "Applications",
    href: "/balancer/applications",
    icon: ClipboardList,
    description: "Review and manage tournament applications.",
  },
  {
    title: "Player Pool",
    href: "/balancer/pool",
    icon: Users,
    description: "Curate the player pool for balancing.",
  },
];

export function isBalancerNavItemActive(pathname: string, href: string) {
  if (href === "/balancer") {
    return pathname === "/balancer";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
