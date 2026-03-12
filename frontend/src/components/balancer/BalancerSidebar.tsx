"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { balancerNavigationItems, isBalancerNavItemActive } from "@/components/balancer/balancer-navigation";
import { SITE_FAVICON, SITE_NAME } from "@/config/site";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { usePermissions } from "@/hooks/usePermissions";

function getRoleLabel({ isSuperuser, isAdmin, isOrganizer }: { isSuperuser: boolean; isAdmin: boolean; isOrganizer: boolean }) {
  if (isSuperuser) return "Superuser";
  if (isAdmin) return "Admin";
  if (isOrganizer) return "Organizer";
  return "Operator";
}

function getInitials(username?: string | null) {
  if (!username) return "AQ";
  return username.slice(0, 2).toUpperCase();
}

export function BalancerSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuthProfile();
  const { isSuperuser, isAdmin, isOrganizer } = usePermissions();

  const roleLabel = getRoleLabel({ isSuperuser, isAdmin, isOrganizer });
  const profileHref = user?.username ? `/users/${user.username}` : "/users";

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="border-b border-sidebar-border/70 px-2.5 py-2.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="h-11 rounded-xl bg-sidebar-accent/70 px-2.5 hover:bg-sidebar-accent">
              <Link href="/balancer">
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
                  <span className="truncate text-sm font-semibold text-sidebar-foreground">Balancer</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/60">{roleLabel}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2.5">
        <SidebarMenu>
          {balancerNavigationItems.map((item) => {
            const isActive = isBalancerNavItemActive(pathname, item.href);
            const query = searchParams.toString();
            const href = query ? `${item.href}?${query}` : item.href;

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={item.title}
                  className="h-9 rounded-lg px-2.5 text-sidebar-foreground/78 hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]"
                >
                  <Link href={href}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70 px-2 py-2.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={user?.username ?? "Profile"} className="h-11 rounded-lg px-2.5 text-sidebar-foreground/82">
              <Link href={profileHref}>
                <Avatar className="size-7 rounded-lg">
                  <AvatarImage src={user?.avatarUrl ?? undefined} alt={user?.username ?? "User"} />
                  <AvatarFallback className="rounded-lg">{getInitials(user?.username)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-medium text-sidebar-foreground">{user?.username ?? "User"}</span>
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
