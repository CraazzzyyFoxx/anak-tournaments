import { useWorkspaceStore } from "@/stores/workspace.store";
import { DivisionGrid, DivisionTier } from "@/types/workspace.types";

const DEFAULT_TIERS: DivisionTier[] = Array.from({ length: 20 }, (_, i) => {
  const num = 20 - i;
  return {
    number: num,
    name: `Division ${num}`,
    rank_min: num === 1 ? 2000 : i * 100,
    rank_max: num === 1 ? null : i * 100 + 99,
    icon_path: `/divisions/${num}.png`,
  };
});

export const DEFAULT_DIVISION_GRID: DivisionGrid = { tiers: DEFAULT_TIERS };

export function useCurrentWorkspaceId(): number | null {
  return useWorkspaceStore((s) => s.currentWorkspaceId);
}

export function useDivisionGrid(): DivisionGrid {
  const workspace = useWorkspaceStore((s) => s.getCurrentWorkspace());
  return workspace?.division_grid ?? DEFAULT_DIVISION_GRID;
}
