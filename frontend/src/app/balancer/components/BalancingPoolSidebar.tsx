"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Check, Columns3, Kanban, PanelLeftClose, PanelLeftOpen, PlusCircle, Search, Settings2, ShieldX, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AdminRegistration, BalancerApplication, WorkspaceBalancerConfig } from "@/types/balancer-admin.types";
import type { StatusMeta } from "@/types/registration.types";
import type { PlayerValidationState, PoolView, PoolSortValue } from "./balancer-page-helpers";
import { PANEL_CLASS, hasBlockingIssues, sortPlayerStates } from "./balancer-page-helpers";
import { buildPlayerSearchIndex } from "./workspace-helpers";
import { PoolAvailableList } from "./PoolAvailableList";
import { PoolPlayerCompactList } from "./PoolPlayerCompactList";
import { PoolTriageBoard } from "./PoolTriageBoard";
import { WorkspaceBalancerConfigDialog } from "./WorkspaceBalancerConfigDialog";

export type BalancingPoolSidebarHandle = {
  focusNeedsFixView: () => void;
  focusBrowseAvailable: () => void;
};

type PoolFilterOption = { value: PoolView; label: string; announcedLabel?: string; count: number };
type StatusOptionGroups = { system: StatusMeta[]; custom: StatusMeta[] };

const SORT_OPTIONS: Array<{ value: PoolSortValue; label: string }> = [
  { value: "added_asc", label: "Oldest in pool" },
  { value: "added_desc", label: "Newest in pool" },
  { value: "name_asc", label: "Name A-Z" },
  { value: "division_asc", label: "Highest division first" },
  { value: "division_desc", label: "Lowest division first" },
];

const ICON_BUTTON_CLASS =
  "h-8 w-8 rounded-lg border border-[color:var(--aqt-border)] bg-black/15 text-[color:var(--aqt-fg-muted)] hover:bg-white/5 hover:text-[color:var(--aqt-fg)]";

type BalancingPoolSidebarProps = {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  allPlayerValidationStates: PlayerValidationState[];
  applications: BalancerApplication[];
  addableApplications: BalancerApplication[];
  registrationsById?: Map<number, AdminRegistration>;
  balancerStatusOptions?: StatusOptionGroups;
  selectedPlayerId: number | null;
  onSelectPlayer: (playerId: number | null) => void;
  onAddFromApplication: (application: BalancerApplication) => void;
  onSetPoolMembership?: (playerId: number, isInPool: boolean) => unknown;
  onSetBalancerStatus?: (playerId: number, balancerStatus: string) => unknown;
  onBulkPoolMembership?: (playerIds: number[], isInPool: boolean) => unknown;
  onBulkBalancerStatus?: (playerIds: number[], balancerStatus: string) => unknown;
  isAddingPlayer: boolean;
  actionsDisabled?: boolean;
  workspaceId?: number;
  workspaceBalancerConfig?: WorkspaceBalancerConfig | null;
};

