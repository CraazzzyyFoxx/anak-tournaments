"use client";

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AppPermission, usePermissions } from "@/hooks/usePermissions";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@/components/ui/breadcrumb";
import { usePathname } from "next/navigation";

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

const routePermissions: Array<{ prefix: string; permissions: AppPermission[]; superuserOnly?: boolean }> = [
  { prefix: "/admin/access", permissions: [], superuserOnly: true },
  { prefix: "/admin/tournaments", permissions: ["tournament.read"] },
  { prefix: "/admin/teams", permissions: ["team.read"] },
  { prefix: "/admin/players", permissions: ["player.read"] },
  { prefix: "/admin/encounters", permissions: ["match.read"] },
  { prefix: "/admin/standings", permissions: ["standing.read"] },
  { prefix: "/admin/users", permissions: ["user.read"] },
  { prefix: "/admin/heroes", permissions: ["hero.read"] },
  { prefix: "/admin/gamemodes", permissions: ["gamemode.read"] },
  { prefix: "/admin/maps", permissions: ["map.read"] },
  { prefix: "/admin/achievements", permissions: ["achievement.read"] },
  { prefix: "/admin/settings", permissions: [], superuserOnly: true },
  { prefix: "/admin", permissions: overviewPermissions },
];

function LoadingState() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
        <p className="mt-4 text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function UnauthorizedState() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Unauthorized</h1>
        <p className="mt-4 text-muted-foreground">
          You do not have permission to access the admin panel.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Please contact an administrator if you believe this is an error.
        </p>
      </div>
    </div>
  );
}

function AdminBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/admin">Admin</BreadcrumbLink>
        </BreadcrumbItem>
        {segments.slice(1).map((segment, index) => {
          const href = `/admin/${segments.slice(1, index + 2).join("/")}`;
          const isLast = index === segments.length - 2;
          const title = segment.charAt(0).toUpperCase() + segment.slice(1);

          return (
            <div key={segment} className="flex items-center gap-2">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{title}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={href}>{title}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </div>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoaded, isAdmin, isOrganizer, isModerator, isSuperuser, hasAnyPermission } = usePermissions();

  // Show loading state while auth is resolving
  if (!isLoaded) {
    return <LoadingState />;
  }

  const matchingRoute = routePermissions.find((route) => pathname.startsWith(route.prefix));

  let hasAccess = false;
  if (matchingRoute?.superuserOnly) {
    hasAccess = isSuperuser;
  } else if (matchingRoute?.permissions?.length) {
    hasAccess = isSuperuser || hasAnyPermission(matchingRoute.permissions);
  } else {
    hasAccess = isSuperuser || isAdmin || isOrganizer || isModerator;
  }

  // Redirect or show unauthorized if no access
  if (!hasAccess) {
    return <UnauthorizedState />;
  }

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <AdminBreadcrumb />
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
