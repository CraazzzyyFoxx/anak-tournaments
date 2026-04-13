"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import type React from "react";
import type { JobAction } from "./useBalancerJob";
import {
  buildBalancerInput,
  buildVariantFromSavedBalance,
  convertBalanceResponseToInternalPayload,
  fetchPlayerRankHistory,
  type BalanceVariant,
} from "./workspace-helpers";
import { createVariantLabel } from "./balancer-page-helpers";
import type { PlayerValidationState } from "./balancer-page-helpers";
import balancerAdminService from "@/services/balancer-admin.service";
import balancerService from "@/services/balancer.service";
import type {
  BalancerApplication,
  BalancerPlayerRecord,
  BalancerPlayerUpdateInput,
  BalancerRoleCode,
  BalanceSaveInput,
  SavedBalance,
} from "@/types/balancer-admin.types";
import type { BalanceJobResult, BalancerConfig, BalancerConfigResponse } from "@/types/balancer.types";
import type { useToast } from "@/hooks/use-toast";

type UseBalancerMutationsOptions = {
  tournamentId: number | null;
  toast: ReturnType<typeof useToast>["toast"];
  queryClient: QueryClient;
  dispatchJob: React.Dispatch<JobAction>;
  setSelectedPlayerId: (id: number | null) => void;
  setPendingRankHistory: (history: Partial<Record<BalancerRoleCode, number>> | null) => void;
  setEditingPlayerId: (id: number | null) => void;
  setVariants: React.Dispatch<React.SetStateAction<BalanceVariant[]>>;
  setActiveVariantId: React.Dispatch<React.SetStateAction<string | null>>;
  excludeInvalidPlayers: boolean;
  invalidPlayerStates: PlayerValidationState[];
  readyPlayers: BalancerPlayerRecord[];
  poolPlayers: BalancerPlayerRecord[];
  selectedPreset: string;
  balancerConfigData: BalancerConfigResponse | undefined;
  activeVariant: BalanceVariant | null;
  savedBalanceData: SavedBalance | null | undefined;
};

