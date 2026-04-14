"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Shuffle, Users } from "lucide-react";

import { BalanceActionsBar } from "@/app/balancer/_components/BalanceActionsBar";
import { BalancingPoolSidebar, type BalancingPoolSidebarHandle } from "@/app/balancer/_components/BalancingPoolSidebar";
import { PlayerEditModal } from "@/app/balancer/_components/PlayerEditModal";
import { PresetRunPanel } from "@/app/balancer/_components/PresetRunPanel";
import { TeamDistributionPanel } from "@/app/balancer/_components/TeamDistributionPanel";
import { VariantSelector } from "@/app/balancer/_components/VariantSelector";
import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
import { useBalancerJob } from "@/app/balancer/_components/useBalancerJob";
import { useBalancerMutations } from "@/app/balancer/_components/useBalancerMutations";
import {
  buildTeamNamesText,
  buildVariantFromSavedBalance,
  createSyntheticApplicationFromRegistration,
  createSyntheticPlayerFromRegistration,
  downloadPayload,
  getPlayerValidationIssues,
  isRegistrationAvailableForBalancer,
  type BalanceVariant,
} from "@/app/balancer/_components/workspace-helpers";
import {
  countTeamPlayers,
  PANEL_CLASS,
  type PlayerValidationState,
} from "@/app/balancer/_components/balancer-page-helpers";
import { BalanceEditor } from "@/components/balancer/BalanceEditor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { mergeStatusOptions } from "@/lib/balancer-statuses";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import balancerAdminService from "@/services/balancer-admin.service";
import balancerService from "@/services/balancer.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { BalancerRoleCode } from "@/types/balancer-admin.types";

type WorkflowStepProps = {
  step: number;
  label: string;
  status: "done" | "active" | "pending";
  detail: string;
  isLast?: boolean;
  action?: { label: string; onClick: () => void; variant?: "primary"; disabled?: boolean };
};

