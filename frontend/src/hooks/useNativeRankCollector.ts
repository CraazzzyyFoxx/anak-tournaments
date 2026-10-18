"use client";

import { useSearchParams } from "next/navigation";

import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import { DISCIPLINE_PARAM, resolveDiscipline, type WorkspaceAxis } from "@/lib/site/discipline-scope";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The game a rank surface (history, collector mapping) talks about, and whether that game collects ranks.
 *
 * The game is resolved first through the shared resolver — owner > explicit `?discipline=` > saved
 * preference > first enabled game, enabled games only — and only then gated by the `native_rank_collection`
 * capability. An explicit value the installed set cannot honour resolves to no game at all. Capability never picks a game: a game that does not collect ranks
 * resolves to `supported: false`, never to another game that does.
 */
/** The resolved game (`null` when none resolves) and whether it collects native ranks. */
export interface NativeRankCollector {
  descriptor: DisciplineDescriptor | null;
  supported: boolean;
  isLoading: boolean;
  isError: boolean;
}

export function useNativeRankCollector(
  axis: WorkspaceAxis,
  ownerDiscipline?: string | null
): NativeRankCollector {
  const disciplines = useDisciplines(axis);
  const explicit = useSearchParams()?.get(DISCIPLINE_PARAM) ?? null;
  const stored = useWorkspaceStore((state) => state.browsingDiscipline);
  const resolved = disciplines.data
    ? resolveDiscipline({
        ownerDiscipline: ownerDiscipline ?? null,
        explicitDiscipline: explicit,
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
