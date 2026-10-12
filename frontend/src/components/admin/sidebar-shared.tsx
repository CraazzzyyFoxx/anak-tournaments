"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, ChevronsUpDown } from "lucide-react";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { AccountMenuContent } from "@/components/UserMenu";
import { WorkspaceAvatar } from "@/components/workspace/WorkspaceAvatar";
import { filterAccessibleWorkspaces, useWorkspaceStore } from "@/stores/workspace.store";
import { SITE_FAVICON, SITE_NAME } from "@/config/site";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { cn, initials } from "@/lib/utils";

// Role names come from two RBAC scopes: global roles ("admin", "moderator" —
// see AppRole in usePermissions) and
// workspace-scoped roles ("owner", "admin", "referee", "host", "player" —
// see WORKSPACE_SYSTEM_ROLE_NAMES). A workspace admin never holds
// the *global* "admin" role, so checking only global roles left every
// workspace-scoped staff member (the common case) falling through to the
// "Operator" fallback. Check both scopes, global first.
function getRoleLabel({
  isSuperuser,
  globalRoles,
  workspaceRoles
}: {
  isSuperuser: boolean;
  globalRoles: string[];
  workspaceRoles: string[];
}) {
  if (isSuperuser) return "superuser";
  if (globalRoles.includes("admin") || workspaceRoles.includes("admin")) return "admin";
  if (globalRoles.includes("moderator")) return "moderator";
  if (workspaceRoles.includes("owner")) return "owner";
  if (workspaceRoles.includes("referee")) return "referee";
  if (workspaceRoles.includes("host")) return "host";
  if (workspaceRoles.includes("player")) return "player";
  return "operator";
}

export function SidebarWorkspaceLogoItem({ href }: Readonly<{ href: string }>) {
  const t = useTranslations("adminShell.dashboardExtra");
  const { user, status } = useAuthProfile();
  const { workspaces: allWorkspaces, currentWorkspaceId } = useWorkspaceStore();
  const workspaces = filterAccessibleWorkspaces(allWorkspaces, status, user);
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          size="lg"
          className="h-9 rounded-lg px-2 hover:bg-transparent group-data-[collapsible=icon]:justify-center"
        >
          <HoverPrefetchLink href={href} aria-label={t("workspaceAdminHome", { workspace: currentWorkspace?.name ?? SITE_NAME })}>
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
              <WorkspaceAvatar workspace={currentWorkspace} size={28} />
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
            <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">
              {currentWorkspace?.name ?? SITE_NAME}
            </span>
          </HoverPrefetchLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function SidebarBackToSite() {
  const t = useTranslations("adminShell.sidebar");
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          size="sm"
          tooltip={t("returnToSite")}
          className="h-7 rounded-md px-2.5 text-sm text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/40"
        >
          <HoverPrefetchLink href="/">
            <ArrowLeft aria-hidden className="size-4 text-sidebar-foreground/30" />
            <span>{t("returnToSite")}</span>
          </HoverPrefetchLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * The RU | EN switch, in view rather than one menu deep. Collapsed to icons the
 * rail has no room for it; the account menu below carries the same choice.
 */
export function SidebarLanguageSwitch() {
  const t = useTranslations("common");
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1 group-data-[collapsible=icon]:hidden">
      <span className="text-xs text-sidebar-foreground/40">{t("language")}</span>
      <LanguageSwitcher className="h-7" />
    </div>
  );
}

export function SidebarUserDropdown() {
  const t = useTranslations("adminShell.sidebar");
  const tDashboard = useTranslations("adminShell.dashboardExtra");
  const { user, status } = useAuthProfile();
  const {
    workspaces: allWorkspaces,
    currentWorkspaceId,
    setCurrentWorkspace
  } = useWorkspaceStore();

  const workspaces = filterAccessibleWorkspaces(allWorkspaces, status, user);
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);
  const roleLabel = t(`roles.${getRoleLabel({
    isSuperuser: user?.isSuperuser ?? false,
    globalRoles: user?.roles ?? [],
    workspaceRoles: user?.workspaces.flatMap((ws) => ws.roles) ?? []
  })}` as never);

  return (
    <div className="mt-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                tooltip={user?.username ?? tDashboard("profile")}
                className="h-12 rounded-lg px-2 hover:bg-sidebar-accent/60 data-[state=open]:bg-sidebar-accent/60"
              >
                <Avatar className="size-8 rounded-lg ring-1 ring-sidebar-border/60">
                  <AvatarImage
                    src={user?.avatarUrl ?? undefined}
                    alt={user?.username ?? tDashboard("user")}
                  />
                  <AvatarFallback className="rounded-lg bg-sidebar-accent text-xs font-medium text-sidebar-foreground/60">
                    {initials(user?.username)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-medium text-sidebar-foreground">
                    {user?.username ?? tDashboard("user")}
                  </span>
                  <span className="truncate text-xs text-sidebar-foreground/40">
                    {roleLabel}
                    {currentWorkspace ? ` · ${currentWorkspace.name}` : ""}
                  </span>
                </div>
                <ChevronsUpDown
                  aria-hidden
                  className="ml-auto size-3.5 text-sidebar-foreground/25 group-data-[collapsible=icon]:hidden"
                />
              </SidebarMenuButton>
            </DropdownMenuTrigger>

            {user && (
              <AccountMenuContent user={user} align="start" side="top">
                {workspaces.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className={cn(EYEBROW_CLASS, "px-2 py-1")}>
                      {t("workspace")}
                    </DropdownMenuLabel>
                    {workspaces.map((ws) => (
                      <DropdownMenuItem
                        key={ws.id}
                        onClick={() => setCurrentWorkspace(ws.id)}
                        aria-current={ws.id === currentWorkspaceId ? "true" : undefined}
                        className="flex items-center gap-2 h-8 rounded-md text-sm"
                      >
                        <WorkspaceAvatar workspace={ws} size={20} />
                        <span className="flex-1 truncate">{ws.name}</span>
                        {ws.id === currentWorkspaceId && (
                          <Check aria-hidden className="size-3.5 text-sidebar-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </AccountMenuContent>
            )}
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}
