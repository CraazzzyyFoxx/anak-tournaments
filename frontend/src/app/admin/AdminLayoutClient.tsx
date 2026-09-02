"use client";

import { Fragment, type CSSProperties, type ReactNode, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { skipToken, useQuery } from "@tanstack/react-query";

import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AuditTrailProvider } from "@/components/admin/AuditTrailSheet";
import { getMatchingAdminRoute } from "@/components/admin/admin-navigation";
import { adminEntryPermissions } from "@/lib/admin-permissions";
import { getTournamentWorkspaceQueryKeys } from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.queryKeys";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePermissions } from "@/hooks/usePermissions";
import { SIDEBAR_COOKIE_NAMES } from "@/lib/sidebar-cookies";
import { useWorkspaceStore } from "@/stores/workspace.store";

function LoadingState() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-center">
        <div className="inline-block size-8 animate-spin rounded-full border-4 border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
        <p className="mt-4 text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}

function UnauthorizedState() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Unauthorized</h1>
        <p className="mt-4 text-muted-foreground">You do not have permission to access the admin panel.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Please contact an administrator if you believe this is an error.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}

function formatBreadcrumbLabel(segment: string) {
  const normalized = segment.replace(/-/g, " ");
  if (/^\d+$/.test(normalized)) {
    return "Details";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** Detail crumbs whose numeric id segment can be resolved to an entity name
 * from the query cache. The tournament hub shell / team workspace page own
 * these queries; the breadcrumb only READS the cache (skipToken never
 * fetches) and falls back to the generic "Details" label. */
function getBreadcrumbEntityRef(
  segments: string[]
): { queryKey: readonly unknown[]; segmentIndex: number } | null {
  const [, section, id] = segments;
  if (!id || !/^\d+$/.test(id)) {
    return null;
  }
  if (section === "tournaments") {
    return { queryKey: getTournamentWorkspaceQueryKeys(Number(id)).tournament, segmentIndex: 2 };
  }
  if (section === "teams") {
    // Same key as the team workspace query (admin/teams/[id]/page.tsx).
    return { queryKey: ["admin", "team", Number(id)] as const, segmentIndex: 2 };
  }
  return null;
}

function EntityBreadcrumbName({
  queryKey,
  fallback,
}: Readonly<{
  queryKey: readonly unknown[];
  fallback: string;
}>) {
  const { data } = useQuery({ queryKey, queryFn: skipToken });
  const name = (data as { name?: unknown } | undefined)?.name;
  return <>{typeof name === "string" && name ? name : fallback}</>;
}

function AdminBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const entityRef = getBreadcrumbEntityRef(segments);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/admin">Admin</BreadcrumbLink>
        </BreadcrumbItem>
        {segments.slice(1).map((segment, index) => {
          const href = `/admin/${segments.slice(1, index + 2).join("/")}`;
          const isLast = index === segments.length - 2;
          const label =
            entityRef && index + 1 === entityRef.segmentIndex ? (
              <EntityBreadcrumbName
                queryKey={entityRef.queryKey}
                fallback={formatBreadcrumbLabel(segment)}
              />
            ) : (
              formatBreadcrumbLabel(segment)
            );

          return (
            // Fragment, not a <div>: BreadcrumbList renders an <ol>, which
            // admits only <li> children. The wrapper broke list semantics on
            // every admin page.
            <Fragment key={`${segment}-${index}`}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={href}>{label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

const sidebarShellStyle = {
  "--sidebar-width": "15.5rem",
  "--sidebar-width-icon": "3.75rem",
} as CSSProperties;

type AdminLayoutClientProps = {
  children: ReactNode;
  defaultSidebarOpen: boolean;
};

export function AdminLayoutClient({ children, defaultSidebarOpen }: Readonly<AdminLayoutClientProps>) {
  const pathname = usePathname();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { isLoaded, canAccessAdminRoute } = usePermissions();

  useEffect(() => {
    document.body.classList.add("admin-theme");
    return () => document.body.classList.remove("admin-theme");
  }, []);

  if (!isLoaded) {
    return <LoadingState />;
  }

  const matchingRoute = getMatchingAdminRoute(pathname);
  const hasAccess = matchingRoute
    ? canAccessAdminRoute({
        permissions: matchingRoute.permissions,
        workspaceId: matchingRoute.workspaceAdminVisible ? null : currentWorkspaceId,
        globalOnly: matchingRoute.globalOnly,
        workspaceAdminVisible: matchingRoute.workspaceAdminVisible,
        superuserOnly: matchingRoute.superuserOnly,
      })
    : canAccessAdminRoute({
        permissions: adminEntryPermissions,
        workspaceId: currentWorkspaceId,
      });

  if (!hasAccess) {
    return <UnauthorizedState />;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider
        className="admin-theme"
        cookieName={SIDEBAR_COOKIE_NAMES.admin}
        defaultOpen={defaultSidebarOpen}
        style={sidebarShellStyle}
      >
        {/* First focusable element: the sidebar puts ~30 nav links before the
            page content, so keyboard users need a way past them. */}
        <a
          href="#admin-content"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-lg focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-primary-foreground"
        >
          Skip to content
        </a>
        <AdminSidebar />
        <SidebarInset className="min-w-0 bg-background/95 md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:border-border/50 md:peer-data-[variant=inset]:shadow-xl md:peer-data-[variant=inset]:shadow-black/10">
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-border/50 bg-background/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-5">
            <SidebarTrigger className="size-8 rounded-lg border border-border/60" />
            <Separator orientation="vertical" className="h-5" />
            <AdminBreadcrumb />
          </header>

          <div
            id="admin-content"
            tabIndex={-1}
            className="flex flex-1 flex-col gap-4 overflow-x-hidden p-4"
          >
            {/* One drawer for the whole panel: every per-entity trail opens
                here, so no screen mounts its own copy and none can nest. */}
            <AuditTrailProvider>{children}</AuditTrailProvider>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
