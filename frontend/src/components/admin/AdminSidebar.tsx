"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Trophy,
  Users,
  UserCircle,
  Swords,
  BarChart3,
  Settings,
  Shield,
  Map,
  Gamepad2,
  LayoutDashboard
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader
} from "@/components/ui/sidebar";
import { AppPermission, usePermissions } from "@/hooks/usePermissions";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permissions?: AppPermission[];
  superuserOnly?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
  superuserOnly?: boolean;
}

const overviewPermissions: AppPermission[] = [
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

const navigationGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        title: "Dashboard",
        href: "/admin",
        icon: LayoutDashboard,
        permissions: overviewPermissions,
      }
    ]
  },
  {
    title: "Operations",
    items: [
      {
        title: "Tournaments",
        href: "/admin/tournaments",
        icon: Trophy,
        permissions: ["tournament.read"],
      },
      {
        title: "Teams",
        href: "/admin/teams",
        icon: Users,
        permissions: ["team.read"],
      },
      {
        title: "Players",
        href: "/admin/players",
        icon: UserCircle,
        permissions: ["player.read"],
      },
      {
        title: "Encounters",
        href: "/admin/encounters",
        icon: Swords,
        permissions: ["match.read"],
      },
      {
        title: "Standings",
        href: "/admin/standings",
        icon: BarChart3,
        permissions: ["standing.read"],
      }
    ]
  },
  {
    title: "Game Content",
    items: [
      {
        title: "Heroes",
        href: "/admin/heroes",
        icon: Shield,
        permissions: ["hero.read"],
      },
      {
        title: "Gamemodes",
        href: "/admin/gamemodes",
        icon: Gamepad2,
        permissions: ["gamemode.read"],
      },
      {
        title: "Maps",
        href: "/admin/maps",
        icon: Map,
        permissions: ["map.read"],
      }
    ]
  },
  {
    title: "Data Management",
    items: [
      {
        title: "Player Identities",
        href: "/admin/users",
        icon: UserCircle,
        permissions: ["user.read"],
      }
    ]
  },
  {
    title: "Access",
    items: [
      {
        title: "Users",
        href: "/admin/access/users",
        icon: Users,
        superuserOnly: true,
      },
      {
        title: "Roles",
        href: "/admin/access/roles",
        icon: Shield,
        superuserOnly: true,
      },
      {
        title: "Permissions",
        href: "/admin/access/permissions",
        icon: Settings,
        superuserOnly: true,
      }
    ],
    superuserOnly: true,
  }
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { hasAnyPermission, isSuperuser } = usePermissions();

  const canSeeItem = (item: NavItem) => {
    if (item.superuserOnly) {
      return isSuperuser;
    }

    if (!item.permissions || item.permissions.length === 0) {
      return true;
    }

    return isSuperuser || hasAnyPermission(item.permissions);
  };

  // Filter groups and items based on permissions
  const filteredGroups = navigationGroups
    .filter((group) => !group.superuserOnly || isSuperuser)
    .map((group) => ({
      ...group,
      items: group.items.filter(canSeeItem)
    }))
    .filter((group) => group.items.length > 0);

  return (
    <Sidebar>
      <SidebarHeader className="border-b p-4">
        <h2 className="text-lg font-semibold">Admin Panel</h2>
      </SidebarHeader>
      <SidebarContent>
        {filteredGroups.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
