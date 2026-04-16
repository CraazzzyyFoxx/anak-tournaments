"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Shuffle, Users } from "lucide-react";
import { cn } from "@/lib/utils";

import { BalancingPoolSidebar, type BalancingPoolSidebarHandle } from "@/app/balancer/components/BalancingPoolSidebar";
import { PlayerEditModal } from "@/app/balancer/components/PlayerEditSheet";
import { PresetRunPanel } from "@/app/balancer/components/PresetRunPanel";
import { TeamDistributionPanel } from "@/app/balancer/components/TeamDistributionPanel";
import { VariantSelector } from "@/app/balancer/components/VariantSelector";
import { useBalancerTournamentId } from "@/app/balancer/components/useBalancerTournamentId";
import { useBalancerJob } from "@/app/balancer/components/useBalancerJob";
import { useBalancerMutations } from "@/app/balancer/components/useBalancerMutations";
import { useToast } from "@/hooks/use-toast";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { mergeStatusOptions } from "@/lib/balancer-statuses";
import balancerAdminService from "@/services/balancer-admin.service";
import balancerService from "@/services/balancer.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { BalancerRoleCode } from "@/types/balancer-admin.types";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { BalancerActionsPanel } from "./BalancerActionsPanel";
import { BalancerEditorPanel } from "./BalancerEditorPanel";
import {
  getActiveVariantSummary,
  getCanRunBalance,
  getDefaultCollapsedTeamIds,
  getPresetOptions,
  replaceVariantPayload,
  toggleCollapsedTeamId,
  upsertSavedVariant,
  buildBalancerPageCollections,
} from "./balancer-page-selectors";
import {
  buildTeamNamesText,
  buildVariantFromSavedBalance,
  type BalanceVariant,
} from "./workspace-helpers";

