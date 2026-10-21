"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useInvalidation } from "@/hooks/useInvalidation";
import { adminQueryKeys } from "@/lib/admin/query-keys";

// Trailing debounce: a bulk registration edit flushes the tournament and the
// workspace scope back to back, and that burst must cost one dashboard refetch.
const DASHBOARD_INVALIDATE_DEBOUNCE_MS = 400;

/** One tournament's invalidation topic; a component because hooks cannot be called in a loop. */
function TournamentInvalidation({
  tournamentId,
  workspaceId,
  onFlush
}: Readonly<{ tournamentId: number; workspaceId: number; onFlush: () => void }>) {
  useInvalidation({ scopeKind: "tournament", scopeId: tournamentId, workspaceId, onFlush });
  return null;
}

/**
 * Keeps the dashboard live (pattern of `TournamentHubShell`): every card
 * tournament's invalidation topic plus the workspace's. The dashboard is an
 * aggregate no publisher names, so any flush refetches it and the activity feed.
 */
export function DashboardRealtime({
  workspaceId,
  tournamentIds
}: Readonly<{ workspaceId: number; tournamentIds: readonly number[] }>) {
  const queryClient = useQueryClient();
  const timerRef = useRef<number | undefined>(undefined);
  const scheduleInvalidate = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.dashboardRoot() });
    }, DASHBOARD_INVALIDATE_DEBOUNCE_MS);
  }, [queryClient]);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useInvalidation({ scopeKind: "workspace", scopeId: workspaceId, onFlush: scheduleInvalidate });

  return tournamentIds.map((tournamentId) => (
    <TournamentInvalidation
      key={tournamentId}
      tournamentId={tournamentId}
      workspaceId={workspaceId}
      onFlush={scheduleInvalidate}
    />
  ));
}
