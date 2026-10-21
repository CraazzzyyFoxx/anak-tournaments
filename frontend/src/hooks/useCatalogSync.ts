"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { ApiError } from "@/lib/api/error";
import { invalidateCatalogSync } from "@/lib/catalog/invalidate";
import { catalogQueryKeys } from "@/lib/catalog/query-keys";
import adminService from "@/services/admin.service";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import type { CatalogSyncState } from "@/types/catalog.types";

/** What the snapshot query caches. */
interface CatalogSyncView {
  state: CatalogSyncState | null;
  /** `state` was running and the server now answers null: its worker died, so this is the last thing it reported. */
  interrupted: boolean;
}

/** The realtime topic carries every change; the poll only covers a dropped socket or a dead worker. */
const POLL_MS = 30_000;

/**
 * `next`, unless the cache already holds a later snapshot of the same run: a POST reply or a GET can land after a
 * realtime event that has already moved past it.
 */
function fresher(prev: CatalogSyncView | undefined, next: CatalogSyncState): CatalogSyncView {
  if (
    prev?.state &&
    prev.state.started_at === next.started_at &&
    Date.parse(prev.state.updated_at) > Date.parse(next.updated_at)
  ) {
    return prev;
  }
  return { state: next, interrupted: false };
}

/** What the toolbar and `CatalogSyncDialog` read. */
export interface CatalogSync {
  /** The latest snapshot; null when nothing ran lately. */
  state: CatalogSyncState | null;
  /** `state` was running and the server now answers null: its worker died, so this is the last thing it reported. */
  interrupted: boolean;
  /** Running, or being started. */
  running: boolean;
  /** Running under another admin: no live events reach this user. */
  startedByOther: boolean;
  /** A start that failed for a reason other than a sync already running. */
  startError: Error | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Starts a sync, or reopens the modal of the one running instead of POSTing a certain 409. */
  start: () => void;
}

/**
 * The background catalog sync of one discipline: its snapshot (GET once, then the `catalog_sync.progress` events of
 * the user's own topic), the start, and the open state of the progress modal. The modal only ever opens on a start;
 * after a reload the toolbar shows a running sync and a click reopens it.
 */
export function useCatalogSync(discipline: string): CatalogSync {
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const me = useAuthProfileStore((state) => state.user?.id ?? null);
  const [open, setOpen] = useState(false);
  const queryKey = catalogQueryKeys.syncState(discipline);

  const { data } = useQuery({
    queryKey,
    queryFn: async (): Promise<CatalogSyncView> => {
      const next = await adminService.getCatalogSync(discipline);
      const prev = queryClient.getQueryData<CatalogSyncView>(queryKey);
      if (next) return fresher(prev, next);
      // The server forgets a running sync only when its heartbeat expired.
      return prev?.state?.status === "running"
        ? { state: prev.state, interrupted: true }
        : { state: null, interrupted: false };
    },
    enabled: isSuperuser,
    refetchInterval: (query) =>
      query.state.data?.state?.status === "running" && !query.state.data.interrupted ? POLL_MS : false,
  });

  // Only the starter gets live events (the topic is theirs); another superuser sees the snapshot and the poll.
  useRealtimeTopic<CatalogSyncState>(isSuperuser && me != null ? `user:${me}:catalog-sync` : null, (event) => {
    if (event.data.discipline !== discipline) return;
    queryClient.setQueryData<CatalogSyncView>(queryKey, (prev) => fresher(prev, event.data));
  });

  const state = data?.state ?? null;
  const interrupted = data?.interrupted ?? false;
  const status = interrupted ? undefined : state?.status;

  // A failed sync still committed the kinds before the one that failed, so both endings refresh the tables.
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === "running" && (status === "done" || status === "failed")) {
      void invalidateCatalogSync(queryClient, discipline);
    }
    lastStatus.current = status;
  }, [status, discipline, queryClient]);

  const startMutation = useMutation({
    mutationFn: (target: string) => adminService.startCatalogSync(target),
    onSuccess: (started, target) =>
      queryClient.setQueryData<CatalogSyncView>(catalogQueryKeys.syncState(target), (prev) => fresher(prev, started)),
    // 409: this game is already syncing (another tab or admin) — show that run instead.
    onError: (error, target) =>
      error instanceof ApiError && error.status === 409
        ? queryClient.refetchQueries({ queryKey: catalogQueryKeys.syncState(target) })
        : undefined,
    onSettled: () => setOpen(true),
    // The modal shows the failure.
    meta: { suppressErrorToast: true },
  });

  const running = status === "running";
  const startError =
    startMutation.error && !(startMutation.error instanceof ApiError && startMutation.error.status === 409)
      ? startMutation.error
      : null;

  return {
    state,
    interrupted,
    running: running || startMutation.isPending,
    startedByOther: running && me != null && state?.started_by !== me,
    startError,
    open,
    setOpen,
    start: () => {
      if (running) {
        setOpen(true);
        return;
      }
      startMutation.reset();
      startMutation.mutate(discipline);
    },
  };
}
