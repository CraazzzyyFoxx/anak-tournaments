"use client";

import { useQuery } from "@tanstack/react-query";

import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import disciplineService from "@/services/discipline.service";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The installed games for one workspace axis. No placeholder: another axis's list
 * is never shown for this one. `initialData` is the server render's list for the
 * same axis, so hydration resolves with the same descriptors the server used.
 */
export function useDisciplines(axis: WorkspaceAxis, initialData?: DisciplineDescriptor[]) {
  return useQuery({
    queryKey: disciplineQueryKeys.list(axis),
    queryFn: ({ signal }) => disciplineService.list(axis, { signal }),
    initialData,
  });
}

/** One game's metadata for an axis; idle until a concrete code is resolved. */
export function useDisciplineMetadata(axis: WorkspaceAxis, code: string | null) {
  return useQuery({
    queryKey: disciplineQueryKeys.metadata(axis, code ?? ""),
    queryFn: ({ signal }) => disciplineService.metadata(axis, code as string, { signal }),
    enabled: code !== null,
  });
}
