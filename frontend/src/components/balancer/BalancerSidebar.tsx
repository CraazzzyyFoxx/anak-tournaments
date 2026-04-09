"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, ChevronsUpDown, Trophy } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { balancerNavigationItems, isBalancerNavItemActive } from "@/components/balancer/balancer-navigation";
import { SITE_FAVICON, SITE_NAME } from "@/config/site";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { usePermissions } from "@/hooks/usePermissions";
import tournamentService from "@/services/tournament.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types/workspace.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRoleLabel({ isSuperuser, isAdmin, isOrganizer }: { isSuperuser: boolean; isAdmin: boolean; isOrganizer: boolean }) {
  if (isSuperuser) return "Superuser";
  if (isAdmin) return "Admin";
  if (isOrganizer) return "Organizer";
  return "Operator";
}

function getInitials(name?: string | null) {
  if (!name) return "AQ";
  return name.slice(0, 2).toUpperCase();
}

function getWorkspaceInitials(name: string): string {
  return name
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

const FALLBACK_COLORS = [
  "bg-violet-600",
  "bg-blue-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-indigo-600",
  "bg-pink-600",
];

// ---------------------------------------------------------------------------
// WorkspaceSwitcher (sidebar-embedded)
// ---------------------------------------------------------------------------

function SidebarWorkspaceSwitcher() {
  const { workspaces, currentWorkspaceId, fetchWorkspaces, setCurrentWorkspace } = useWorkspaceStore();

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const current = workspaces.find((w) => w.id === currentWorkspaceId);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-11 rounded-xl bg-sidebar-accent/70 px-2.5 hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
            >
              {current?.icon_url ? (
                <Avatar className="size-8 rounded-lg">
                  <AvatarImage src={current.icon_url} alt={current.name} />
                  <AvatarFallback
                    className={cn(
                      "rounded-lg text-white font-semibold text-xs",
                      FALLBACK_COLORS[current.id % FALLBACK_COLORS.length],
                    )}
                  >
                    {getWorkspaceInitials(current.name)}
                  </AvatarFallback>
                </Avatar>
              ) : current ? (
                <div
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg text-white font-semibold text-xs",
                    FALLBACK_COLORS[current.id % FALLBACK_COLORS.length],
                  )}
                >
                  {getWorkspaceInitials(current.name)}
                </div>
              ) : (
                <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar/80">
                  <Image src={SITE_FAVICON} alt={SITE_NAME} width={20} height={20} unoptimized className="size-5 object-contain" />
                </div>
              )}
              <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-semibold text-sidebar-foreground">
                  {current?.name ?? "Balancer"}
                </span>
                <span className="truncate text-[11px] text-sidebar-foreground/60">Workspace</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
            side="bottom"
            align="start"
            sideOffset={6}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
            {workspaces.map((ws) => {
              const isActive = ws.id === currentWorkspaceId;
              return (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => setCurrentWorkspace(ws.id)}
                  className="gap-2.5 px-2 py-1.5"
                >
                  {ws.icon_url ? (
                    <Avatar className="size-5 rounded-md">
                      <AvatarImage src={ws.icon_url} alt={ws.name} />
                      <AvatarFallback
                        className={cn(
                          "rounded-md text-white font-semibold text-[10px]",
                          FALLBACK_COLORS[ws.id % FALLBACK_COLORS.length],
                        )}
                      >
                        {getWorkspaceInitials(ws.name)}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div
                      className={cn(
                        "flex size-5 items-center justify-center rounded-md text-white font-semibold text-[10px]",
                        FALLBACK_COLORS[ws.id % FALLBACK_COLORS.length],
                      )}
                    >
                      {getWorkspaceInitials(ws.name)}
                    </div>
                  )}
                  <span className="flex-1 truncate text-sm font-medium">{ws.name}</span>
                  {isActive && <Check className="size-4 shrink-0" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ---------------------------------------------------------------------------
// TournamentSwitcher (sidebar-embedded)
// ---------------------------------------------------------------------------

function SidebarTournamentSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const raw = searchParams.get("tournament");
  const selectedId = raw ? Number(raw) : null;
  const validSelectedId = selectedId && Number.isFinite(selectedId) ? selectedId : null;

  const tournamentsQuery = useQuery({
    queryKey: ["balancer-public", "tournaments"],
    queryFn: () => tournamentService.getAll(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const tournaments = tournamentsQuery.data?.results ?? [];
  const current = tournaments.find((t) => t.id === validSelectedId);

  const handleSelect = (id: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id === validSelectedId) {
      params.delete("tournament");
    } else {
      params.set("tournament", String(id));
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-10 rounded-lg px-2.5 text-sidebar-foreground/78 hover:text-sidebar-foreground"
            >
              <Trophy className="size-4 shrink-0" />
              <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium text-sidebar-foreground">
                  {current?.name ?? "Select tournament"}
                </span>
                {current && (
                  <span className="truncate text-[11px] text-sidebar-foreground/55">
                    #{current.id}
                  </span>
                )}
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 max-h-80 overflow-y-auto"
            side="bottom"
            align="start"
            sideOffset={6}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Tournaments</DropdownMenuLabel>
            {tournaments.length === 0 && (
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                No tournaments found
              </DropdownMenuItem>
            )}
            {tournaments.map((t) => {
              const isActive = t.id === validSelectedId;
              return (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => handleSelect(t.id)}
                  className="gap-2.5 px-2 py-1.5"
                >
                  <Trophy className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-sm">{t.name}</span>
                  {isActive && <Check className="size-4 shrink-0" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ---------------------------------------------------------------------------
// Main sidebar
// ---------------------------------------------------------------------------

export function BalancerSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuthProfile();
  const { isSuperuser, isAdmin, isOrganizer } = usePermissions();

  const roleLabel = getRoleLabel({ isSuperuser, isAdmin, isOrganizer });
  const profileHref = user?.username ? `/users/${user.username}` : "/users";

  return (
    <Sidebar collapsible="icon" variant="inset">
      {/* Workspace switcher */}
      <SidebarHeader className="px-2.5 py-2.5 group-data-[collapsible=icon]:px-1">
        <SidebarWorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent className="px-2 py-0 group-data-[collapsible=icon]:px-1">
        {/* Tournament switcher */}
        <SidebarGroup className="py-2">
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/45 group-data-[collapsible=icon]:hidden">
            Tournament
          </SidebarGroupLabel>
          <SidebarTournamentSwitcher />
        </SidebarGroup>

        <SidebarSeparator />

        {/* Navigation */}
        <SidebarGroup className="py-2">
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/45 group-data-[collapsible=icon]:hidden">
            Navigation
          </SidebarGroupLabel>
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
        </SidebarGroup>
      </SidebarContent>

      {/* User footer */}
      <SidebarFooter className="border-t border-sidebar-border/70 px-2 py-2.5 group-data-[collapsible=icon]:px-1">
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
                  <span className="truncate text-[11px] text-sidebar-foreground/58">{roleLabel}</span>
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
