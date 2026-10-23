import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { adminQueryKeys } from "@/lib/admin/query-keys";
import { resolveOwnerGrid } from "@/lib/divisions/grid";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { DivisionGrid, DivisionGridVersion, Workspace } from "@/types/workspace.types";

export function useCurrentWorkspaceId(): number | null {
  return useWorkspaceStore(
    (s) => s.hostLockedWorkspaceId ?? s.entityWorkspaceId ?? s.currentWorkspaceId
  );
}

/**
 * One workspace in full, grids included: the store's list rows carry none. On the cache entry the settings pages
 * read and invalidate, so a saved change reaches every grid reader.
 */
export function useWorkspaceRead(workspaceId: number | null): Workspace | undefined {
  return useQuery({
    queryKey: adminQueryKeys.workspace(workspaceId ?? 0),
    queryFn: () => workspaceService.getById(workspaceId as number),
    enabled: workspaceId !== null
  }).data;
}

/**
 * The grid ranks of `discipline` resolve through for the current workspace (its real effective version, which
 * already carries that game's system/native fallback). While the workspace is not loaded, or the game has no
 * grid, this is an EMPTY grid: icon and label readers then render their neutral missing state — never another
 * game's crests. Without an explicit `discipline` the workspace's first enabled game is read, as before.
 */
export function useDivisionGrid(discipline?: string): DivisionGrid {
  const tiers = useDivisionGridVersion(discipline)?.tiers;
  return useMemo(() => ({ tiers: tiers ?? [] }), [tiers]);
}

export function useDivisionGridVersion(discipline?: string): DivisionGridVersion | null {
  const workspace = useWorkspaceRead(useCurrentWorkspaceId());
  return resolveOwnerGrid(workspace, discipline ?? workspace?.disciplines_enabled[0]);
}
