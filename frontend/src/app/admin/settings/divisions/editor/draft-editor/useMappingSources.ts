import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import workspaceService from "@/services/workspace.service";
import type { DivisionGridReadinessSource } from "@/types/workspace.types";
import { divisionGridQueryKeys } from "@/lib/divisions/query-keys";

import type { MappingChoice, MappingChoices } from "../autoMap";
import type { MappingSource } from "../MappingsView";

/** Every readiness source's tiers and its stored mapping into `versionId`. */
export function useMappingSources(
  sources: DivisionGridReadinessSource[],
  versionId: number,
  manualChoice: MappingChoices
) {
  const sourceQueries = useQueries({
    queries: sources.map((source) => ({
      queryKey: divisionGridQueryKeys.version(source.version_id),
      queryFn: () => workspaceService.getDivisionGridVersion(source.version_id)
    }))
  });
  const mappingQueries = useQueries({
    queries: sources.map((source) => ({
      queryKey: divisionGridQueryKeys.mapping(source.version_id, versionId),
      queryFn: () => workspaceService.getDivisionGridMapping(source.version_id, versionId),
      // A version pair with no mapping yet is the normal starting state, not a
      // failure to retry.
      retry: false
    }))
  });

  const mappingSources = useMemo<MappingSource[]>(
    () =>
      sources.flatMap((source, index) => {
        const tiers = sourceQueries[index]?.data?.tiers;
        return tiers ? [{ readiness: source, tiers }] : [];
      }),
    [sources, sourceQueries]
  );

  /**
   * The mapping already stored server-side — each source tier's targets and
   * primary — overlaid with this session's choices. Derived rather than copied
   * into state on load, so a refetch can never silently drop a decision the
   * user just made.
   */
  const chosen = useMemo(() => {
    const stored: Record<number, MappingChoice> = {};
    for (const query of mappingQueries) {
      for (const rule of query.data?.rules ?? []) {
        const entry = (stored[rule.source_tier_id] ??= {
          targets: [],
          primary: rule.target_tier_id
        });
        entry.targets.push(rule.target_tier_id);
        if (rule.is_primary) entry.primary = rule.target_tier_id;
      }
    }
    return { ...stored, ...manualChoice };
  }, [mappingQueries, manualChoice]);

  return { mappingSources, chosen, loading: sourceQueries.some((query) => query.isLoading) };
}