export function useBalancerMutations({
  tournamentId,
  toast,
  queryClient,
  dispatchJob,
  setSelectedPlayerId,
  setPendingRankHistory,
  setEditingPlayerId,
  setVariants,
  setActiveVariantId,
  excludeInvalidPlayers,
  invalidPlayerStates,
  readyPlayers,
  poolPlayers,
  selectedPreset,
  balancerConfigData,
  activeVariant,
  savedBalanceData,
}: UseBalancerMutationsOptions) {
  const addPlayerMutation = useMutation({
    mutationFn: async (application: BalancerApplication) => {
      if (!tournamentId) throw new Error("Select a tournament first");
      return balancerAdminService.setRegistrationExclusion(application.id, {
        exclude_from_balancer: false,
        exclude_reason: null,
      });
    },
    onSuccess: async (registration, application) => {
      setSelectedPlayerId(registration.id);
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registrations", tournamentId] });
      toast({ title: "Registration included in balancer" });
      fetchPlayerRankHistory(application.battle_tag)
        .then((history) => setPendingRankHistory(history))
        .catch(() => setPendingRankHistory(null));
    },
    onError: (error: Error) => {
      toast({ title: "Failed to include registration", description: error.message, variant: "destructive" });
    },
  });

  const updatePlayerMutation = useMutation({
    mutationFn: async ({ playerId, payload }: { playerId: number; payload: BalancerPlayerUpdateInput }) => {
      const sortedEntries = [...(payload.role_entries_json ?? [])].sort((left, right) => left.priority - right.priority);
      const roles = sortedEntries.map((entry, index) => ({
        role: entry.role,
        subrole: entry.subtype,
        priority: entry.priority,
        is_primary: payload.is_flex ? true : index === 0,
        rank_value: entry.rank_value,
        is_active: entry.is_active,
      }));
      await balancerAdminService.updateRegistration(playerId, {
        roles,
        is_flex: payload.is_flex,
        admin_notes: payload.admin_notes,
      });
      return balancerAdminService.setRegistrationExclusion(playerId, {
        exclude_from_balancer: !(payload.is_in_pool ?? true),
        exclude_reason: payload.is_in_pool ? null : "manual_exclusion",
      });
    },
    onSuccess: async () => {
      setEditingPlayerId(null);
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registrations", tournamentId] });
      toast({ title: "Registration updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update registration", description: error.message, variant: "destructive" });
    },
  });

  const removePlayerMutation = useMutation({
    mutationFn: (playerId: number) =>
      balancerAdminService.setRegistrationExclusion(playerId, {
        exclude_from_balancer: true,
        exclude_reason: "manual_exclusion",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registrations", tournamentId] });
      setEditingPlayerId(null);
      toast({ title: "Registration excluded from balancer" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to exclude registration", description: error.message, variant: "destructive" });
    },
  });

  const includePlayerMutation = useMutation({
    mutationFn: (playerId: number) =>
      balancerAdminService.setRegistrationExclusion(playerId, {
        exclude_from_balancer: false,
        exclude_reason: null,
      }),
    onSuccess: async (registration) => {
      setSelectedPlayerId(registration.id);
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registrations", tournamentId] });
      toast({ title: "Registration added back to pool" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to include registration", description: error.message, variant: "destructive" });
    },
  });

  const runBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!tournamentId) throw new Error("Select a tournament first");
      if (!excludeInvalidPlayers && invalidPlayerStates.length > 0) {
        throw new Error("Resolve all pool player validation issues before balancing");
      }
      const playersForBalance = excludeInvalidPlayers ? readyPlayers : poolPlayers;
      if (playersForBalance.length === 0) throw new Error("No players available to balance");
      const input = buildBalancerInput(playersForBalance);
      const file = new File([JSON.stringify(input)], `balancer-${tournamentId}.json`, { type: "application/json" });
      const config = balancerConfigData?.presets[selectedPreset] ?? balancerConfigData?.defaults;
      const skipped = excludeInvalidPlayers ? invalidPlayerStates.length : 0;
      return { job: await balancerService.createBalanceJob(file, config as BalancerConfig | undefined), skipped };
    },
    onSuccess: ({ job, skipped }) => {
      dispatchJob({ type: "update", status: job.status, message: "Balance job created", progress: 0 });
      balancerService.streamBalanceJob(job.job_id, {
        onEvent: async (event) => {
          dispatchJob({
            type: "update",
            status: event.status,
            message: event.message,
            progress: typeof event.progress?.percent === "number" ? event.progress.percent : null,
          });
          if (event.status === "succeeded") {
            const result = (await balancerService.getBalanceJobResult(job.job_id)) as BalanceJobResult;
            setVariants((current) => {
              const next = [...current];
              const generatedCount = next.filter((v) => v.source === "generated").length;
              result.variants.forEach((variant, batchIndex) => {
                const payload = convertBalanceResponseToInternalPayload(variant);
                next.push({
                  id: `generated-${Date.now()}-${batchIndex}`,
                  label: createVariantLabel(generatedCount + batchIndex + 1),
                  payload,
                  source: "generated",
                  skippedCount: batchIndex === 0 && skipped > 0 ? skipped : undefined,
                });
              });
              const latest = next[next.length - 1];
              setActiveVariantId(latest.id);
              return next;
            });
            dispatchJob({ type: "clear" });
            toast({ title: "Balance completed" });
          }
          if (event.status === "failed") {
            toast({ title: "Balance failed", description: event.message, variant: "destructive" });
          }
        },
        onError: (message) => {
          dispatchJob({ type: "update", status: "failed", message, progress: null });
        },
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to run balancer", description: error.message, variant: "destructive" });
    },
  });

  const saveBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!tournamentId || !activeVariant) throw new Error("No balance selected");
      const config = balancerConfigData?.presets[selectedPreset] ?? balancerConfigData?.defaults ?? null;
      const payload: BalanceSaveInput = {
        config_json: config as Record<string, unknown> | null,
        result_json: activeVariant.payload,
      };
      return balancerAdminService.saveBalance(tournamentId, payload);
    },
    onSuccess: async (savedBalance) => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "balance", tournamentId] });
      const savedVariant = buildVariantFromSavedBalance(savedBalance);
      setVariants((current) => [savedVariant, ...current.filter((v) => v.source !== "saved")]);
      setActiveVariantId(savedVariant.id);
      toast({ title: "Final balance saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save balance", description: error.message, variant: "destructive" });
    },
  });

  const exportBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!savedBalanceData) throw new Error("Save a balance before exporting");
      return balancerAdminService.exportBalance(savedBalanceData.id);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "balance", tournamentId] });
      toast({ title: "Teams exported", description: `${result.imported_teams} teams exported to analytics.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to export balance", description: error.message, variant: "destructive" });
    },
  });

  const importTeamsMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!tournamentId) throw new Error("Select a tournament first");
      return balancerAdminService.importTeamsFromJson(tournamentId, file);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "balance", tournamentId] });
      toast({ title: "Teams imported", description: `${result.imported_teams} teams created.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to import teams", description: error.message, variant: "destructive" });
    },
  });

  return {
    addPlayerMutation,
    updatePlayerMutation,
    removePlayerMutation,
    includePlayerMutation,
    runBalanceMutation,
    saveBalanceMutation,
    exportBalanceMutation,
    importTeamsMutation,
  };
}
