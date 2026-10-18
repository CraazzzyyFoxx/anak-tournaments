"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import { DISCIPLINE_PARAM, resolveDiscipline, type ResolvedDiscipline, type WorkspaceAxis } from "@/lib/site/discipline-scope";
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
  /** `null` until the installed games are known. Invalid/empty resolutions are surfaced, never replaced by a game. */
  resolved: ResolvedDiscipline | null;
  disciplines: DisciplineDescriptor[] | undefined;
  /** The way out of an invalid selection: saves the choice and pushes it to `?discipline=` (a user selection, §2.4). */
  select: (value: string) => void;
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const explicit = searchParams?.get(DISCIPLINE_PARAM) ?? null;
  const stored = useWorkspaceStore((state) => state.browsingDiscipline);
  const setBrowsingDiscipline = useWorkspaceStore((state) => state.setBrowsingDiscipline);
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
  const select = (value: string) => {
    setBrowsingDiscipline(value);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set(DISCIPLINE_PARAM, value);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return {
    resolved,
    disciplines: disciplines.data,
    select,
    descriptor,
    supported: descriptor?.capabilities.native_rank_collection === true,
    isLoading: disciplines.isLoading,
    isError: disciplines.isError
  };
}
