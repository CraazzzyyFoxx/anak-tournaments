"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Download, Loader2, Sparkles, Upload, Users } from "lucide-react";

import { PoolPlayerCompactList } from "@/app/balancer/_components/PoolPlayerCompactList";
import { PoolSearchCombobox } from "@/app/balancer/_components/PoolSearchCombobox";
import { PlayerEditModal } from "@/app/balancer/_components/PlayerEditModal";
import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
import {
  buildBalancerInput,
  buildTeamNamesText,
  buildVariantFromSavedBalance,
  convertBalanceResponseToInternalPayload,
  downloadPayload,
  fetchPlayerRankHistory,
  getPlayerValidationIssues,
  playerHasRankedRole,
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import balancerAdminService from "@/services/balancer-admin.service";
import balancerService from "@/services/balancer.service";
import { BalanceSaveInput, BalancerApplication, BalancerPlayerRecord, BalancerRoleCode } from "@/types/balancer-admin.types";
import { BalancerConfig } from "@/types/balancer.types";

const PRESET_LABELS: Record<string, string> = {
  DEFAULT: "Standard",
  COMPETITIVE: "Competitive",
  CASUAL: "Casual",
  QUICK: "Quick",
  PREFERENCE_FOCUSED: "Preference Focused",
  HIGH_QUALITY: "High Quality",
};

type PlayerValidationState = {
  player: BalancerPlayerRecord;
  issues: PlayerValidationIssue[];
};

function createVariantLabel(index: number): string {
  return `Run ${index}`;
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

  const balancerConfigQuery = useQuery({
    queryKey: ["balancer-public", "config"],
    queryFn: () => balancerService.getConfig(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const applicationsQuery = useQuery({
    queryKey: ["balancer-public", "applications", tournamentId],
    queryFn: () => balancerAdminService.listApplications(tournamentId as number, true),
    enabled: tournamentId !== null,
  });

  const playersQuery = useQuery({
    queryKey: ["balancer-public", "players", tournamentId],
    queryFn: () => balancerAdminService.listPlayers(tournamentId as number),
    enabled: tournamentId !== null,
  });

  const savedBalanceQuery = useQuery({
    queryKey: ["balancer-public", "balance", tournamentId],
    queryFn: () => balancerAdminService.getBalance(tournamentId as number),
    enabled: tournamentId !== null,
  });

  const sheetQuery = useQuery({
    queryKey: ["balancer-public", "sheet", tournamentId],
    queryFn: () => balancerAdminService.getTournamentSheet(tournamentId as number),
    enabled: tournamentId !== null,
  });

  useEffect(() => {
    setVariants([]);
    setActiveVariantId(null);
    setJobStatus(null);
    setJobMessage(null);
    setJobProgress(null);
    setEditingPlayerId(null);
    setPendingRankHistory(null);
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
  const applicationsById = useMemo(
    () => new Map(applications.map((application) => [application.id, application])),
    [applications],
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
      if (invalidPlayerStates.length > 0) {
        throw new Error("Resolve all pool player validation issues before balancing");
      }

      const input = buildBalancerInput(readyPlayers);
      const file = new File([JSON.stringify(input)], `balancer-${tournamentId}.json`, { type: "application/json" });
      const config = balancerConfigQuery.data?.presets[selectedPreset] ?? balancerConfigQuery.data?.defaults;
      return balancerService.createBalanceJob(file, config as BalancerConfig | undefined);
    },
    onSuccess: (job) => {
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
            const result = await balancerService.getBalanceJobResult(job.job_id);
            const payload = convertBalanceResponseToInternalPayload(result);
            setVariants((current) => {
              const next = [...current];
              next.push({
                id: `generated-${Date.now()}`,
                label: createVariantLabel(next.filter((variant) => variant.source === "generated").length + 1),
                payload,
                source: "generated",
              });
              const latest = next[next.length - 1];
              setActiveVariantId(latest.id);
              return next;
            });
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

  const hasVariants = variants.length > 0;

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
              {invalidPlayerStates.length > 0 && ` · ${invalidPlayerStates.length} need fixes`}
              </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-3 overflow-hidden">
            <PoolSearchCombobox
              players={players}
              applications={applications}
              onSelectPlayer={(playerId) => setEditingPlayerId(playerId)}
              onAddFromApplication={(application) => addPlayerMutation.mutate(application)}
              disabled={addPlayerMutation.isPending}
            />
            <PoolPlayerCompactList
              players={players}
              applications={applications}
              editingPlayerId={editingPlayerId}
              onSelectPlayer={setEditingPlayerId}
              maxHeightClassName="flex-1"
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="rounded-2xl border-border/70 bg-card/80 shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Applications</p>
                <p className="text-lg font-semibold leading-none">{applications.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border/70 bg-card/80 shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">In Pool</p>
                <p className="text-lg font-semibold leading-none">{poolPlayers.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border/70 bg-card/80 shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                <Check className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ready</p>
                <p className="text-lg font-semibold leading-none">
                  {readyPlayers.length}
                  <span className="text-sm font-normal text-muted-foreground">/{poolPlayers.length}</span>
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className={`rounded-2xl border-border/70 shadow-sm ${invalidPlayerStates.length > 0 ? "border-destructive/40 bg-destructive/5" : "bg-card/80"}`}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${invalidPlayerStates.length > 0 ? "bg-destructive/10" : "bg-muted/50"}`}>
                <AlertTriangle className={`h-4 w-4 ${invalidPlayerStates.length > 0 ? "text-destructive" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Invalid</p>
                <p className="text-lg font-semibold leading-none">{invalidPlayerStates.length}</p>
              </div>
            </CardContent>
          </Card>
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
              <Button
                onClick={() => runBalanceMutation.mutate()}
                disabled={runBalanceMutation.isPending || poolPlayers.length === 0}
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

            {/* Row 2: Variant Tabs + Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {hasVariants ? (
                <Tabs value={activeVariantId ?? undefined} onValueChange={setActiveVariantId}>
                  <TabsList>
                    {variants.map((variant) => (
                      <TabsTrigger key={variant.id} value={variant.id}>
                        {variant.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : null}

              {hasVariants ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => saveBalanceMutation.mutate()} disabled={!activeVariant || saveBalanceMutation.isPending}>
                    {saveBalanceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Save final
                  </Button>
                  <Separator orientation="vertical" className="h-6" />
                  <Button variant="secondary" size="sm" onClick={() => activeVariant && downloadPayload(activeVariant.payload, tournamentId)} disabled={!activeVariant}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(buildTeamNamesText(activeVariant?.payload ?? null));
                      toast({ title: "Team names copied" });
                    }}
                    disabled={!activeVariant}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy names
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportBalanceMutation.mutate()} disabled={!savedBalanceQuery.data || exportBalanceMutation.isPending}>
                    {exportBalanceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    Export
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Balance Editor or Empty State */}
            {hasVariants ? (
              <BalanceEditor
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
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/70 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <Sparkles className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">No balance results yet</p>
                  <p className="text-xs text-muted-foreground">Select a preset and run the balancer to generate team compositions.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