function BulkStatusMenu({
  statusOptions,
  disabled,
  onChange,
}: {
  statusOptions?: StatusOptionGroups;
  disabled?: boolean;
  onChange: (status: string) => void;
}) {
  if (!statusOptions) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-7 rounded-lg border-[color:var(--aqt-border-2)] bg-black/15 px-2 text-[11px] text-[color:var(--aqt-fg-muted)] hover:bg-white/5 hover:text-[color:var(--aqt-fg)]"
        >
          <Tag className="mr-1 h-3 w-3" aria-hidden="true" />
          Status
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Set balancer status</DropdownMenuLabel>
        {statusOptions.system.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
            {option.name}
          </DropdownMenuItem>
        ))}
        {statusOptions.custom.length > 0 ? <DropdownMenuSeparator /> : null}
        {statusOptions.custom.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
            {option.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const BalancingPoolSidebar = forwardRef<BalancingPoolSidebarHandle, BalancingPoolSidebarProps>(
  function BalancingPoolSidebar(
    {
      collapsed = false,
      onToggleCollapsed,
      allPlayerValidationStates,
      applications,
      addableApplications,
      registrationsById,
      balancerStatusOptions,
      selectedPlayerId,
      onSelectPlayer,
      onAddFromApplication,
      onSetPoolMembership,
      onSetBalancerStatus,
      onBulkPoolMembership,
      onBulkBalancerStatus,
      isAddingPlayer,
      actionsDisabled = false,
      workspaceId,
      workspaceBalancerConfig,
    },
    ref,
  ) {
    const [poolView, setPoolView] = useState<PoolView>("all");
    const [configDialogOpen, setConfigDialogOpen] = useState(false);
    const [poolSort, setPoolSort] = useState<PoolSortValue>("added_asc");
    const [searchQuery, setSearchQuery] = useState("");
    const [isTriageBoardOpen, setIsTriageBoardOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

    useImperativeHandle(ref, () => ({
      focusNeedsFixView: () => setPoolView("needs_fix"),
      focusBrowseAvailable: () => {
        setPoolView("available");
        setSearchQuery("");
      },
    }));

    const applicationsById = useMemo(() => new Map(applications.map((a) => [a.id, a])), [applications]);

    const poolPlayers = useMemo(
      () => allPlayerValidationStates.filter((s) => s.player.is_in_pool),
      [allPlayerValidationStates],
    );
    const excludedPlayers = useMemo(
      () => allPlayerValidationStates.filter((s) => !s.player.is_in_pool),
      [allPlayerValidationStates],
    );
    const readyPlayers = useMemo(
      () => poolPlayers.filter((s) => !hasBlockingIssues(s.issues)),
      [poolPlayers],
    );
    const invalidPlayers = useMemo(
      () => poolPlayers.filter((s) => hasBlockingIssues(s.issues)),
      [poolPlayers],
    );
    const rankDeltaPlayers = useMemo(
      () => poolPlayers.filter((s) => s.issues.some((i) => i.code === "rank_delta_warning")),
      [poolPlayers],
    );

    const normalizedSearchQuery = searchQuery.trim().toLowerCase();

    const filteredPoolPlayerStates = useMemo(() => {
      const hideFromPool =
        workspaceBalancerConfig?.rank_delta_threshold != null &&
        workspaceBalancerConfig.rank_delta_hide_from_pool;

      const nextStates = allPlayerValidationStates.filter((state) => {
        if (poolView === "rank_delta") {
          if (!state.issues.some((i) => i.code === "rank_delta_warning")) return false;
        } else if (poolView === "excluded") {
          if (state.player.is_in_pool) return false;
        } else {
          if (!state.player.is_in_pool) return false;
          if (hideFromPool && state.issues.some((i) => i.code === "rank_delta_warning")) return false;
          if (poolView === "ready" && hasBlockingIssues(state.issues)) return false;
          if (poolView === "needs_fix" && !hasBlockingIssues(state.issues)) return false;
        }
        if (!normalizedSearchQuery) return true;
        return buildPlayerSearchIndex(
          state.player,
          applicationsById.get(state.player.application_id) ?? null,
        ).includes(normalizedSearchQuery);
      });
      return sortPlayerStates(nextStates, poolSort);
    }, [allPlayerValidationStates, applicationsById, normalizedSearchQuery, poolSort, poolView, workspaceBalancerConfig]);

    const isAvailableView = poolView === "available";

    const poolFilterOptions: PoolFilterOption[] = [
      { value: "all", label: "All", count: poolPlayers.length },
      { value: "ready", label: "Ready", count: readyPlayers.length },
      { value: "needs_fix", label: "Need Fix", count: invalidPlayers.length },
      ...(workspaceBalancerConfig?.rank_delta_threshold != null
        ? [{ value: "rank_delta" as PoolView, label: "Rank Δ", announcedLabel: "Rank delta", count: rankDeltaPlayers.length }]
        : []),
      { value: "excluded", label: "Excluded", count: excludedPlayers.length },
      { value: "available", label: "Available", count: addableApplications.length },
    ];

    const filteredPoolEmptyState = useMemo(() => {
      if (normalizedSearchQuery.length > 0) {
        return { title: "No players match this search", description: "Try another BattleTag, role, or division." };
      }
      if (poolView === "needs_fix") {
        return { title: "No players need fixes right now", description: "Every player in the pool is ready for the balancer." };
      }
      if (poolView === "ready") {
        return { title: "No ready players yet", description: "Fix player conflicts or add ranked roles to start balancing." };
      }
      if (poolView === "excluded") {
        return { title: "No excluded players", description: "Every player is currently included in the Balancing Pool." };
      }
      if (poolView === "rank_delta") {
        return { title: "No rank gaps flagged", description: "No pooled player exceeds the configured rank-delta threshold." };
      }
      return { title: "No players in the pool", description: "Open the Available filter to include approved registrations." };
    }, [normalizedSearchQuery, poolView]);

    const validPlayerIds = useMemo(
      () => new Set(allPlayerValidationStates.map((state) => state.player.id)),
      [allPlayerValidationStates],
    );
    const effectiveSelectedIds = useMemo(
      () => new Set([...selectedIds].filter((id) => validPlayerIds.has(id))),
      [selectedIds, validPlayerIds],
    );
    const selectedPlayerIds = useMemo(() => Array.from(effectiveSelectedIds), [effectiveSelectedIds]);
    const selectedCount = effectiveSelectedIds.size;
    const quickActionsDisabled = actionsDisabled || isAddingPlayer;
    const hasStatusActions =
      balancerStatusOptions != null &&
      balancerStatusOptions.system.length + balancerStatusOptions.custom.length > 0;

    const visibleCount = isAvailableView ? addableApplications.length : filteredPoolPlayerStates.length;

    const toggleSelectedPlayer = (playerId: number) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(playerId)) {
          next.delete(playerId);
        } else {
          next.add(playerId);
        }
        return next;
      });
    };

    const selectAllVisible = () =>
      setSelectedIds(new Set(filteredPoolPlayerStates.map(({ player }) => player.id)));

    const clearSelection = () => setSelectedIds(new Set());

    const runBulkPoolMembership = async (isInPool: boolean) => {
      if (!onBulkPoolMembership || selectedPlayerIds.length === 0) return;
      try {
        await onBulkPoolMembership(selectedPlayerIds, isInPool);
        clearSelection();
      } catch {
        // Mutation callbacks own the user-facing error toast.
      }
    };

    const runBulkBalancerStatus = async (balancerStatus: string) => {
      if (!onBulkBalancerStatus || selectedPlayerIds.length === 0) return;
      try {
        await onBulkBalancerStatus(selectedPlayerIds, balancerStatus);
        clearSelection();
      } catch {
        // Mutation callbacks own the user-facing error toast.
      }
    };

    if (collapsed) {
      return (
        <div className={cn(PANEL_CLASS, "flex min-h-0 flex-col items-center gap-3 p-2")}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(ICON_BUTTON_CLASS, "h-9 w-9 rounded-xl")}
            onClick={onToggleCollapsed}
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Expand Balancing Pool sidebar</span>
          </Button>
          <div className="flex flex-1 flex-col items-center gap-2 pt-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--aqt-border)] bg-black/15 text-[color:var(--aqt-fg-muted)]">
              <Columns3 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="text-center text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)] [writing-mode:vertical-rl]">
              Pool
            </div>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <div className="rounded-lg border border-[color:var(--aqt-border)] bg-black/15 px-2 py-1 text-[11px] tabular-nums text-[color:var(--aqt-fg-muted)]">
              {poolPlayers.length}
            </div>
            {invalidPlayers.length > 0 ? (
              <div
                className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-[11px] tabular-nums text-amber-100"
                title={`${invalidPlayers.length} pooled players need fixes`}
              >
                {invalidPlayers.length}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className={cn(PANEL_CLASS, "flex min-h-0 flex-col p-4")}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]">
              Balancing Pool
            </div>
            <div className="mt-1 text-sm tabular-nums text-[color:var(--aqt-fg-muted)]">
              {poolPlayers.length} players
            </div>
          </div>
          <div className="flex items-center gap-1">
            {workspaceId != null ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={ICON_BUTTON_CLASS}
                onClick={() => setConfigDialogOpen(true)}
              >
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Pool rank-delta settings</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={allPlayerValidationStates.length === 0}
              className={ICON_BUTTON_CLASS}
              onClick={() => setIsTriageBoardOpen(true)}
            >
              <Kanban className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Open the triage board</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ICON_BUTTON_CLASS}
              onClick={onToggleCollapsed}
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Collapse Balancing Pool sidebar</span>
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--aqt-fg-dim)]"
                aria-hidden="true"
              />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search BattleTag or role"
                aria-label="Search the Balancing Pool"
                autoComplete="off"
                className="h-9 rounded-lg border-[color:var(--aqt-border-2)] bg-black/15 pl-9 text-[13px]"
              />
            </div>
            {isAvailableView ? null : (
              <Select value={poolSort} onValueChange={(value) => setPoolSort(value as PoolSortValue)}>
                <SelectTrigger
                  aria-label="Sort players"
                  className="h-9 w-[10rem] shrink-0 rounded-lg border-[color:var(--aqt-border-2)] bg-black/15 text-[11px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter the Balancing Pool">
            {poolFilterOptions.map((option) => {
              const isActive = option.value === poolView;
              const needsAttention = option.value === "needs_fix" && option.count > 0;

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isActive}
                  aria-label={option.announcedLabel}
                  onClick={() => setPoolView(option.value)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "border-[color:var(--aqt-border-3)] bg-white/10 text-[color:var(--aqt-fg)]"
                      : "border-transparent bg-white/[0.03] text-[color:var(--aqt-fg-dim)] hover:bg-white/[0.06] hover:text-[color:var(--aqt-fg)]",
                    needsAttention && !isActive && "border-amber-400/25 bg-amber-500/10 text-amber-100",
                  )}
                >
                  {option.label}
                  <span className="ml-1 text-[11px] tabular-nums opacity-70">{option.count}</span>
                </button>
              );
            })}
          </div>

          {selectedCount > 0 && !isAvailableView ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[color:var(--aqt-border)] bg-black/15 p-1.5">
              <div className="flex items-center gap-1.5 px-1.5 text-[11px] font-medium tabular-nums text-[color:var(--aqt-fg-muted)]">
                <Check className="h-3.5 w-3.5 text-cyan-200" aria-hidden="true" />
                {selectedCount} selected
              </div>
              {selectedCount < filteredPoolPlayerStates.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg border border-[color:var(--aqt-border)] bg-black/15 px-2 text-[11px] text-[color:var(--aqt-fg-muted)] hover:bg-white/5 hover:text-[color:var(--aqt-fg)]"
                  onClick={selectAllVisible}
                >
                  Select all {filteredPoolPlayerStates.length}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={quickActionsDisabled || !onBulkPoolMembership}
                className="h-7 rounded-lg border-[color:var(--aqt-border-2)] bg-black/15 px-2 text-[11px] text-[color:var(--aqt-fg-muted)] hover:bg-white/5 hover:text-[color:var(--aqt-fg)]"
                onClick={() => runBulkPoolMembership(true)}
              >
                <PlusCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                Include
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={quickActionsDisabled || !onBulkPoolMembership}
                className="h-7 rounded-lg border-[color:var(--aqt-border-2)] bg-black/15 px-2 text-[11px] text-[color:var(--aqt-fg-muted)] hover:bg-white/5 hover:text-[color:var(--aqt-fg)]"
                onClick={() => runBulkPoolMembership(false)}
              >
                <ShieldX className="mr-1 h-3 w-3" aria-hidden="true" />
                Exclude
              </Button>
              <BulkStatusMenu
                statusOptions={balancerStatusOptions}
                disabled={quickActionsDisabled || !onBulkBalancerStatus || !hasStatusActions}
                onChange={runBulkBalancerStatus}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7 rounded-lg border border-[color:var(--aqt-border)] bg-black/15 text-[color:var(--aqt-fg-dim)] hover:bg-white/5 hover:text-[color:var(--aqt-fg)]"
                onClick={clearSelection}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Clear selection</span>
              </Button>
            </div>
          ) : null}
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {isAvailableView
            ? `${visibleCount} available registrations`
            : `${visibleCount} players shown`}
        </p>

        <div className="mt-2.5 flex min-h-0 flex-1 flex-col">
          {isAvailableView ? (
            <PoolAvailableList
              applications={addableApplications}
              searchQuery={normalizedSearchQuery}
              onAddFromApplication={onAddFromApplication}
              disabled={isAddingPlayer}
            />
          ) : (
            <PoolPlayerCompactList
              playerStates={filteredPoolPlayerStates}
              registrationsById={registrationsById}
              statusOptions={balancerStatusOptions}
              selectedPlayerId={selectedPlayerId}
              selectedBulkIds={effectiveSelectedIds}
              onToggleBulkSelection={toggleSelectedPlayer}
              onSelectPlayer={onSelectPlayer}
              onSetPoolMembership={onSetPoolMembership}
              onSetBalancerStatus={onSetBalancerStatus}
              actionsDisabled={quickActionsDisabled}
              maxHeightClassName="h-full"
              emptyTitle={filteredPoolEmptyState.title}
              emptyDescription={filteredPoolEmptyState.description}
            />
          )}
        </div>

        <PoolTriageBoard
          open={isTriageBoardOpen}
          onOpenChange={setIsTriageBoardOpen}
          playerStates={allPlayerValidationStates}
          registrationsById={registrationsById}
          statusOptions={balancerStatusOptions}
          selectedPlayerId={selectedPlayerId}
          onSelectPlayer={(playerId) => {
            onSelectPlayer(playerId);
            if (playerId !== null) {
              setIsTriageBoardOpen(false);
            }
          }}
          onSetPoolMembership={onSetPoolMembership}
          onSetBalancerStatus={onSetBalancerStatus}
          actionsDisabled={quickActionsDisabled}
        />

        {workspaceId != null ? (
          <WorkspaceBalancerConfigDialog
            workspaceId={workspaceId}
            config={workspaceBalancerConfig}
            open={configDialogOpen}
            onOpenChange={setConfigDialogOpen}
          />
        ) : null}
      </div>
    );
  },
);
