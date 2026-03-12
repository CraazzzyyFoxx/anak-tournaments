"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, LayoutDashboard } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  getVisibleAdminNavigationGroups,
  isAdminNavItemActive,
} from "@/components/admin/admin-navigation";
import { SITE_FAVICON, SITE_NAME } from "@/config/site";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { usePermissions } from "@/hooks/usePermissions";

function getRoleLabel({
  isSuperuser,
  isAdmin,
  isOrganizer,
  isModerator,
}: {
  isSuperuser: boolean;
  isAdmin: boolean;
  isOrganizer: boolean;
  isModerator: boolean;
}) {
  if (isSuperuser) return "Superuser";
  if (isAdmin) return "Admin";
  if (isOrganizer) return "Organizer";
  if (isModerator) return "Moderator";
  return "Operator";
}

function getInitials(username?: string | null) {
  if (!username) return "AQ";
  return username.slice(0, 2).toUpperCase();
}

export function AdminSidebar() {
  const pathname = usePathname();
  const { user } = useAuthProfile();
  const { hasAnyPermission, isSuperuser, isAdmin, isOrganizer, isModerator } = usePermissions();

  const navigationGroups = getVisibleAdminNavigationGroups(isSuperuser, hasAnyPermission);
  const adminToolsGroup = navigationGroups.find((group) => group.title === "Administration");
  const primaryGroups = navigationGroups.filter((group) => group.title !== "Administration" && group.title !== "Overview");
  const roleLabel = getRoleLabel({ isSuperuser, isAdmin, isOrganizer, isModerator });
  const profileHref = user?.username ? `/users/${user.username}` : "/users";

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="border-b border-sidebar-border/70 px-2.5 py-2.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="h-11 rounded-xl bg-sidebar-accent/70 px-2.5 hover:bg-sidebar-accent">
              <Link href="/admin">
                <div className="flex size-9 items-center justify-center rounded-lg bg-sidebar/80 text-sidebar-foreground">
                  <Image
                    src={SITE_FAVICON}
                    alt={SITE_NAME}
                    width={22}
                    height={22}
                    unoptimized
                    className="size-[22px] object-contain"
                  />
                </div>
                <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-semibold text-sidebar-foreground">Admin</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/60">{roleLabel}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/admin"}
              tooltip="Dashboard"
              className="h-9 rounded-lg px-2.5 text-sidebar-foreground/78 hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]"
            >
              <Link href="/admin">
                <LayoutDashboard />
                <span>Dashboard</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {primaryGroups.map((group) => (
          <SidebarGroup key={group.title} className="px-0 py-0.5">
            <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-[0.22em] text-sidebar-foreground/38">
              {group.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = isAdminNavItemActive(pathname, item.href);

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                        className="h-9 rounded-lg px-2.5 text-sidebar-foreground/78 hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]"
                      >
                        <Link href={item.href}>
                          <item.icon />
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

      <SidebarFooter className="border-t border-sidebar-border/70 px-2 py-2.5">
        {adminToolsGroup ? (
          <div className="flex flex-col gap-1.5 group-data-[collapsible=icon]:gap-0">
            <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-[0.22em] text-sidebar-foreground/38 group-data-[collapsible=icon]:hidden">
              {adminToolsGroup.title}
            </SidebarGroupLabel>
            <SidebarMenu>
              {adminToolsGroup.items.map((item) => {
                const isActive = isAdminNavItemActive(pathname, item.href);

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      size="sm"
                      isActive={isActive}
                      tooltip={item.title}
                      className="rounded-lg text-sidebar-foreground/72 hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
            <SidebarSeparator className="my-1.5" />
          </div>
        ) : null}

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={user?.username ?? "Profile"} className="h-11 rounded-lg px-2.5 text-sidebar-foreground/82">
              <Link href={profileHref}>
                <Avatar className="size-7 rounded-lg">
                  <AvatarImage src={user?.avatarUrl ?? undefined} alt={user?.username ?? "Admin user"} />
                  <AvatarFallback className="rounded-lg">{getInitials(user?.username)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-medium text-sidebar-foreground">{user?.username ?? "Admin user"}</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/58">{roleLabel} workspace</span>
                </div>
                <ArrowUpRight className="ml-auto size-4 text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