export function BalancerMainPageClient() {
  const tournamentId = useBalancerTournamentId();
  const divisionGrid = useDivisionGrid();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sidebarRef = useRef<BalancingPoolSidebarHandle>(null);
  const balanceEditorRef = useRef<HTMLDivElement | null>(null);
  const variantsRef = useRef<BalanceVariant[]>([]);

  const [selectedPreset, setSelectedPreset] = useState("DEFAULT");
  const [jobState, dispatchJob] = useBalancerJob();
  const [variants, setVariants] = useState<BalanceVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [editingPlayerId, setEditingPlayerId] = useState<number | null>(null);
  const [pendingRankHistory, setPendingRankHistory] = useState<Partial<Record<BalancerRoleCode, number>> | null>(null);
  const [excludeInvalidPlayers, setExcludeInvalidPlayers] = useState(false);
  const [collapsedTeamIds, setCollapsedTeamIds] = useState<number[]>([]);
  const [isPoolSidebarCollapsed, setIsPoolSidebarCollapsed] = useState(false);

  const balancerConfigQuery = useQuery({
    queryKey: ["balancer-public", "config"],
    queryFn: () => balancerService.getConfig(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const registrationsQuery = useQuery({
    queryKey: ["balancer-admin", "registrations", tournamentId],
    queryFn: () =>
      balancerAdminService.listRegistrations(tournamentId as number, {
        include_deleted: false,
      }),
    enabled: tournamentId !== null,
    refetchOnWindowFocus: false,
  });

  const savedBalanceQuery = useQuery({
    queryKey: ["balancer-public", "balance", tournamentId],
    queryFn: () => balancerAdminService.getBalance(tournamentId as number),
    enabled: tournamentId !== null,
    refetchOnWindowFocus: false,
  });

  const customStatusesQuery = useQuery({
    queryKey: ["balancer-admin", "status-catalog", workspaceId],
    queryFn: () => balancerAdminService.listStatusCatalog(workspaceId as number),
    enabled: workspaceId !== null,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- Local balancer state intentionally resets when the selected tournament or saved balance changes. */
  useEffect(() => {
    setVariants([]);
    setActiveVariantId(null);
    setSelectedPlayerId(null);
    dispatchJob({ type: "clear" });
    setEditingPlayerId(null);
    setPendingRankHistory(null);
    setExcludeInvalidPlayers(false);
    setIsPoolSidebarCollapsed(false);
  }, [tournamentId]);

  useEffect(() => {
    if (!savedBalanceQuery.data) {
      return;
    }

    const savedVariant = buildVariantFromSavedBalance(savedBalanceQuery.data);
    setVariants((current) => upsertSavedVariant(current, savedVariant));
    setActiveVariantId((current) => current ?? savedVariant.id);
  }, [savedBalanceQuery.data]);

  useEffect(() => {
    variantsRef.current = variants;
  }, [variants]);

  useEffect(() => {
    const activeVariant =
      variantsRef.current.find((variant) => variant.id === activeVariantId) ?? null;
    setCollapsedTeamIds(getDefaultCollapsedTeamIds(activeVariant));
  }, [activeVariantId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const registrations = registrationsQuery.data ?? [];
  const {
    registrationsById,
    applications,
    addableApplications,
    allPlayerValidationStates,
    players,
    readyPlayers,
    poolPlayers,
    invalidPlayerStates,
    missingRankPlayerStates,
    flexPoolCount,
  } = useMemo(
    () => buildBalancerPageCollections(registrations, divisionGrid),
    [divisionGrid, registrations],
  );

  const activeVariant = useMemo(
    () => variants.find((variant) => variant.id === activeVariantId) ?? null,
    [activeVariantId, variants],
  );
  const quickEditPlayer = useMemo(
    () => players.find((player) => player.id === editingPlayerId) ?? null,
    [editingPlayerId, players],
  );
  const quickEditRegistration = useMemo(
    () =>
      editingPlayerId !== null ? registrationsById.get(editingPlayerId) ?? null : null,
    [editingPlayerId, registrationsById],
  );
  const playerStatusOptions = useMemo(
    () => ({
      registration: mergeStatusOptions("registration", customStatusesQuery.data),
      balancer: mergeStatusOptions("balancer", customStatusesQuery.data),
    }),
    [customStatusesQuery.data],
  );
  const presetOptions = useMemo(
    () => getPresetOptions(balancerConfigQuery.data?.presets),
    [balancerConfigQuery.data?.presets],
  );

  const {
    addPlayerMutation,
    updatePlayerMutation,
    removePlayerMutation,
    setPlayerPoolMembershipMutation,
    setBalancerStatusMutation,
    bulkPoolMembershipMutation,
    bulkBalancerStatusMutation,
    runBalanceMutation,
    saveBalanceMutation,
    exportBalanceMutation,
    importTeamsMutation,
  } = useBalancerMutations({
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
    balancerConfigData: balancerConfigQuery.data,
    activeVariant,
    savedBalanceData: savedBalanceQuery.data,
  });

  const canRunBalance = useMemo(
    () =>
      getCanRunBalance({
        isRunPending: runBalanceMutation.isPending,
        poolPlayerCount: poolPlayers.length,
        invalidPlayerCount: invalidPlayerStates.length,
        readyPlayerCount: readyPlayers.length,
        excludeInvalidPlayers,
      }),
    [
      excludeInvalidPlayers,
      invalidPlayerStates.length,
      poolPlayers.length,
      readyPlayers.length,
      runBalanceMutation.isPending,
    ],
  );
  const { hasActiveVariant, activeVariantTeamCount, activeVariantPlayerCount } = useMemo(
    () => getActiveVariantSummary(activeVariant),
    [activeVariant],
  );

  const handleFocusNeedsFixView = useCallback(() => {
    setIsPoolSidebarCollapsed(false);
    sidebarRef.current?.focusNeedsFixView();
  }, []);

  const handleFocusBrowseAvailable = useCallback(() => {
    setIsPoolSidebarCollapsed(false);
    sidebarRef.current?.focusBrowseAvailable();
  }, []);

  const handleOpenPlayerEditor = useCallback((playerId: number | null) => {
    setSelectedPlayerId(playerId);
    setEditingPlayerId(playerId);
  }, []);

  const handleSetPoolMembership = useCallback(
    (playerId: number, isInPool: boolean) =>
      setPlayerPoolMembershipMutation.mutateAsync({ playerId, isInPool }),
    [setPlayerPoolMembershipMutation],
  );

  const handleSetBalancerStatus = useCallback(
    (playerId: number, balancerStatus: string) =>
      setBalancerStatusMutation.mutateAsync({ playerId, balancerStatus }),
    [setBalancerStatusMutation],
  );

  const handleBulkPoolMembership = useCallback(
    (playerIds: number[], isInPool: boolean) =>
      bulkPoolMembershipMutation.mutateAsync({ playerIds, isInPool }),
    [bulkPoolMembershipMutation],
  );

  const handleBulkBalancerStatus = useCallback(
    (playerIds: number[], balancerStatus: string) =>
      bulkBalancerStatusMutation.mutateAsync({ playerIds, balancerStatus }),
    [bulkBalancerStatusMutation],
  );

  const handleBalancePayloadChange = useCallback(
    (payload: Parameters<typeof replaceVariantPayload>[2]) => {
      if (!activeVariantId) {
        return;
      }

      setVariants((current) => replaceVariantPayload(current, activeVariantId, payload));
    },
    [activeVariantId],
  );

  const handleExpandAllTeams = useCallback(() => {
    setCollapsedTeamIds([]);
  }, []);

  const handleCollapseAllTeams = useCallback(() => {
    setCollapsedTeamIds((activeVariant?.payload.teams ?? []).map((team) => team.id));
  }, [activeVariant]);

  const handleToggleTeam = useCallback((teamId: number) => {
    setCollapsedTeamIds((current) => toggleCollapsedTeamId(current, teamId));
  }, []);

  const handleScreenshot = useCallback(async () => {
    if (!balanceEditorRef.current) {
      return;
    }

    try {
      const dataUrl = await toPng(balanceEditorRef.current, { cacheBust: true });
      const link = document.createElement("a");
      link.download = `balance-${tournamentId ?? "export"}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      toast({ title: "Screenshot failed", variant: "destructive" });
    }
  }, [toast, tournamentId]);

  const handleCopyNames = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildTeamNamesText(activeVariant?.payload ?? null));
      toast({ title: "Team names copied" });
    } catch {
      toast({ title: "Clipboard unavailable", variant: "destructive" });
    }
  }, [activeVariant, toast]);

  const quickPoolActionsPending =
    setPlayerPoolMembershipMutation.isPending ||
    setBalancerStatusMutation.isPending ||
    bulkPoolMembershipMutation.isPending ||
    bulkBalancerStatusMutation.isPending;

  const variantSelector =
    variants.length > 1 ? (
      <VariantSelector
        variants={variants}
        activeVariantId={activeVariantId}
        onSelectVariant={setActiveVariantId}
      />
    ) : undefined;

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>
          Choose a tournament in the balancer header to work with registrations and the
          Balancing Pool.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {quickEditPlayer ? (
        <PlayerEditModal
          player={quickEditPlayer}
          registration={quickEditRegistration}
          statusOptions={playerStatusOptions}
          open={editingPlayerId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditingPlayerId(null);
              setPendingRankHistory(null);
            }
          }}
          saving={updatePlayerMutation.isPending}
          onSave={(playerId, payload) => updatePlayerMutation.mutate({ playerId, payload })}
          onRemove={(playerId) => removePlayerMutation.mutate(playerId)}
          rankHistory={pendingRankHistory}
        />
      ) : null}

      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 pb-4">
        <div
          className={cn(
            "grid min-h-0 flex-1 gap-3",
            isPoolSidebarCollapsed
              ? "xl:grid-cols-[72px_minmax(0,1fr)]"
              : "xl:grid-cols-[460px_minmax(0,1fr)]",
          )}
        >
          <BalancingPoolSidebar
            ref={sidebarRef}
            key={tournamentId}
            collapsed={isPoolSidebarCollapsed}
            onToggleCollapsed={() =>
              setIsPoolSidebarCollapsed((current) => !current)
            }
            allPlayerValidationStates={allPlayerValidationStates}
            applications={applications}
            addableApplications={addableApplications}
            registrationsById={registrationsById}
            balancerStatusOptions={playerStatusOptions.balancer}
            selectedPlayerId={selectedPlayerId}
            onSelectPlayer={handleOpenPlayerEditor}
            onAddFromApplication={(application) => addPlayerMutation.mutate(application)}
            onSetPoolMembership={handleSetPoolMembership}
            onSetBalancerStatus={handleSetBalancerStatus}
            onBulkPoolMembership={handleBulkPoolMembership}
            onBulkBalancerStatus={handleBulkBalancerStatus}
            isAddingPlayer={addPlayerMutation.isPending}
            actionsDisabled={quickPoolActionsPending}
            missingRankCount={missingRankPlayerStates.length}
          />

          <div className="flex min-h-0 flex-col gap-3">
            <PresetRunPanel
              counters={[
                { label: "Pool", value: poolPlayers.length, icon: Users },
                { label: "Ready", value: readyPlayers.length, icon: CheckCircle2 },
                { label: "Need Fix", value: invalidPlayerStates.length, icon: AlertTriangle },
                { label: "Flex", value: flexPoolCount, icon: Shuffle },
              ]}
              presetOptions={presetOptions}
              selectedPreset={selectedPreset}
              onSelectPreset={setSelectedPreset}
              invalidPlayerCount={invalidPlayerStates.length}
              excludeInvalidPlayers={excludeInvalidPlayers}
              onExcludeInvalidPlayersChange={setExcludeInvalidPlayers}
              canRunBalance={canRunBalance}
              onRunBalance={() => runBalanceMutation.mutate()}
              isRunPending={runBalanceMutation.isPending}
              jobStatus={jobState.status}
              jobMessage={jobState.message}
              jobProgress={jobState.progress}
            />

            {hasActiveVariant ? (
              <TeamDistributionPanel
                variant={activeVariant}
                variantSelector={variantSelector}
              />
            ) : null}

            <BalancerEditorPanel
              activeVariant={activeVariant}
              activeVariantTeamCount={activeVariantTeamCount}
              activeVariantPlayerCount={activeVariantPlayerCount}
              balanceEditorRef={balanceEditorRef}
              divisionGrid={divisionGrid}
              selectedPlayerId={selectedPlayerId}
              collapsedTeamIds={collapsedTeamIds}
              poolPlayerCount={poolPlayers.length}
              invalidPlayerCount={invalidPlayerStates.length}
              canRunBalance={canRunBalance}
              isRunPending={runBalanceMutation.isPending}
              onChangePayload={handleBalancePayloadChange}
              onSelectPlayer={handleOpenPlayerEditor}
              onToggleTeam={handleToggleTeam}
              onExpandAll={handleExpandAllTeams}
              onCollapseAll={handleCollapseAllTeams}
              onBrowseAvailable={handleFocusBrowseAvailable}
              onReviewConflicts={handleFocusNeedsFixView}
              onRunBalance={() => runBalanceMutation.mutate()}
            />

            <BalancerActionsPanel
              activeVariant={activeVariant}
              hasSavedBalance={!!savedBalanceQuery.data}
              canRunBalance={canRunBalance}
              isRunPending={runBalanceMutation.isPending}
              isSavePending={saveBalanceMutation.isPending}
              isExportPending={exportBalanceMutation.isPending}
              isImportPending={importTeamsMutation.isPending}
              tournamentId={tournamentId}
              onRunBalance={() => runBalanceMutation.mutate()}
              onSaveBalance={() => saveBalanceMutation.mutate()}
              onExportBalance={() => exportBalanceMutation.mutate()}
              onCopyNames={handleCopyNames}
              onImportTeams={(file) => importTeamsMutation.mutate(file)}
              onScreenshot={handleScreenshot}
            />
          </div>
        </div>
      </div>
    </>
  );
}
