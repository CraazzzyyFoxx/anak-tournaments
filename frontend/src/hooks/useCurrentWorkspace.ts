import { useMemo } from "react";

import { resolveOwnerGrid } from "@/lib/divisions/grid";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { DivisionGrid, DivisionGridVersion } from "@/types/workspace.types";

export function useCurrentWorkspaceId(): number | null {
  return useWorkspaceStore(
    (s) => s.hostLockedWorkspaceId ?? s.entityWorkspaceId ?? s.currentWorkspaceId
  );
}

/**
 * The grid ranks of `discipline` resolve through for the current workspace (its real effective version, which
 * already carries that game's system/native fallback). While the workspace is not loaded, or the game has no
 * grid, this is an EMPTY grid: icon and label readers then render their neutral missing state — never another
 * game's crests. Without an explicit `discipline` the workspace's first enabled game is read, as before.
 */
export function useDivisionGrid(discipline?: string): DivisionGrid {
  const workspace = useWorkspaceStore((s) => s.getCurrentWorkspace());
  const scope = discipline ?? workspace?.disciplines_enabled[0];
  const tiers = resolveOwnerGrid(workspace, scope)?.tiers;
  return useMemo(() => ({ tiers: tiers ?? [] }), [tiers]);
}

export function useDivisionGridVersion(discipline?: string): DivisionGridVersion | null {
  return useWorkspaceStore((s) => {
    const workspace = s.getCurrentWorkspace();
    return resolveOwnerGrid(workspace, discipline ?? workspace?.disciplines_enabled[0]);
  });
}
