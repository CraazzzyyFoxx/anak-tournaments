"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  BarChart2,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Search,
  Shuffle,
  Sparkles,
  Upload,
  UserX,
  Users,
  type LucideIcon,
} from "lucide-react";

import { PoolPlayerCompactList } from "@/app/balancer/_components/PoolPlayerCompactList";
import { PoolSearchCombobox } from "@/app/balancer/_components/PoolSearchCombobox";
import { PlayerEditModal } from "@/app/balancer/_components/PlayerEditModal";
import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
import {
  buildBalancerInput,
  buildPlayerSearchIndex,
  buildTeamNamesText,
  buildVariantFromSavedBalance,
  convertBalanceResponseToInternalPayload,
  downloadPayload,
  fetchPlayerRankHistory,
  getActiveRoleEntries,
  getPlayerValidationIssues,
  type BalanceVariant,
  type PlayerValidationIssue,
} from "@/app/balancer/_components/workspace-helpers";
import { BalanceEditor } from "@/components/balancer/BalanceEditor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import balancerAdminService from "@/services/balancer-admin.service";
import balancerService from "@/services/balancer.service";
import { BalanceSaveInput, BalancerApplication, BalancerPlayerRecord, BalancerRoleCode } from "@/types/balancer-admin.types";
import { BalanceJobResult, BalancerConfig } from "@/types/balancer.types";

const PRESET_LABELS: Record<string, string> = {
  DEFAULT: "Standard",
  COMPETITIVE: "Competitive",
  CASUAL: "Casual",
  QUICK: "Quick",
  PREFERENCE_FOCUSED: "Preference Focused",
  HIGH_QUALITY: "High Quality",
  CPSAT: "CP-SAT (Exact)",
};

type PlayerValidationState = {
  player: BalancerPlayerRecord;
  issues: PlayerValidationIssue[];
};

type PoolView = "all" | "needs_fix" | "ready" | "excluded";
type PoolSortValue = "added_desc" | "name_asc" | "division_asc" | "division_desc";

type StatsFilterCardProps = {
  label: string;
  value: number;
  helperText: string;
  icon: LucideIcon;
  iconClassName: string;
  active?: boolean;
  onClick: () => void;
};

function createVariantLabel(index: number): string {
  return `Balance ${index}`;
}

function getPrimaryDivision(player: BalancerPlayerRecord): number {
  const activeEntries = getActiveRoleEntries(player.role_entries_json);
  if (activeEntries.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return activeEntries[0]?.division_number ?? Number.POSITIVE_INFINITY;
}

function sortPlayerStates(playerStates: PlayerValidationState[], sortValue: PoolSortValue): PlayerValidationState[] {
  return [...playerStates].sort((left, right) => {
    if (sortValue === "name_asc") {
      return left.player.battle_tag.localeCompare(right.player.battle_tag);
    }

    if (sortValue === "division_asc") {
      return getPrimaryDivision(left.player) - getPrimaryDivision(right.player);
    }

    if (sortValue === "division_desc") {
      return getPrimaryDivision(right.player) - getPrimaryDivision(left.player);
    }

    return right.player.id - left.player.id;
  });
}

function StatsFilterCard({
  label,
  value,
  helperText,
  icon: Icon,
  iconClassName,
  active = false,
  onClick,
}: StatsFilterCardProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-2xl border border-border/70 bg-card/80 p-4 text-left shadow-sm transition-all hover:border-primary/35 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active && "border-primary/45 bg-primary/5 shadow-md",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", iconClassName)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold leading-none text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>
        </div>
      </div>
    </button>
  );
}

