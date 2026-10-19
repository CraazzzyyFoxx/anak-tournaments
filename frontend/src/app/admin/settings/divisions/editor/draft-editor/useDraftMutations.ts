import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { useWorkspaceStore } from "@/stores/workspace.store";
import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import type { DivisionGridReadinessSource, DivisionGridVersion } from "@/types/workspace.types";
import { divisionGridQueryKeys } from "@/lib/divisions/query-keys";

import { autoMap, mappingRules, unresolvedRows, type MappingChoices } from "../autoMap";
import type { MappingSource } from "../MappingsView";
import { bandsFromTiers, tiersFromBands, type Action, type Band, type Ladder } from "../draftReducer";

interface DraftMutationsInput {
  workspaceId: number;
  discipline: string;
  ladder: Ladder | null;
  version: DivisionGridVersion;
  bands: Band[];
  tiersDirty: boolean;
  sources: DivisionGridReadinessSource[];
  mappingSources: MappingSource[];
  /** The stored mapping overlaid with this session's picks — what a save writes. */
  chosen: MappingChoices;
  /** This session's picks alone — what a save carries over for sources it could not store. */
  manualChoice: MappingChoices;
  dispatch: (action: Action) => void;
  onReload: (carry?: MappingChoices) => void;
}

export function useDraftMutations({
  workspaceId,
  discipline,
  ladder,
  version,
  bands,
  tiersDirty,
  sources,
  mappingSources,
  chosen,
  manualChoice,
  dispatch,
  onReload
}: DraftMutationsInput) {
  const t = useTranslations("adminSettings.divisions");
  const failureDescription = (error: unknown) =>
    t("failureDescription", {
      reason: error instanceof Error ? error.message : t("operationFailed")
    });
  const router = useRouter();
  const queryClient = useQueryClient();
  const fetchWorkspaces = useWorkspaceStore((store) => store.fetchWorkspaces);

  // Only this game's keys: another discipline's cached versions and readiness are not affected by an
  // edit, publish or activation here.
  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: divisionGridQueryKeys.readinessByDiscipline(workspaceId, discipline)
      }),
      queryClient.invalidateQueries({
        queryKey: divisionGridQueryKeys.versionsByDiscipline(workspaceId, discipline)
      }),
      queryClient.invalidateQueries({ queryKey: divisionGridQueryKeys.grids(workspaceId) }),
      ...sources.map((source) =>
        queryClient.invalidateQueries({
          queryKey: divisionGridQueryKeys.mapping(source.version_id, version.id)
        })
      )
    ]);
  }, [discipline, queryClient, sources, version.id, workspaceId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updated = tiersDirty
        ? await workspaceService.updateDivisionGridVersion(version.id, {
            tiers: tiersFromBands(ladder, bands)
          })
        : version;
      // Mappings are written against the SAVED tiers: the rules point at tier
      // ids, and a band created in this session only gets one here.
      const savedBands = tiersDirty ? bandsFromTiers(ladder, updated.tiers) : bands;
      // The backend stores a mapping only when it covers every source tier, so
      // a source with an open row keeps its server state and its picks carry over.
      const pending: MappingSource[] = [];
      for (const source of mappingSources) {
        const rows = autoMap(ladder, source.tiers, savedBands);
        if (unresolvedRows(rows, chosen, savedBands).length > 0) {
          pending.push(source);
          continue;
        }
        const rules = mappingRules(rows, chosen, savedBands);
        if (rules.length === 0) continue;
        await workspaceService.putDivisionGridMapping(source.readiness.version_id, version.id, {
          name: `${source.readiness.version_label} \u2192 ${updated.label}`,
          rules
        });
      }
      return { updated, pending };
    },
    onSuccess: async ({ updated, pending }) => {
      // Seed the cache before remounting, so the fresh editor reads the tiers
      // that were just saved rather than the ones it sent.
      queryClient.setQueryData(divisionGridQueryKeys.version(version.id), updated);
      await invalidate();
      if (pending.length === 0) {
        notify.success(t("toast.draftSaved", { version: updated.version }));
      } else {
        notify.warning(t("toast.draftSavedMappingsOpen", { version: updated.version }), {
          description: t("toast.mappingPending", {
            sources: pending.map((source) => source.readiness.version_label).join(", ")
          })
        });
      }
      const pendingTierIds = new Set(
        pending.flatMap((source) => source.tiers.map((tier) => tier.id))
      );
      const carry: MappingChoices = {};
      for (const [sourceTierId, choice] of Object.entries(manualChoice)) {
        if (choice !== undefined && pendingTierIds.has(Number(sourceTierId))) {
          carry[Number(sourceTierId)] = choice;
        }
      }
      onReload(carry);
    },
    onError: reportFailure(t("errors.draftSave"), failureDescription)
  });

  const publishMutation = useMutation({
    mutationFn: () => workspaceService.publishDivisionGridVersion(version.id),
    onSuccess: async (published) => {
      queryClient.setQueryData(divisionGridQueryKeys.version(version.id), published);
      await invalidate();
      notify.success(t("toast.published", { version: published.version }));
      onReload();
    },
    onError: reportFailure(t("errors.publish"), failureDescription)
  });

  const activateMutation = useMutation({
    mutationFn: () => workspaceService.activateDivisionGridVersion(workspaceId, version.id),
    onSuccess: async () => {
      // The workspace's per-discipline default map changed: refresh it with this game's keys.
      await Promise.all([invalidate(), fetchWorkspaces()]);
      notify.success(t("toast.activated", { version: version.version }));
      onReload();
    },
    onError: reportFailure(t("errors.activate"), failureDescription)
  });

  const deleteMutation = useMutation({
    mutationFn: () => workspaceService.deleteDivisionGridVersion(version.id),
    onSuccess: async () => {
      await invalidate();
      notify.success(t("toast.draftDiscarded"));
      router.push("/admin/settings/divisions");
    },
    onError: reportFailure(t("errors.discard"), failureDescription)
  });

  const iconMutation = useMutation({
    mutationFn: async ({ bandIndex, file }: { bandIndex: number; file: File }) => {
      const band = bands[bandIndex];
      const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const upload = await workspaceService.uploadDivisionIcon(
        `${band.slug}-${suffix}`,
        file,
        workspaceId
      );
      return { bandIndex, url: upload.public_url };
    },
    onSuccess: ({ bandIndex, url }) => dispatch({ type: "setIcon", bandIndex, iconUrl: url }),
    onError: reportFailure(t("errors.crestUpload"), failureDescription)
  });

  const cloneToDraft = () => {
    void workspaceService
      .cloneDivisionGridVersion(version.id)
      .then(async (draft) => {
        await invalidate();
        router.push(`/admin/settings/divisions/v/${draft.id}`);
      })
      .catch(reportFailure(t("errors.draftCreate"), failureDescription));
  };

  return {
    saveMutation,
    publishMutation,
    activateMutation,
    deleteMutation,
    iconMutation,
    cloneToDraft
  };
}

function reportFailure(title: string, description: (error: unknown) => string) {
  return (error: unknown) =>
    notify.error(title, { description: description(error) });
}
