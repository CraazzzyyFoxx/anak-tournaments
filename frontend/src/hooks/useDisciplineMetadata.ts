"use client";

import { useQuery } from "@tanstack/react-query";

import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import disciplineService from "@/services/discipline.service";
import type { DisciplineDescriptor, DisciplineMetadata } from "@/types/discipline.types";

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

/**
 * One game's metadata for an axis; idle until a concrete code is resolved. `initialData` is the server render's read
 * for the same axis and game, so hydration resolves with the metadata the server used.
 */
export function useDisciplineMetadata(axis: WorkspaceAxis, code: string | null, initialData?: DisciplineMetadata) {
  return useQuery({
    queryKey: disciplineQueryKeys.metadata(axis, code ?? ""),
    queryFn: ({ signal }) => disciplineService.metadata(axis, code as string, { signal }),
    enabled: code !== null,
    initialData,
  });
}