function WorkflowStep({ step, label, status, detail, isLast, action }: WorkflowStepProps) {
  return (
    <div className="flex gap-4">
      {/* Step indicator + connector line */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-4",
            status === "done"
              ? "bg-emerald-500/20 text-emerald-300 ring-emerald-500/8"
              : status === "active"
                ? "bg-violet-500/25 text-violet-300 ring-violet-500/10"
                : "bg-white/5 text-white/20 ring-white/3",
          )}
        >
          {status === "done" ? (
            <CheckCircle2 className="h-4.5 w-4.5" />
          ) : (
            step
          )}
        </div>
        {!isLast ? (
          <div className={cn(
            "mt-2 w-px flex-1",
            status === "done" ? "bg-emerald-500/20" : "bg-white/8",
          )} />
        ) : null}
      </div>

      {/* Content */}
      <div className={cn("pb-8", isLast && "pb-0")}>
        <div className={cn(
          "mt-1.5 text-sm font-semibold leading-none",
          status === "pending" ? "text-white/25" : "text-white/90",
        )}>
          {label}
        </div>
        <div className={cn(
          "mt-1.5 text-xs",
          status === "pending" ? "text-white/18" : "text-white/40",
        )}>
          {detail}
        </div>
        {action && status === "active" ? (
          <Button
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled}
            className={cn(
              "mt-3 rounded-lg",
              action.variant === "primary"
                ? "bg-violet-500 text-white hover:bg-violet-400"
                : "border border-white/10 bg-black/15 text-white/70 hover:bg-white/5 hover:text-white",
            )}
          >
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default function BalancerMainPage() {
  const tournamentId = useBalancerTournamentId();
  const divisionGrid = useDivisionGrid();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sidebarRef = useRef<BalancingPoolSidebarHandle>(null);

  const [selectedPreset, setSelectedPreset] = useState("DEFAULT");
  const [jobState, dispatchJob] = useBalancerJob();
  const [variants, setVariants] = useState<BalanceVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [editingPlayerId, setEditingPlayerId] = useState<number | null>(null);
  const [pendingRankHistory, setPendingRankHistory] = useState<Partial<Record<BalancerRoleCode, number>> | null>(null);
  const [excludeInvalidPlayers, setExcludeInvalidPlayers] = useState(false);
  const [collapsedTeamIds, setCollapsedTeamIds] = useState<number[]>([]);

  const balanceEditorRef = useRef<HTMLDivElement>(null);
  // Stable ref so the collapsed-teams effect can read the latest variants
  // without declaring it as a dependency (avoids resetting collapsed state
  // on every drag-and-drop reorder, only on variant switches).
  const variantsRef = useRef<BalanceVariant[]>([]);

  // ── Queries ──────────────────────────────────────────────────────────────

  const balancerConfigQuery = useQuery({
    queryKey: ["balancer-public", "config"],
    queryFn: () => balancerService.getConfig(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const registrationsQuery = useQuery({
    queryKey: ["balancer-admin", "registrations", tournamentId],
    queryFn: () => balancerAdminService.listRegistrations(tournamentId as number, { include_deleted: false }),
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

  // ── Reset on tournament change ────────────────────────────────────────

  useEffect(() => {
    setVariants([]);
    setActiveVariantId(null);
    setSelectedPlayerId(null);
    dispatchJob({ type: "clear" });
    setEditingPlayerId(null);
    setPendingRankHistory(null);
    setExcludeInvalidPlayers(false);
  }, [tournamentId]);

  useEffect(() => {
    if (!savedBalanceQuery.data) return;
    const savedVariant = buildVariantFromSavedBalance(savedBalanceQuery.data);
    setVariants((current) => [savedVariant, ...current.filter((v) => v.source !== "saved")]);
    setActiveVariantId((current) => current ?? savedVariant.id);
  }, [savedBalanceQuery.data]);

  // Keep the ref in sync so the collapsed-state effect reads fresh variants
  // without triggering a reset on every reorder (using no-dep effect ordering).
  useEffect(() => {
    variantsRef.current = variants;
  });

  // Reset collapsed state when the active variant switches (not on every reorder).
  useEffect(() => {
    const variant = variantsRef.current.find((v) => v.id === activeVariantId) ?? null;
    if (!variant?.payload.teams.length) {
      setCollapsedTeamIds([]);
      return;
    }
    const teamIds = variant.payload.teams.map((t) => t.id);
    const expandedByDefault = new Set(teamIds.slice(0, 4));
    setCollapsedTeamIds(teamIds.filter((id) => !expandedByDefault.has(id)));
  }, [activeVariantId]);

  // ── Derived data ─────────────────────────────────────────────────────

  const registrations = registrationsQuery.data ?? [];
  const registrationsById = useMemo(
    () => new Map(registrations.map((r) => [r.id, r])),
    [registrations],
  );
  const players = useMemo(
    () => registrations.map((r) => createSyntheticPlayerFromRegistration(r, divisionGrid)),
    [divisionGrid, registrations],
  );
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const applications = useMemo(
    () =>
      registrations
        .filter((r) => isRegistrationAvailableForBalancer(r))
        .map((r) =>
          createSyntheticApplicationFromRegistration(
            r,
            playersById.get(r.id)?.is_in_pool ? playersById.get(r.id) ?? null : null,
          ),
        ),
    [playersById, registrations],
  );
  const applicationsById = useMemo(
    () => new Map(applications.map((a) => [a.id, a])),
    [applications],
  );
  const poolPlayers = useMemo(() => players.filter((p) => p.is_in_pool), [players]);

  const allPlayerValidationStates = useMemo<PlayerValidationState[]>(
    () =>
      players.map((player) => ({
        player,
        issues: getPlayerValidationIssues(player, applicationsById.get(player.application_id) ?? null),
      })),
    [applicationsById, players],
  );
  const playerValidationStates = useMemo<PlayerValidationState[]>(
    () =>
      poolPlayers.map((player) => ({
        player,
        issues: getPlayerValidationIssues(player, applicationsById.get(player.application_id) ?? null),
      })),
    [applicationsById, poolPlayers],
  );
  const readyPlayers = useMemo(
    () => playerValidationStates.filter((s) => s.issues.length === 0).map((s) => s.player),
    [playerValidationStates],
  );
  const invalidPlayerStates = useMemo(
    () => playerValidationStates.filter((s) => s.issues.length > 0),
    [playerValidationStates],
  );
  const missingRankPlayerStates = useMemo(
    () => invalidPlayerStates.filter((s) => s.issues.some((i) => i.code === "missing_ranked_role")),
    [invalidPlayerStates],
  );
  const addableApplications = useMemo(
    () => applications.filter((a) => a.is_active && a.player === null),
    [applications],
  );
  const flexPoolCount = useMemo(
    () => poolPlayers.filter((p) => p.is_flex).length,
    [poolPlayers],
  );

  const activeVariant = useMemo(
    () => variants.find((v) => v.id === activeVariantId) ?? null,
    [activeVariantId, variants],
  );
  const quickEditPlayer = players.find((p) => p.id === editingPlayerId) ?? null;
  const quickEditRegistration = editingPlayerId !== null ? registrationsById.get(editingPlayerId) ?? null : null;
  const playerStatusOptions = useMemo(
    () => ({
      registration: mergeStatusOptions("registration", customStatusesQuery.data),
      balancer: mergeStatusOptions("balancer", customStatusesQuery.data),
    }),
    [customStatusesQuery.data],
  );

  const presetOptions = Object.keys(balancerConfigQuery.data?.presets ?? { DEFAULT: {} });

  // ── Mutations ─────────────────────────────────────────────────────────

  const {
    addPlayerMutation,
    updatePlayerMutation,
    removePlayerMutation,
    includePlayerMutation,
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

  // ── Derived flags ─────────────────────────────────────────────────────

  const canRunBalance =
    !runBalanceMutation.isPending &&
    poolPlayers.length > 0 &&
    (!excludeInvalidPlayers ? invalidPlayerStates.length === 0 : readyPlayers.length > 0);

  const hasActiveVariant = activeVariant !== null;
  const activeVariantTeamCount = activeVariant?.payload.teams.length ?? 0;
  const activeVariantPlayerCount =
    activeVariant?.payload.teams.reduce((sum, team) => sum + countTeamPlayers(team), 0) ?? 0;

  const handleFocusNeedsFixView = useCallback(() => {
    sidebarRef.current?.focusNeedsFixView();
  }, []);
  const handleFocusBrowseAvailable = useCallback(() => {
    sidebarRef.current?.focusBrowseAvailable();
  }, []);
  const handleOpenPlayerEditor = useCallback((playerId: number | null) => {
    setSelectedPlayerId(playerId);
    setEditingPlayerId(playerId);
  }, []);


  // ── Handlers ──────────────────────────────────────────────────────────

  const handleScreenshot = async () => {
    if (!balanceEditorRef.current) return;
    try {
      const dataUrl = await toPng(balanceEditorRef.current, { cacheBust: true });
      const link = document.createElement("a");
      link.download = `balance-${tournamentId ?? "export"}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      toast({ title: "Screenshot failed", variant: "destructive" });
    }
  };

  const handleCopyNames = async () => {
    try {
      await navigator.clipboard.writeText(buildTeamNamesText(activeVariant?.payload ?? null));
      toast({ title: "Team names copied" });
    } catch {
      toast({ title: "Clipboard unavailable", variant: "destructive" });
    }
  };

  const handleToggleTeam = (teamId: number) =>
    setCollapsedTeamIds((current) =>
      current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId],
    );

  // ── Empty tournament guard ────────────────────────────────────────────

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>
          Choose a tournament in the balancer header to work with registrations and the Balancing Pool.
        </AlertDescription>
      </Alert>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

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
        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[380px_minmax(0,1fr)]">
          {/* Left sidebar — key resets internal state on tournament switch */}
          <BalancingPoolSidebar
            ref={sidebarRef}
            key={tournamentId}
            allPlayerValidationStates={allPlayerValidationStates}
            applications={applications}
            addableApplications={addableApplications}
            selectedPlayerId={selectedPlayerId}
            onSelectPlayer={handleOpenPlayerEditor}
            onAddFromApplication={(application) => addPlayerMutation.mutate(application)}
            isAddingPlayer={addPlayerMutation.isPending}
            missingRankCount={missingRankPlayerStates.length}
          />

          {/* Main content */}
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
                variantSelector={
                  variants.length > 1 ? (
                    <VariantSelector
                      variants={variants}
                      activeVariantId={activeVariantId}
                      onSelectVariant={setActiveVariantId}
                    />
                  ) : undefined
                }
              />
            ) : null}

            {/* Balance editor / empty state */}
            <div className={cn(PANEL_CLASS, "flex min-h-0 flex-1 flex-col p-4")}>
              {hasActiveVariant ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white/88">
                        {activeVariantTeamCount} teams / {activeVariantPlayerCount} players
                      </div>
                      <div className="text-xs text-white/38">
                        Drag players between team slots to tweak the final draft.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl border-white/10 bg-black/15 text-white/70 hover:bg-white/5 hover:text-white"
                        onClick={() => setCollapsedTeamIds([])}
                        disabled={activeVariantTeamCount === 0}
                      >
                        Expand all
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl border-white/10 bg-black/15 text-white/70 hover:bg-white/5 hover:text-white"
                        onClick={() =>
                          setCollapsedTeamIds(
                            (activeVariant?.payload.teams ?? []).map((team) => team.id),
                          )
                        }
                        disabled={activeVariantTeamCount === 0}
                      >
                        Collapse all
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                    <BalanceEditor
                      ref={balanceEditorRef}
                      value={activeVariant?.payload ?? null}
                      onChange={(payload) => {
                        if (!activeVariantId) return;
                        setVariants((current) =>
                          current.map((v) => (v.id === activeVariantId ? { ...v, payload } : v)),
                        );
                      }}
                      divisionGrid={divisionGrid}
                      selectedPlayerId={selectedPlayerId}
                      onSelectPlayer={handleOpenPlayerEditor}
                      collapsedTeamIds={collapsedTeamIds}
                      onToggleTeam={handleToggleTeam}
                    />
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/2">
                  <div className="w-full max-w-sm px-6">
                    <WorkflowStep
                      step={1}
                      label="Add players to pool"
                      status={poolPlayers.length > 0 ? "done" : "active"}
                      detail={poolPlayers.length > 0 ? `${poolPlayers.length} player${poolPlayers.length !== 1 ? "s" : ""} included` : "Use search to bring approved registrations into the pool"}
                      action={poolPlayers.length === 0 ? { label: "Browse available", onClick: handleFocusBrowseAvailable } : undefined}
                    />
                    <WorkflowStep
                      step={2}
                      label="Resolve issues"
                      status={
                        poolPlayers.length === 0
                          ? "pending"
                          : invalidPlayerStates.length === 0
                            ? "done"
                            : "active"
                      }
                      detail={
                        invalidPlayerStates.length > 0
                          ? `${invalidPlayerStates.length} player${invalidPlayerStates.length !== 1 ? "s" : ""} need fixes`
                          : "All players are ready"
                      }
                      action={invalidPlayerStates.length > 0 ? { label: "Review conflicts", onClick: handleFocusNeedsFixView } : undefined}
                    />
                    <WorkflowStep
                      step={3}
                      label="Run the balancer"
                      isLast
                      status={canRunBalance ? "active" : "pending"}
                      detail="Pick a preset above and generate team compositions"
                      action={canRunBalance ? { label: "Run balance", onClick: () => runBalanceMutation.mutate(), variant: "primary" as const, disabled: runBalanceMutation.isPending } : undefined}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Action bar */}
            {hasActiveVariant ? (
              <div className={cn(PANEL_CLASS)}>
                <BalanceActionsBar
                  activeVariantStats={activeVariant.payload.statistics ?? null}
                  activeVariant={activeVariant}
                  hasSavedBalance={!!savedBalanceQuery.data}
                  canRunBalance={canRunBalance}
                  isRunPending={runBalanceMutation.isPending}
                  isSavePending={saveBalanceMutation.isPending}
                  isExportPending={exportBalanceMutation.isPending}
                  isImportPending={importTeamsMutation.isPending}
                  onRunBalance={() => runBalanceMutation.mutate()}
                  onSaveBalance={() => saveBalanceMutation.mutate()}
                  onExportBalance={() => exportBalanceMutation.mutate()}
                  onDownloadJson={() => {
                    if (activeVariant) downloadPayload(activeVariant.payload, tournamentId);
                  }}
                  onCopyNames={handleCopyNames}
                  onImportTeams={(file) => importTeamsMutation.mutate(file)}
                  onScreenshot={handleScreenshot}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
