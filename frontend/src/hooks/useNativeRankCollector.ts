"use client";

import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import { resolveDiscipline, type WorkspaceAxis } from "@/lib/site/discipline-scope";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The game a rank surface (history, collector mapping) talks about, and whether that game collects ranks.
 *
 * The game is resolved first — the owning discipline when the surface has one, else the concrete browsing
 * choice (saved preference, then the first enabled game), enabled games only — and only then gated by the
 * `native_rank_collection` capability. Capability never picks a game: a game that does not collect ranks
 * resolves to `supported: false`, never to another game that does.
 */
export function useNativeRankCollector(axis: WorkspaceAxis, ownerDiscipline?: string | null) {
  const disciplines = useDisciplines(axis);
  const stored = useWorkspaceStore((state) => state.browsingDiscipline);
  const resolved = disciplines.data
    ? resolveDiscipline({
        ownerDiscipline: ownerDiscipline ?? null,
        explicitDiscipline: null,
        storedDiscipline: stored,
        disciplines: disciplines.data,
        allowsAll: false
      })
    : null;
  const descriptor: DisciplineDescriptor | null =
    resolved?.kind === "concrete"
      ? (disciplines.data?.find((entry) => entry.code === resolved.code) ?? null)
      : null;
  return {
    descriptor,
    supported: descriptor?.capabilities.native_rank_collection === true,
    isLoading: disciplines.isLoading,
    isError: disciplines.isError
  };
}