export default function BalancerMainPage() {
  const tournamentId = useBalancerTournamentId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedPreset, setSelectedPreset] = useState("DEFAULT");
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number | null>(null);
  const [variants, setVariants] = useState<BalanceVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [editingPlayerId, setEditingPlayerId] = useState<number | null>(null);
  const [pendingRankHistory, setPendingRankHistory] = useState<Partial<Record<BalancerRoleCode, number>> | null>(null);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [sidebarSearchMode, setSidebarSearchMode] = useState<"default" | "applications">("default");
  const [poolView, setPoolView] = useState<PoolView>("all");
  const [poolSort, setPoolSort] = useState<PoolSortValue>("added_desc");
  const [showSidebarFilters, setShowSidebarFilters] = useState(false);
  const [excludeInvalidPlayers, setExcludeInvalidPlayers] = useState(false);

  const balanceEditorRef = useRef<HTMLDivElement>(null);

  const clearJobState = () => {
    setJobStatus(null);
    setJobMessage(null);
    setJobProgress(null);
  };

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

  const balancerConfigQuery = useQuery({
    queryKey: ["balancer-public", "config"],
    queryFn: () => balancerService.getConfig(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const applicationsQuery = useQuery({
    queryKey: ["balancer-public", "applications", tournamentId],
    queryFn: () => balancerAdminService.listApplications(tournamentId as number, true),
    enabled: tournamentId !== null,
    refetchOnWindowFocus: false,
  });

  const playersQuery = useQuery({
    queryKey: ["balancer-public", "players", tournamentId],
    queryFn: () => balancerAdminService.listPlayers(tournamentId as number),
    enabled: tournamentId !== null,
    refetchOnWindowFocus: false,
  });

  const savedBalanceQuery = useQuery({
    queryKey: ["balancer-public", "balance", tournamentId],
    queryFn: () => balancerAdminService.getBalance(tournamentId as number),
    enabled: tournamentId !== null,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setVariants([]);
    setActiveVariantId(null);
    clearJobState();
    setEditingPlayerId(null);
    setPendingRankHistory(null);
    setSidebarSearchQuery("");
    setSidebarSearchMode("default");
    setPoolView("all");
    setPoolSort("added_desc");
    setShowSidebarFilters(false);
    setExcludeInvalidPlayers(false);
  }, [tournamentId]);

  useEffect(() => {
    if (!savedBalanceQuery.data) {
      return;
    }

    const savedVariant = buildVariantFromSavedBalance(savedBalanceQuery.data);
    setVariants((current) => [savedVariant, ...current.filter((variant) => variant.source !== "saved")]);
    setActiveVariantId((current) => current ?? savedVariant.id);
  }, [savedBalanceQuery.data]);

  const applications = applicationsQuery.data ?? [];
  const players = playersQuery.data ?? [];
  const poolPlayers = useMemo(() => players.filter((player) => player.is_in_pool), [players]);
  const excludedPlayers = useMemo(() => players.filter((player) => !player.is_in_pool), [players]);
  const applicationsById = useMemo(
    () => new Map(applications.map((application) => [application.id, application])),
    [applications],
  );
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
    () => playerValidationStates.filter((state) => state.issues.length === 0).map((state) => state.player),
    [playerValidationStates],
  );
  const invalidPlayerStates = useMemo(
    () => playerValidationStates.filter((state) => state.issues.length > 0),
    [playerValidationStates],
  );
  const missingRankPlayerStates = useMemo(
    () => invalidPlayerStates.filter((state) => state.issues.some((issue) => issue.code === "missing_ranked_role")),
    [invalidPlayerStates],
  );
  const addableApplications = useMemo(
    () => applications.filter((application) => application.is_active && application.player === null),
    [applications],
  );
  const normalizedSidebarSearchQuery = sidebarSearchQuery.trim().toLowerCase();
  const filteredPoolPlayerStates = useMemo(() => {
    const nextStates = allPlayerValidationStates.filter((state) => {
      if (poolView === "excluded") {
        if (state.player.is_in_pool) {
          return false;
        }
      } else if (!state.player.is_in_pool) {
        return false;
      }

      if (poolView === "ready" && state.issues.length > 0) {
        return false;
      }

      if (poolView === "needs_fix" && state.issues.length === 0) {
        return false;
      }

      if (!normalizedSidebarSearchQuery) {
        return true;
      }

      return buildPlayerSearchIndex(state.player, applicationsById.get(state.player.application_id) ?? null).includes(
        normalizedSidebarSearchQuery,
      );
    });

    return sortPlayerStates(nextStates, poolSort);
  }, [allPlayerValidationStates, applicationsById, normalizedSidebarSearchQuery, poolSort, poolView]);
  const sidebarPlayerCount = poolView === "excluded" ? excludedPlayers.length : poolPlayers.length;
  const activeSidebarSummary =
    sidebarSearchMode === "applications" && normalizedSidebarSearchQuery.length === 0 ? "applications" : poolView;
  const filteredPoolEmptyState = useMemo(() => {
    if (normalizedSidebarSearchQuery.length > 0) {
      return {
        title: "No players match this search",
        description: "Try another BattleTag, role, or division.",
      };
    }

    if (poolView === "needs_fix") {
      return {
        title: "No players need fixes right now",
        description: "Every player in the pool is ready for the balancer.",
      };
    }

    if (poolView === "ready") {
      return {
        title: "No ready players yet",
        description: "Fix player conflicts or add ranked roles to start balancing.",
      };
    }

    if (poolView === "excluded") {
      return {
        title: "No excluded players",
        description: "Every player is currently included in the balancing pool.",
      };
    }

    return {
      title: "No players in the pool",
      description: "Use the search above to add players from applications.",
    };
  }, [normalizedSidebarSearchQuery, poolView]);
  const quickEditPlayer = players.find((player) => player.id === editingPlayerId) ?? null;
  const activeVariant = useMemo(
    () => variants.find((variant) => variant.id === activeVariantId) ?? null,
    [activeVariantId, variants],
  );

  const addPlayerMutation = useMutation({
    mutationFn: async (application: BalancerApplication) => {
      if (!tournamentId) {
        throw new Error("Select a tournament first");
      }
      return balancerAdminService.createPlayersFromApplications(tournamentId, {
        application_ids: [application.id],
      });
    },
    onSuccess: async (playersCreated, application) => {
      const createdPlayer = playersCreated[0];
      if (createdPlayer) {
        setEditingPlayerId(createdPlayer.id);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] }),
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] }),
      ]);
      toast({ title: "Player added to pool" });
      fetchPlayerRankHistory(application.battle_tag)
        .then((history) => setPendingRankHistory(history))
        .catch(() => setPendingRankHistory(null));
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add player", description: error.message, variant: "destructive" });
    },
  });

  const updatePlayerMutation = useMutation({
    mutationFn: ({ playerId, payload }: { playerId: number; payload: Parameters<typeof balancerAdminService.updatePlayer>[1] }) =>
      balancerAdminService.updatePlayer(playerId, payload),
    onSuccess: async () => {
      setEditingPlayerId(null);
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] });
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] });
      toast({ title: "Player updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update player", description: error.message, variant: "destructive" });
    },
  });

  const removePlayerMutation = useMutation({
    mutationFn: (playerId: number) => balancerAdminService.deletePlayer(playerId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] }),
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] }),
      ]);
      setEditingPlayerId(null);
      toast({ title: "Player removed from pool" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove player", description: error.message, variant: "destructive" });
    },
  });

  const runBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!tournamentId) {
        throw new Error("Select a tournament first");
      }
      if (!excludeInvalidPlayers && invalidPlayerStates.length > 0) {
        throw new Error("Resolve all pool player validation issues before balancing");
      }

      const playersForBalance = excludeInvalidPlayers ? readyPlayers : poolPlayers;
      if (playersForBalance.length === 0) {
        throw new Error("No players available to balance");
      }

      const input = buildBalancerInput(playersForBalance);
      const file = new File([JSON.stringify(input)], `balancer-${tournamentId}.json`, { type: "application/json" });
      const config = balancerConfigQuery.data?.presets[selectedPreset] ?? balancerConfigQuery.data?.defaults;
      const skipped = excludeInvalidPlayers ? invalidPlayerStates.length : 0;
      return { job: await balancerService.createBalanceJob(file, config as BalancerConfig | undefined), skipped };
    },
    onSuccess: ({ job, skipped }) => {
      setJobStatus(job.status);
      setJobMessage("Balance job created");
      setJobProgress(0);

      balancerService.streamBalanceJob(job.job_id, {
        onEvent: async (event) => {
          setJobStatus(event.status);
          setJobMessage(event.message);
          if (typeof event.progress?.percent === "number") {
            setJobProgress(event.progress.percent);
          }

          if (event.status === "succeeded") {
            const result = await balancerService.getBalanceJobResult(job.job_id) as BalanceJobResult;
            setVariants((current) => {
              const next = [...current];
              const generatedCount = next.filter((variant) => variant.source === "generated").length;
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
            clearJobState();
            toast({ title: "Balance completed" });
          }

          if (event.status === "failed") {
            toast({ title: "Balance failed", description: event.message, variant: "destructive" });
          }
        },
        onError: (message) => {
          setJobStatus("failed");
          setJobMessage(message);
        },
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to run balancer", description: error.message, variant: "destructive" });
    },
  });

  const saveBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!tournamentId || !activeVariant) {
        throw new Error("No balance selected");
      }
      const config = balancerConfigQuery.data?.presets[selectedPreset] ?? balancerConfigQuery.data?.defaults ?? null;
      const payload: BalanceSaveInput = {
        config_json: config as Record<string, unknown> | null,
        result_json: activeVariant.payload,
      };
      return balancerAdminService.saveBalance(tournamentId, payload);
    },
    onSuccess: async (savedBalance) => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "balance", tournamentId] });
      const savedVariant = buildVariantFromSavedBalance(savedBalance);
      setVariants((current) => [savedVariant, ...current.filter((variant) => variant.source !== "saved")]);
      setActiveVariantId(savedVariant.id);
      toast({ title: "Final balance saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save balance", description: error.message, variant: "destructive" });
    },
  });

  const exportBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!savedBalanceQuery.data) {
        throw new Error("Save a balance before exporting");
      }
      return balancerAdminService.exportBalance(savedBalanceQuery.data.id);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "balance", tournamentId] });
      toast({ title: "Teams exported", description: `${result.imported_teams} teams exported to analytics.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to export balance", description: error.message, variant: "destructive" });
    },
  });

  const emptyWorkspaceState = excludeInvalidPlayers && readyPlayers.length === 0 && invalidPlayerStates.length > 0
    ? {
        icon: UserX,
        title: "All pool players have issues — nothing to balance",
        description: "Every player in the pool has unresolved issues. Fix at least one player before running the balancer.",
        actionLabel: "Review conflicts",
        actionVariant: "outline" as const,
        action: () => {
          setPoolView("needs_fix");
          setSidebarSearchMode("default");
        },
        actionDisabled: false,
      }
    : invalidPlayerStates.length > 0 && !excludeInvalidPlayers
    ? {
        icon: AlertTriangle,
        title: `${invalidPlayerStates.length} player${invalidPlayerStates.length !== 1 ? "s" : ""} need review before balancing`,
        description: "Resolve role conflicts and missing ranked roles in the player pool before you run the balancer.",
        actionLabel: "Review conflicts",
        actionVariant: "outline" as const,
        action: () => {
          setPoolView("needs_fix");
          setSidebarSearchMode("default");
        },
        actionDisabled: false,
      }
    : poolPlayers.length === 0
      ? {
          icon: Search,
          title: "Add players to the pool first",
          description: "Use the application search to bring active applications into the player pool.",
          actionLabel: "Browse applications",
          actionVariant: "outline" as const,
          action: () => {
            setPoolView("all");
            setSidebarSearchQuery("");
            setSidebarSearchMode("applications");
          },
          actionDisabled: false,
        }
      : {
          icon: Sparkles,
          title: "No balance results yet",
          description: "Pick a preset and run the balancer to generate team compositions from the current pool.",
          actionLabel: "Run balance",
          actionVariant: "default" as const,
          action: () => runBalanceMutation.mutate(),
          actionDisabled: runBalanceMutation.isPending,
        };

  const hasVariants = variants.length > 0;
  const EmptyWorkspaceIcon = emptyWorkspaceState.icon;

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>Choose a tournament in the balancer header to work with applications and pool players.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid flex-1 gap-6 xl:min-h-0 xl:grid-cols-[minmax(280px,25%)_1fr] xl:grid-rows-[1fr] xl:overflow-hidden">
      {/* ── Left Sidebar ── */}
      <div className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col rounded-2xl border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Player Pool</CardTitle>
            <CardDescription>
              {poolPlayers.length} player{poolPlayers.length !== 1 ? "s" : ""} in pool
              {excludedPlayers.length > 0 ? ` · ${excludedPlayers.length} excluded` : ""}
              {invalidPlayerStates.length > 0 ? ` · ${invalidPlayerStates.length} need fixes` : " · all clear"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-3 overflow-hidden">
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
                setEditingPlayerId(playerId);
                setSidebarSearchMode("default");
              }}
              onAddFromApplication={(application) => addPlayerMutation.mutate(application)}
              disabled={addPlayerMutation.isPending}
              suggestionsMode={sidebarSearchMode}
            />

            <ToggleGroup
              type="single"
              value={poolView}
              onValueChange={(nextValue) => {
                if (!nextValue) {
                  return;
                }
                setPoolView(nextValue as PoolView);
                setSidebarSearchMode("default");
              }}
              variant="outline"
              size="sm"
              className="w-full rounded-xl border border-border/70 bg-muted/20 p-1"
            >
              <ToggleGroupItem value="all" className="flex-1 justify-between rounded-lg px-3 text-xs">
                <span>All</span>
                <span className="text-muted-foreground">{poolPlayers.length}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="excluded" className="flex-1 justify-between rounded-lg px-3 text-xs">
                <span>Excluded</span>
                <span className="text-muted-foreground">{excludedPlayers.length}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="needs_fix" className="flex-1 justify-between rounded-lg px-3 text-xs">
                <span>Need Fix</span>
                <span className="text-muted-foreground">{invalidPlayerStates.length}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="ready" className="flex-1 justify-between rounded-lg px-3 text-xs">
                <span>Ready</span>
                <span className="text-muted-foreground">{readyPlayers.length}</span>
              </ToggleGroupItem>
            </ToggleGroup>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {filteredPoolPlayerStates.length} of {sidebarPlayerCount}
              </span>
              <span className="uppercase tracking-[0.14em]">
                {poolView === "all"
                  ? "All"
                  : poolView === "needs_fix"
                    ? "Need Fix"
                    : poolView === "excluded"
                      ? "Excluded"
                      : "Ready"}
              </span>
            </div>

            <PoolPlayerCompactList
              playerStates={filteredPoolPlayerStates}
              editingPlayerId={editingPlayerId}
              onSelectPlayer={setEditingPlayerId}
              maxHeightClassName="flex-1"
              emptyTitle={filteredPoolEmptyState.title}
              emptyDescription={filteredPoolEmptyState.description}
            />
          </CardContent>
        </Card>

      </div>

      {quickEditPlayer ? (
        <PlayerEditModal
          player={quickEditPlayer}
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

      {/* ── Right Workspace ── */}
      <div className="flex min-h-0 flex-col gap-4">
        {/* Stats Summary Strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatsFilterCard
            label="Applications"
            value={applications.length}
            helperText={`${addableApplications.length} ready to add`}
            icon={Search}
            iconClassName="bg-primary/10 text-primary"
            active={activeSidebarSummary === "applications"}
            onClick={() => {
              setPoolView("all");
              setSidebarSearchQuery("");
              setSidebarSearchMode("applications");
            }}
          />
          <StatsFilterCard
            label="In Pool"
            value={poolPlayers.length}
            helperText="Browse every player in the pool"
            icon={Users}
            iconClassName="bg-primary/10 text-primary"
            active={activeSidebarSummary === "all"}
            onClick={() => {
              setPoolView("all");
              setSidebarSearchMode("default");
            }}
          />
          <StatsFilterCard
            label="Excluded"
            value={excludedPlayers.length}
            helperText={excludedPlayers.length > 0 ? "Hidden from balancing runs" : "No excluded players"}
            icon={UserX}
            iconClassName="bg-slate-500/10 text-slate-600"
            active={activeSidebarSummary === "excluded"}
            onClick={() => {
              setPoolView("excluded");
              setSidebarSearchMode("default");
            }}
          />
          <StatsFilterCard
            label="Ready"
            value={readyPlayers.length}
            helperText={`${poolPlayers.length > 0 ? Math.round((readyPlayers.length / poolPlayers.length) * 100) : 0}% of pool ready`}
            icon={CheckCircle2}
            iconClassName="bg-emerald-500/10 text-emerald-600"
            active={activeSidebarSummary === "ready"}
            onClick={() => {
              setPoolView("ready");
              setSidebarSearchMode("default");
            }}
          />
          <StatsFilterCard
            label="Need Fix"
            value={invalidPlayerStates.length}
            helperText={invalidPlayerStates.length > 0 ? "Open the review queue" : "No blocking issues"}
            icon={AlertTriangle}
            iconClassName={invalidPlayerStates.length > 0 ? "bg-destructive/10 text-destructive" : "bg-muted/50 text-muted-foreground"}
            active={activeSidebarSummary === "needs_fix"}
            onClick={() => {
              setPoolView("needs_fix");
              setSidebarSearchMode("default");
            }}
          />
        </div>

        {/* Job Progress */}
        {jobStatus ? (
          <Card className="rounded-2xl border-border/70 bg-card/80 shadow-sm">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Balance Job</span>
                <Badge variant={jobStatus === "succeeded" ? "default" : jobStatus === "failed" ? "destructive" : "outline"}>
                  {jobStatus}
                </Badge>
              </div>
              {jobProgress !== null ? <Progress value={jobProgress} className="h-2" /> : null}
              {jobMessage ? <p className="text-xs text-muted-foreground">{jobMessage}</p> : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Workspace Card */}
        <Card className="flex min-h-0 flex-1 flex-col rounded-2xl border-border/70 bg-card/80 shadow-sm">
          {/* Row 1: Config + Run */}
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
            <div className="min-w-0">
              <CardTitle>Balance Workspace</CardTitle>
              <CardDescription>Run candidates, tweak rosters, save the final balance, and export.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(balancerConfigQuery.data?.presets ?? { DEFAULT: {} }).map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {PRESET_LABELS[preset] ?? preset}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {invalidPlayerStates.length > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5">
                  <Switch
                    id="exclude-invalid"
                    checked={excludeInvalidPlayers}
                    onCheckedChange={setExcludeInvalidPlayers}
                    className="data-[state=checked]:bg-amber-500"
                  />
                  <Label htmlFor="exclude-invalid" className="flex cursor-pointer items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <UserX className="h-3.5 w-3.5" />
                    Skip {invalidPlayerStates.length} problem player{invalidPlayerStates.length !== 1 ? "s" : ""}
                  </Label>
                </div>
              )}
              <Button
                onClick={() => runBalanceMutation.mutate()}
                disabled={
                  runBalanceMutation.isPending ||
                  poolPlayers.length === 0 ||
                  (!excludeInvalidPlayers && invalidPlayerStates.length > 0) ||
                  (excludeInvalidPlayers && readyPlayers.length === 0)
                }
                className="shadow-lg shadow-primary/20"
              >
                {runBalanceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Run balance
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col space-y-4 overflow-hidden">
            {/* Invalid Players Alert with clickable names */}
            {missingRankPlayerStates.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Pool requires fixes</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>Players without any ranked role:</span>
                    {missingRankPlayerStates.map(({ player }) => (
                      <button
                        key={`missing-rank-${player.id}`}
                        type="button"
                        onClick={() => setEditingPlayerId(player.id)}
                        className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive underline-offset-2 transition-colors hover:bg-destructive/20 hover:underline"
                      >
                        {player.battle_tag}
                      </button>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            {/* Row 2: Variant Cards + Action Buttons */}
            {hasVariants ? (
              <div className="flex flex-wrap gap-2">
                {variants.map((variant) => {
                  const stats = variant.payload.statistics;
                  const isActive = variant.id === activeVariantId;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => setActiveVariantId(variant.id)}
                      className={cn(
                        "flex flex-col gap-2 rounded-xl border px-4 py-3 text-left transition-all",
                        "hover:border-white/20 hover:bg-white/[0.04]",
                        isActive
                          ? "border-primary/60 bg-primary/[0.08] shadow-sm shadow-primary/10"
                          : "border-white/[0.07] bg-white/[0.02]",
                      )}
                    >
                      {/* Header row */}
                      <div className="flex items-center gap-2">
                        <span className={cn("text-sm font-semibold", isActive ? "text-white" : "text-white/70")}>
                          {variant.label}
                        </span>
                        {variant.skippedCount != null && variant.skippedCount > 0 && (
                          <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-400">
                            <UserX className="h-2.5 w-2.5" />
                            {variant.skippedCount}
                          </Badge>
                        )}
                      </div>
                      {/* Stats row */}
                      {stats && (
                        <div className="flex items-center gap-3 text-[11px]">
                          {stats.mmrStdDev !== undefined && (
                            <span className="flex items-center gap-1 text-white/40">
                              <BarChart2 className="h-3 w-3 text-blue-400/70" />
                              <span className="tabular-nums text-white/60">{stats.mmrStdDev.toFixed(1)}</span>
                            </span>
                          )}
                          {stats.offRoleCount !== undefined && (
                            <span className="flex items-center gap-1 text-white/40">
                              <AlertCircle className="h-3 w-3 text-orange-400/70" />
                              <span className={cn("tabular-nums", stats.offRoleCount > 0 ? "text-orange-400" : "text-white/60")}>
                                {stats.offRoleCount}
                              </span>
                            </span>
                          )}
                          {stats.subRoleCollisionCount !== undefined && (
                            <span className="flex items-center gap-1 text-white/40">
                              <Shuffle className="h-3 w-3 text-violet-400/70" />
                              <span className={cn("tabular-nums", stats.subRoleCollisionCount > 0 ? "text-violet-400" : "text-white/60")}>
                                {stats.subRoleCollisionCount}
                              </span>
                            </span>
                          )}
                          {stats.unbalancedCount !== undefined && stats.unbalancedCount > 0 && (
                            <span className="flex items-center gap-1">
                              <UserX className="h-3 w-3 text-red-400/70" />
                              <span className="tabular-nums text-red-400">{stats.unbalancedCount}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* Action Buttons + Active Variant Stats */}
            {hasVariants ? (
              <TooltipProvider delayDuration={300}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Buttons */}
                  <div className="flex items-center gap-1.5">
                    <Button onClick={() => saveBalanceMutation.mutate()} disabled={!activeVariant || saveBalanceMutation.isPending} size="sm">
                      {saveBalanceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      Save final
                    </Button>
                    <Separator orientation="vertical" className="mx-0.5 h-6" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => activeVariant && downloadPayload(activeVariant.payload, tournamentId)} disabled={!activeVariant}>
                          <Download className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download JSON</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={async () => { await navigator.clipboard.writeText(buildTeamNamesText(activeVariant?.payload ?? null)); toast({ title: "Team names copied" }); }} disabled={!activeVariant}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy team names</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => exportBalanceMutation.mutate()} disabled={!savedBalanceQuery.data || exportBalanceMutation.isPending}>
                          {exportBalanceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export to spreadsheet</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleScreenshot()} disabled={!activeVariant}>
                          <Camera className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Save as image</TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Active variant stats inline */}
                  {activeVariant?.payload.statistics && (() => {
                    const s = activeVariant.payload.statistics;
                    return (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {s.mmrStdDev !== undefined && (
                          <span className="flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1">
                            <BarChart2 className="h-3 w-3 text-blue-400" />
                            <span className="text-white/50">StdDev:</span>
                            <span className="tabular-nums text-white/70">{s.mmrStdDev.toFixed(1)}</span>
                          </span>
                        )}
                        {s.offRoleCount !== undefined && (
                          <span className="flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1">
                            <AlertCircle className="h-3 w-3 text-orange-400" />
                            <span className="text-white/50">Off-role:</span>
                            <span className={cn("tabular-nums", s.offRoleCount > 0 ? "text-orange-400" : "text-white/70")}>{s.offRoleCount}</span>
                          </span>
                        )}
                        {s.subRoleCollisionCount !== undefined && (
                          <span className="flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1">
                            <Shuffle className="h-3 w-3 text-violet-400" />
                            <span className="text-white/50">Collisions:</span>
                            <span className={cn("tabular-nums", s.subRoleCollisionCount > 0 ? "text-violet-400" : "text-white/70")}>{s.subRoleCollisionCount}</span>
                          </span>
                        )}
                        {s.unbalancedCount !== undefined && (
                          <span className="flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1">
                            <UserX className="h-3 w-3 text-red-400" />
                            <span className="text-white/50">Unbalanced:</span>
                            <span className={cn("tabular-nums", s.unbalancedCount > 0 ? "text-red-400" : "text-white/70")}>{s.unbalancedCount}</span>
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </TooltipProvider>
            ) : null}

            {/* Balance Editor or Empty State */}
            {hasVariants ? (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <BalanceEditor
                  ref={balanceEditorRef}
                  value={activeVariant?.payload ?? null}
                  onChange={(payload) => {
                    if (!activeVariantId) {
                      return;
                    }
                    setVariants((current) =>
                      current.map((variant) => (variant.id === activeVariantId ? { ...variant, payload } : variant)),
                    );
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/70 bg-muted/10 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <EmptyWorkspaceIcon className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="max-w-md space-y-1.5">
                  <p className="text-sm font-medium">{emptyWorkspaceState.title}</p>
                  <p className="text-xs text-muted-foreground">{emptyWorkspaceState.description}</p>
                </div>
                <Button
                  variant={emptyWorkspaceState.actionVariant}
                  onClick={emptyWorkspaceState.action}
                  disabled={emptyWorkspaceState.actionDisabled}
                >
                  {emptyWorkspaceState.actionLabel}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
