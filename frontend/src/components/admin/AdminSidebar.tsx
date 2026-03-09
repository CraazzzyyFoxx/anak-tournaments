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
  Award,
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
import { usePermissions } from "@/hooks/usePermissions";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
  adminOnly?: boolean;
}

const navigationGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        title: "Dashboard",
        href: "/admin",
        icon: LayoutDashboard
      }
    ]
  },
  {
    title: "Tournament Operations",
    items: [
      {
        title: "Tournaments",
        href: "/admin/tournaments",
        icon: Trophy
      },
      {
        title: "Teams",
        href: "/admin/teams",
        icon: Users
      },
      {
        title: "Players",
        href: "/admin/players",
        icon: UserCircle
      },
      {
        title: "Encounters",
        href: "/admin/encounters",
        icon: Swords
      },
      {
        title: "Standings",
        href: "/admin/standings",
        icon: BarChart3
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
        adminOnly: true
      },
      {
        title: "Gamemodes",
        href: "/admin/gamemodes",
        icon: Gamepad2,
        adminOnly: true
      },
      {
        title: "Maps",
        href: "/admin/maps",
        icon: Map,
        adminOnly: true
      }
    ],
    adminOnly: true
  },
  {
    title: "Data Management",
    items: [
      {
        title: "Users",
        href: "/admin/users",
        icon: UserCircle,
        adminOnly: true
      },
      {
        title: "Achievements",
        href: "/admin/achievements",
        icon: Award,
        adminOnly: true
      }
    ],
    adminOnly: true
  },
  {
    title: "System",
    items: [
      {
        title: "Settings",
        href: "/admin/settings",
        icon: Settings,
        adminOnly: true
      }
    ],
    adminOnly: true
  }
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { isAdmin } = usePermissions();

  // Filter groups and items based on permissions
  const filteredGroups = navigationGroups
    .filter((group) => !group.adminOnly || isAdmin)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.adminOnly || isAdmin)
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
                  const isActive = pathname === item.href;
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
