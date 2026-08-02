"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { BalancerToolTopBar } from "@/app/balancer/BalancerToolTopBar";
import { BalancerShell } from "@/app/balancer/components/BalancerShell";
import { useToolContext } from "@/app/balancer/useToolContext";
import { adminEntryPermissions } from "@/lib/admin-permissions";
import { usePermissions } from "@/hooks/usePermissions";

function LoadingState() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-center">
        <div className="inline-block size-8 animate-spin rounded-full border-4 border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
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
          The balancer workspace is available only to admins and tournament organizers.
        </p>
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

function NoTournamentState() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">No tournament selected</h1>
        <p className="mt-4 text-muted-foreground">
          The balancer is a per-tournament tool. Open it from a tournament to get started.
        </p>
        <Link
          href="/admin/tournaments"
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open a tournament
        </Link>
      </div>
    </div>
  );
}

type BalancerLayoutClientProps = {
  children: ReactNode;
};

export function BalancerLayoutClient({ children }: BalancerLayoutClientProps) {
  const { isLoaded, isOrganizer, canAccessAdminRoute } = usePermissions();
  const { status: contextStatus, summary } = useToolContext();

  // Render gate (D29, Risk 1): children fire apiFetch calls that inject
  // workspace_id from the store, so nothing below may render until the
  // tournament context is resolved AND the store is aligned to it. A
  // layout-wide gate is simpler and safer than per-hook `enabled` flags.
  if (!isLoaded || contextStatus === "loading") {
    return <LoadingState />;
  }

  if (contextStatus === "missing" || contextStatus === "not_found") {
    return <NoTournamentState />;
  }

  // The entry predicate is unchanged, but the workspace comes from the
  // resolved summary, not the store (the store may still be switching).
  const hasAdminAccess =
    summary != null &&
    canAccessAdminRoute({
      permissions: adminEntryPermissions,
      workspaceId: summary.workspace_id,
      workspaceAdminVisible: true
    });
  const hasAccess = hasAdminAccess || isOrganizer;

  if (contextStatus === "forbidden" || !hasAccess) {
    return <UnauthorizedState />;
  }

  if (summary == null) {
    // Unreachable once contextStatus is "ready", but keeps the render below total.
    return <LoadingState />;
  }

  return (
    // `xl:fixed inset-0` takes the tool out of flow, so nothing inside it — however a descendant
    // sizes itself — can add height to the document. `h-svh` + `overflow-hidden` alone only clip:
    // the shell still occupies flow, and any sibling or mis-sized subtree brings back a page
    // scrollbar on top of the app shell. Below `xl` the tool stacks and scrolls normally.
    <div className="admin-theme flex min-h-svh flex-col bg-background/95 xl:fixed xl:inset-0 xl:h-svh xl:min-h-0 xl:overflow-hidden">
      <BalancerToolTopBar summary={summary} />
      <div className="flex flex-1 flex-col gap-4 overflow-x-hidden p-3 xl:min-h-0 xl:overflow-hidden md:p-4">
        <BalancerShell>{children}</BalancerShell>
      </div>
    </div>
  );
}
