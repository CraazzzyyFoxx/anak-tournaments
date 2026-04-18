"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, ChevronsUpDown, LogOut, Search } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  getActiveAdminNavHref,
  getVisibleAdminNavigationGroups,
} from "@/components/admin/admin-navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdminCommandPalette, useCommandPalette } from "@/components/admin/AdminCommandPalette";
import { SITE_FAVICON, SITE_NAME } from "@/config/site";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { usePermissions } from "@/hooks/usePermissions";
import { WorkspaceAvatar } from "@/components/WorkspaceSwitcher";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { cn } from "@/lib/utils";

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
  const { canAccessAdminRoute, isSuperuser, isAdmin, isOrganizer, isModerator } = usePermissions();

  const { workspaces, currentWorkspaceId, setCurrentWorkspace } = useWorkspaceStore();
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);

  const navigationGroups = getVisibleAdminNavigationGroups((item) =>
    canAccessAdminRoute({
      permissions: item.permissions,
      workspaceId: item.workspaceAdminVisible ? null : currentWorkspaceId,
      globalOnly: item.globalOnly,
      workspaceAdminVisible: item.workspaceAdminVisible,
      superuserOnly: item.superuserOnly,
    }),
  );
  const adminToolsGroup = navigationGroups.find((group) => group.title === "Administration");
  const primaryGroups = navigationGroups.filter(
    (group) => group.title !== "Administration" && group.title !== "Overview",
  );
  const roleLabel = getRoleLabel({ isSuperuser, isAdmin, isOrganizer, isModerator });
  const profileHref = user?.username ? `/users/${user.username}` : "/users";
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandPalette();

  const allHrefs = navigationGroups.flatMap((g) => g.items.map((i) => i.href));
  const activeHref = getActiveAdminNavHref(pathname, allHrefs);

  return (
    <Sidebar collapsible="icon" variant="inset">
      {/* ── HEADER: Logo + search hint ─────────────────── */}
      <SidebarHeader className="px-3 pt-3 pb-2 group-data-[collapsible=icon]:px-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              className="h-9 rounded-lg px-2 hover:bg-transparent group-data-[collapsible=icon]:justify-center"
            >
              <Link href="/admin">
                {currentWorkspace?.icon_url ? (
                  <div className="flex size-7 items-center justify-center">
                    <Image
                      src={currentWorkspace.icon_url}
                      alt={currentWorkspace.name}
                      width={20}
                      height={20}
                      unoptimized
                      className="size-5 rounded-md object-contain"
                    />
                  </div>
                ) : currentWorkspace ? (
                  <WorkspaceAvatar workspace={currentWorkspace} size="md" />
                ) : (
                  <div className="flex size-7 items-center justify-center">
                    <Image
                      src={SITE_FAVICON}
                      alt={SITE_NAME}
                      width={20}
                      height={20}
                      unoptimized
                      className="size-5 object-contain"
                    />
                  </div>
                )}
                <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                  {currentWorkspace?.name ?? SITE_NAME}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* Search trigger */}
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="mt-1 flex h-8 w-full items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 px-2.5 text-[12px] text-sidebar-foreground/35 transition-colors hover:border-sidebar-border hover:text-sidebar-foreground/50 cursor-pointer group-data-[collapsible=icon]:hidden"
        >
          <Search className="size-3.5 shrink-0" />
          <span>Search...</span>
          <kbd className="ml-auto rounded border border-sidebar-border/70 bg-sidebar/80 px-1 py-0.5 text-[10px] font-medium leading-none text-sidebar-foreground/30">
            /
          </kbd>
        </button>
      </SidebarHeader>

      {/* ── NAVIGATION ─────────────────────────────────── */}
      <SidebarContent className="px-2 pt-1 group-data-[collapsible=icon]:px-1">
        {primaryGroups.map((group, groupIndex) => (
          <SidebarGroup key={group.title} className="px-0 py-0">
            {/* Group divider — thin line between groups, not before first */}
            {groupIndex > 0 && (
              <div className="mx-2 my-2 h-px bg-sidebar-border/40 group-data-[collapsible=icon]:mx-1" />
            )}

            {/* Group label — subtle, lowercase-style */}
            <div className="flex items-center gap-2 px-3 py-1.5 group-data-[collapsible=icon]:hidden">
              <span className="text-[11px] font-medium text-sidebar-foreground/30">
                {group.title}
              </span>
            </div>

            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = item.href === activeHref;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                        className={cn(
                          "relative h-[30px] rounded-md px-2.5 text-[13px] transition-all",
                          "text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
                          isActive && [
                            "bg-sidebar-accent text-sidebar-foreground font-medium",
                            // Left accent bar
                            "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2",
                            "before:h-4 before:w-[2px] before:rounded-full before:bg-sidebar-primary",
                          ],
                        )}
                      >
                        <Link href={item.href}>
                          <item.icon className={cn("size-5", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/40")} />
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

      {/* ── FOOTER: Admin tools + user ─────────────────── */}
      <SidebarFooter className="px-2 pb-2 pt-0 group-data-[collapsible=icon]:px-1">
        {/* Administration links — compact, dimmer */}
        {adminToolsGroup && (
          <>
            <div className="mx-2 mb-1.5 h-px bg-sidebar-border/40" />
            <SidebarMenu>
              {adminToolsGroup.items.map((item) => {
                const isActive = item.href === activeHref;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      size="sm"
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(
                        "relative h-[28px] rounded-md px-2.5 text-[12px]",
                        "text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/40",
                        isActive && [
                          "bg-sidebar-accent/60 text-sidebar-foreground/80 font-medium",
                          "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2",
                          "before:h-3 before:w-[2px] before:rounded-full before:bg-sidebar-primary/70",
                        ],
                      )}
                    >
                      <Link href={item.href}>
                        <item.icon className={cn("size-4.5", isActive ? "text-sidebar-primary/70" : "text-sidebar-foreground/30")} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </>
        )}

        {/* Back to site */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="sm"
              tooltip="Back to site"
              className="h-7 rounded-md px-2.5 text-[12px] text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/40"
            >
              <Link href="/">
                <ArrowLeft className="size-4 text-sidebar-foreground/30" />
                <span>Back to site</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* User profile — Clerk-style with workspace in dropdown */}
        <div className="mt-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    tooltip={user?.username ?? "Profile"}
                    className="h-12 rounded-lg px-2 hover:bg-sidebar-accent/60 data-[state=open]:bg-sidebar-accent/60"
                  >
                    <Avatar className="size-8 rounded-lg ring-1 ring-sidebar-border/60">
                      <AvatarImage src={user?.avatarUrl ?? undefined} alt={user?.username ?? "Admin"} />
                      <AvatarFallback className="rounded-lg bg-sidebar-accent text-[11px] font-medium text-sidebar-foreground/60">
                        {getInitials(user?.username)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                      <span className="truncate text-[13px] font-medium text-sidebar-foreground">
                        {user?.username ?? "Admin"}
                      </span>
                      <span className="truncate text-[11px] text-sidebar-foreground/40">
                        {roleLabel}
                        {currentWorkspace ? ` · ${currentWorkspace.name}` : ""}
                      </span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-3.5 text-sidebar-foreground/25 group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="start" side="top" className="w-64 p-1.5">
                  {/* User info header */}
                  <div className="flex items-center gap-2.5 px-2 py-2">
                    <Avatar className="size-9 rounded-lg ring-1 ring-border/60">
                      <AvatarImage src={user?.avatarUrl ?? undefined} />
                      <AvatarFallback className="rounded-lg text-xs">{getInitials(user?.username)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-[13px] font-medium">{user?.username ?? "Admin"}</span>
                      <span className="text-[11px] text-muted-foreground">{roleLabel}</span>
                    </div>
                  </div>

                  <DropdownMenuSeparator />

                  {/* Profile link */}
                  <DropdownMenuItem asChild className="h-8 rounded-md text-[13px]">
                    <Link href={profileHref}>
                      <ArrowUpRight className="size-3.5 text-muted-foreground" />
                      View Profile
                    </Link>
                  </DropdownMenuItem>

                  {/* Workspace switcher */}
                  {workspaces.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 px-2 py-1">
                        Workspace
                      </DropdownMenuLabel>
                      {workspaces.map((ws) => (
                        <DropdownMenuItem
                          key={ws.id}
                          onClick={() => setCurrentWorkspace(ws.id)}
                          className="flex items-center gap-2 h-8 rounded-md text-[13px]"
                        >
                          <WorkspaceAvatar workspace={ws} size="sm" />
                          <span className="flex-1 truncate">{ws.name}</span>
                          {ws.id === currentWorkspaceId && (
                            <Check className="size-3.5 text-sidebar-primary" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}

                  <DropdownMenuSeparator />

                  {/* Logout */}
                  <DropdownMenuItem className="h-8 rounded-md text-[13px] text-muted-foreground hover:text-foreground">
                    <LogOut className="size-3.5" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarFooter>

      <SidebarRail />

      <AdminCommandPalette
        groups={navigationGroups}
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />
    </Sidebar>
  );
}
