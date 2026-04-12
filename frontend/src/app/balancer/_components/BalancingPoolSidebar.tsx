"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BalancerApplication } from "@/types/balancer-admin.types";
import type { PlayerValidationState, PoolView, PoolSortValue } from "./balancer-page-helpers";
import { PANEL_CLASS, sortPlayerStates } from "./balancer-page-helpers";
import { buildPlayerSearchIndex } from "./workspace-helpers";
import { PoolSearchCombobox } from "./PoolSearchCombobox";
import { PoolPlayerCompactList } from "./PoolPlayerCompactList";

export type BalancingPoolSidebarHandle = {
  focusNeedsFixView: () => void;
  focusBrowseAvailable: () => void;
};

type PoolFilterOption = { value: PoolView; label: string; count: number };

type BalancingPoolSidebarProps = {
  allPlayerValidationStates: PlayerValidationState[];
  applications: BalancerApplication[];
  addableApplications: BalancerApplication[];
  selectedPlayerId: number | null;
  onSelectPlayer: (playerId: number | null) => void;
  onAddFromApplication: (application: BalancerApplication) => void;
  isAddingPlayer: boolean;
  missingRankCount?: number;
};

export const BalancingPoolSidebar = forwardRef<BalancingPoolSidebarHandle, BalancingPoolSidebarProps>(
  function BalancingPoolSidebar(
    {
      allPlayerValidationStates,
      applications,
      addableApplications,
      selectedPlayerId,
      onSelectPlayer,
      onAddFromApplication,
      isAddingPlayer,
      missingRankCount = 0,
    },
    ref,
  ) {
    const [poolView, setPoolView] = useState<PoolView>("all");
    const [poolSort, setPoolSort] = useState<PoolSortValue>("added_desc");
    const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
    const [sidebarSearchMode, setSidebarSearchMode] = useState<"default" | "applications">("default");
    const [showSidebarFilters, setShowSidebarFilters] = useState(false);

    useImperativeHandle(ref, () => ({
      focusNeedsFixView: () => {
        setPoolView("needs_fix");
        setSidebarSearchMode("default");
      },
      focusBrowseAvailable: () => {
        setPoolView("all");
        setSidebarSearchQuery("");
        setSidebarSearchMode("applications");
      },
    }));

    const applicationsById = useMemo(
      () => new Map(applications.map((a) => [a.id, a])),
      [applications],
    );

    const poolPlayers = useMemo(
      () => allPlayerValidationStates.filter((s) => s.player.is_in_pool),
      [allPlayerValidationStates],
    );
    const excludedPlayers = useMemo(
      () => allPlayerValidationStates.filter((s) => !s.player.is_in_pool),
      [allPlayerValidationStates],
    );
    const readyPlayers = useMemo(
      () => poolPlayers.filter((s) => s.issues.length === 0),
      [poolPlayers],
    );
    const invalidPlayers = useMemo(
      () => poolPlayers.filter((s) => s.issues.length > 0),
      [poolPlayers],
    );

    const normalizedSearchQuery = sidebarSearchQuery.trim().toLowerCase();

    const filteredPoolPlayerStates = useMemo(() => {
      const nextStates = allPlayerValidationStates.filter((state) => {
        if (poolView === "excluded") {
          if (state.player.is_in_pool) return false;
        } else if (!state.player.is_in_pool) {
          return false;
        }
        if (poolView === "ready" && state.issues.length > 0) return false;
        if (poolView === "needs_fix" && state.issues.length === 0) return false;
        if (!normalizedSearchQuery) return true;
        return buildPlayerSearchIndex(
          state.player,
          applicationsById.get(state.player.application_id) ?? null,
        ).includes(normalizedSearchQuery);
      });
      return sortPlayerStates(nextStates, poolSort);
    }, [allPlayerValidationStates, applicationsById, normalizedSearchQuery, poolSort, poolView]);

    const sidebarPlayerCount = poolView === "excluded" ? excludedPlayers.length : poolPlayers.length;

    const poolFilterOptions: PoolFilterOption[] = [
      { value: "all", label: "All", count: poolPlayers.length },
      { value: "excluded", label: "Excluded", count: excludedPlayers.length },
      { value: "needs_fix", label: "Need Fix", count: invalidPlayers.length },
      { value: "ready", label: "Ready", count: readyPlayers.length },
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
      return { title: "No players in the pool", description: "Use the search above to include approved registrations in the Balancing Pool." };
    }, [normalizedSearchQuery, poolView]);

    return (
      <div className={cn(PANEL_CLASS, "flex min-h-0 flex-col p-4")}>
        <div className="space-y-2.5">
          {/* Missing rank alert */}
          {missingRankCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                setPoolView("needs_fix");
                setSidebarSearchMode("default");
              }}
              className="flex w-full items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-500/8 px-3 py-2 text-left transition hover:bg-amber-500/12"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span className="text-xs text-amber-100/80">
                {missingRankCount} player{missingRankCount !== 1 ? "s" : ""} need ranked roles
              </span>
            </button>
          ) : null}

          {/* Search */}
          <PoolSearchCombobox
            playerStates={allPlayerValidationStates}
            applications={applications}
            value={sidebarSearchQuery}
            onValueChange={(nextValue) => {
              setSidebarSearchQuery(nextValue);
              if (nextValue.trim().length > 0) {
                setSidebarSearchMode("default");
              }
            }}
            sortValue={poolSort}
            onSortValueChange={(value) => setPoolSort(value as PoolSortValue)}
            showFilters={showSidebarFilters}
            onShowFiltersChange={setShowSidebarFilters}
            onSelectPlayer={(playerId) => {
              onSelectPlayer(playerId);
              setSidebarSearchMode("default");
            }}
            onAddFromApplication={onAddFromApplication}
            disabled={isAddingPlayer}
            suggestionsMode={sidebarSearchMode}
          />

          {/* Pool / Add mode toggle */}
          <div className="flex items-center justify-between">
            <div className="flex rounded-lg border border-white/8 bg-black/15 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setSidebarSearchQuery("");
                  setSidebarSearchMode("default");
                }}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                  sidebarSearchMode === "default"
                    ? "bg-white/10 text-white"
                    : "text-white/45 hover:text-white/70",
                )}
              >
                Pool
              </button>
              <button
                type="button"
                onClick={() => {
                  setSidebarSearchQuery("");
                  setSidebarSearchMode("applications");
                }}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                  sidebarSearchMode === "applications"
                    ? "bg-white/10 text-white"
                    : "text-white/45 hover:text-white/70",
                )}
              >
                Add{addableApplications.length > 0 ? ` (${addableApplications.length})` : ""}
              </button>
            </div>
            <span className="text-[10px] text-white/30">
              {addableApplications.length} available
            </span>
          </div>

          {/* Filter pills + count */}
          <div className="flex flex-wrap items-center gap-1.5">
            {poolFilterOptions.map((option) => {
              const isActive = option.value === poolView;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setPoolView(option.value);
                    setSidebarSearchMode("default");
                  }}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                    isActive
                      ? "bg-white/10 text-white"
                      : "bg-white/3 text-white/45 hover:bg-white/6 hover:text-white/80",
                  )}
                >
                  {option.label}
                  <span className="ml-1 text-[10px] text-white/30">{option.count}</span>
                </button>
              );
            })}
            <span className="ml-auto text-[10px] text-white/30">
              {filteredPoolPlayerStates.length} / {sidebarPlayerCount}
            </span>
          </div>
        </div>

        <div className="mt-2.5 min-h-0 flex-1">
          {sidebarSearchMode === "applications" ? (
            <ScrollArea className="h-full">
              <div className="space-y-1 pr-1">
                {addableApplications.length > 0 ? (
                  addableApplications.map((application) => (
                    <button
                      key={application.id}
                      type="button"
                      disabled={isAddingPlayer}
                      onClick={() => onAddFromApplication(application)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/5 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                      <span className="min-w-0 flex-1 truncate text-sm text-white/80">{application.battle_tag}</span>
                      <span className="shrink-0 text-[10px] text-white/30">Include</span>
                    </button>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
                    <p className="text-sm font-medium text-white/50">No available registrations</p>
                    <p className="text-xs text-white/30">All approved registrations are already in the pool.</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : (
            <PoolPlayerCompactList
              playerStates={filteredPoolPlayerStates}
              selectedPlayerId={selectedPlayerId}
              onSelectPlayer={(playerId) => {
                onSelectPlayer(playerId);
                if (playerId !== null) {
                  setSidebarSearchMode("default");
                }
              }}
              maxHeightClassName="h-full"
              emptyTitle={filteredPoolEmptyState.title}
              emptyDescription={filteredPoolEmptyState.description}
            />
          )}
        </div>
      </div>
    );
  },
);
