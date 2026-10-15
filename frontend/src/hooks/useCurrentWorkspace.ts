import { useMemo } from "react";

import { getDefaultDivisionGrid } from "@/lib/divisions/grid";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { DivisionGrid, DivisionGridVersion } from "@/types/workspace.types";

export function useCurrentWorkspaceId(): number | null {
  return useWorkspaceStore(
    (s) => s.hostLockedWorkspaceId ?? s.entityWorkspaceId ?? s.currentWorkspaceId
  );
}

export function useDivisionGrid(discipline?: string): DivisionGrid {
  const workspace = useWorkspaceStore((s) => s.getCurrentWorkspace());
  const scope = discipline ?? workspace?.disciplines_enabled[0];
  const tiers = scope ? workspace?.effective_division_grid_versions[scope]?.tiers : undefined;
  return useMemo(
    () =>
      tiers
        ? { tiers }
        : scope === "overwatch" || (!workspace && !scope)
          ? getDefaultDivisionGrid()
          : { tiers: [] },
    [tiers, scope, workspace]
  );
}

export function useDivisionGridVersion(discipline?: string): DivisionGridVersion | null {
  return useWorkspaceStore((s) => {
    const workspace = s.getCurrentWorkspace();
    const scope = discipline ?? workspace?.disciplines_enabled[0];
    return scope ? (workspace?.effective_division_grid_versions[scope] ?? null) : null;
  });
}
