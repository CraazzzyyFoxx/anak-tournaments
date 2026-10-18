"use client";

import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The installed discipline whose rank collector a rank surface (history, collector mapping) talks to.
 *
 * Only disciplines that declare native-rank collection qualify. An explicit `preferred` code must be one of
 * them; without it the single collector is used. With none, or several and no preference, there is no
 * answer (`descriptor: null`) — callers say so instead of assuming a game.
 */
export function useNativeRankCollector(axis: WorkspaceAxis, preferred?: string) {
  const disciplines = useDisciplines(axis);
  const collectors = (disciplines.data ?? []).filter((entry) => entry.capabilities.native_rank_collection);
  const descriptor: DisciplineDescriptor | null = preferred
    ? (disciplines.data?.find((entry) => entry.code === preferred) ?? null)
    : collectors.length === 1
      ? collectors[0]
      : null;
  return { descriptor, isLoading: disciplines.isLoading, isError: disciplines.isError };
}
