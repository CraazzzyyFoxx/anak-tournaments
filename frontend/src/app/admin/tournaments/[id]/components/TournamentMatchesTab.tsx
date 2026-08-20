"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  Clock,
  FileCheck2,
  FileX2,
  Pencil,
  Plus,
  RefreshCw,
  Swords,
  Trash2,
  Trophy,
  Upload
} from "lucide-react";
import {
  AdminDetailTableShell,
  getAdminDetailTableStyles
} from "@/components/admin/AdminDetailTable";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EncounterScoreControls } from "@/components/tournaments/EncounterScoreControls";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { TeamCombobox } from "@/components/admin/TeamCombobox";
import TeamName from "@/components/TeamName";
import { buildEncounterName } from "@/components/admin/encounter-name";
import { isGroupStageScoreContext } from "@/components/admin/encounter-score";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { hasUnsavedChanges } from "@/lib/form-change";
import { notify } from "@/lib/notify";
import { ariaSortValue } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type {
  EncounterCreateInput,
  EncounterEditableStatus,
  EncounterUpdateInput,
  StandingUpdateInput
} from "@/types/admin.types";
import type { Encounter } from "@/types/encounter.types";
import type { Team } from "@/types/team.types";
import type { Stage, Standings } from "@/types/tournament.types";
import {
  TOURNAMENT_DETAIL_PREVIEW_LIMIT,
  getEmptyEncounterForm,
  getEncounterForm,
  getEncounterScopeKey,
  getEncounterStageLabel,
  getStageScopeGroups,
  getStandingForm,
  getStandingGroups,
  getStandingScopeKey,
  getStandingScopeLabel,
  sortStandings,
  type EncounterFormState,
  type StandingFormState,
  type StandingSortKey,
  type StandingSortState
} from "./tournamentWorkspace.helpers";
import { TournamentLogUploadDialog } from "./TournamentLogUploadDialog";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";

const ENCOUNTERS_SCOPE_QUERY_PARAM = "encountersScope";
const STANDINGS_SCOPE_QUERY_PARAM = "standingsScope";

interface TournamentMatchesTabProps {
  tournamentId: number;
  teams: Team[];
  stages: Stage[];
  encounters: Encounter[];
  standings: Standings[];
  hasChallongeSource: boolean;
  canCreateEncounter: boolean;
  canUpdateEncounter: boolean;
  canDeleteEncounter: boolean;
  canSyncEncounters: boolean;
  canUpdateStanding: boolean;
  canDeleteStanding: boolean;
  canRecalculateStandings: boolean;
}

function SortIcon({ state, active }: Readonly<{ state: StandingSortState; active: boolean }>) {
  if (!active || !state) return <ArrowUpDown className="size-3.5" aria-hidden />;
  return state.dir === "asc" ? (
    <ArrowUp className="size-3.5" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5" aria-hidden />
  );
}

function setScopeParam(params: URLSearchParams, key: string, value: string) {
  if (value === "all") {
    params.delete(key);
    return;
  }

  params.set(key, value);
}

interface ScopeFilterProps {
  id: string;
  param: string;
  value: string;
  groups: Array<{ id: string; name: string }>;
  onChange: (param: string, value: string) => void;
}

/** Stage/scope narrowing control shared by the encounters and standings tables. */
function ScopeFilter({ id, param, value, groups, onChange }: Readonly<ScopeFilterProps>) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Scope
      </Label>
      <Select value={value} onValueChange={(next) => onChange(param, next)}>
        <SelectTrigger id={id} className="h-8 w-[220px]">
          <SelectValue placeholder="All stages" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All stages</SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function TournamentMatchesTab({
  tournamentId,
  teams,
  stages,
  encounters,
  standings,
  hasChallongeSource,
  canCreateEncounter,
  canUpdateEncounter,
  canDeleteEncounter,
  canSyncEncounters,
  canUpdateStanding,
  canDeleteStanding,
  canRecalculateStandings
}: Readonly<TournamentMatchesTabProps>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const tableStyles = getAdminDetailTableStyles("compact");

  const defaultStage = stages[0] ?? null;
  const defaultStageId = defaultStage?.id ?? null;
  const defaultStageItemId = defaultStage?.items[0]?.id ?? null;
  const canCreateEncounterNow = canCreateEncounter && teams.length >= 2 && stages.length > 0;
  const canManageStandingsNow = canRecalculateStandings && encounters.length > 0;

  const [encounterDialogOpen, setEncounterDialogOpen] = useState(false);
  const [editingEncounter, setEditingEncounter] = useState<Encounter | null>(null);
  const [encounterFormData, setEncounterFormData] = useState<EncounterFormState>(
    getEmptyEncounterForm(defaultStageId, defaultStageItemId)
  );
  const [encounterFormError, setEncounterFormError] = useState<string | undefined>();
  const [encounterPendingDelete, setEncounterPendingDelete] = useState<Encounter | null>(null);

  const [editingStanding, setEditingStanding] = useState<Standings | null>(null);
  const [standingDialogOpen, setStandingDialogOpen] = useState(false);
  const [standingFormData, setStandingFormData] = useState<StandingFormState>({
    position: 0,
    points: 0,
    win: 0,
    draw: 0,
    lose: 0
  });
  const [standingPendingDelete, setStandingPendingDelete] = useState<Standings | null>(null);
  const [standingsExpanded, setStandingsExpanded] = useState(false);
  const [standingsSort, setStandingsSort] = useState<StandingSortState>(null);

  const replaceSearchParams = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  const updateScopeFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      setScopeParam(params, key, value);
      replaceSearchParams(params);
    },
    [replaceSearchParams, searchParams]
  );

  const resetEncounterDialog = () => {
    setEncounterDialogOpen(false);
    setEditingEncounter(null);
    setEncounterFormData(getEmptyEncounterForm(defaultStageId, defaultStageItemId));
    setEncounterFormError(undefined);
    saveEncounterMutation.reset();
  };

  const resetStandingDialog = () => {
    setStandingDialogOpen(false);
    setEditingStanding(null);
    setStandingFormData({ position: 0, points: 0, win: 0, draw: 0, lose: 0 });
    updateStandingMutation.reset();
  };

  const saveEncounterMutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: async ({
      mode,
      encounterId,
      data
    }: {
      mode: "create" | "update";
      encounterId?: number;
      data: EncounterCreateInput | EncounterUpdateInput;
    }) => {
      if (mode === "create") {
        return adminService.createEncounter(data as EncounterCreateInput);
      }

      return adminService.updateEncounter(encounterId!, data as EncounterUpdateInput);
    },
    onSuccess: (_data, variables) => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      resetEncounterDialog();
      notify.success(variables.mode === "create" ? "Encounter created" : "Encounter updated");
    },
    onError: (error: Error) => {
      setEncounterFormError(`Could not save the encounter. ${error.message}`);
    }
  });

  const deleteEncounterMutation = useMutation({
    mutationFn: (encounterId: number) => adminService.deleteEncounter(encounterId),
    onSuccess: () => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      setEncounterPendingDelete(null);
      notify.success("Encounter deleted");
    }
  });

  const syncEncountersMutation = useMutation({
    mutationFn: () => adminService.syncEncountersFromChallonge(tournamentId),
    onSuccess: () => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      notify.success("Encounters synced from Challonge");
    }
  });

  const updateStandingMutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: ({ standingId, data }: { standingId: number; data: StandingUpdateInput }) =>
      adminService.updateStanding(standingId, data),
    onSuccess: () => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      resetStandingDialog();
      notify.success("Standing updated");
    }
  });

  const deleteStandingMutation = useMutation({
    mutationFn: (standingId: number) => adminService.deleteStanding(standingId),
    onSuccess: () => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      setStandingPendingDelete(null);
      notify.success("Standing deleted");
    }
  });

  const calculateStandingsMutation = useMutation({
    mutationFn: () => adminService.calculateStandings(tournamentId),
    onSuccess: () => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      notify.success("Standings calculated");
    }
  });

  const recalculateStandingsMutation = useMutation({
    mutationFn: async () => {
      await adminService.recalculateStandings(tournamentId);
      return adminService.calculateStandings(tournamentId);
    },
    onSuccess: () => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      notify.success("Standings recalculated");
    }
  });

  const openCreateEncounterDialog = () => {
    setEncounterFormError(undefined);
    setEditingEncounter(null);
    setEncounterFormData(getEmptyEncounterForm(defaultStageId, defaultStageItemId));
    setEncounterDialogOpen(true);
  };

  const openEditEncounterDialog = (encounter: Encounter) => {
    setEncounterFormError(undefined);
    setEditingEncounter(encounter);
    setEncounterFormData(getEncounterForm(encounter));
    setEncounterDialogOpen(true);
  };

  const openEditStandingDialog = (standing: Standings) => {
    updateStandingMutation.reset();
    setEditingStanding(standing);
    setStandingFormData(getStandingForm(standing));
    setStandingDialogOpen(true);
  };

  const handleEncounterSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!encounterFormData.name.trim()) {
      setEncounterFormError("Enter an encounter name.");
      return;
    }

    if (encounterFormData.stage_id == null) {
      setEncounterFormError("Select a stage before saving the encounter.");
      return;
    }

    if (
      encounterFormData.home_team_id != null &&
      encounterFormData.away_team_id != null &&
      encounterFormData.home_team_id === encounterFormData.away_team_id
    ) {
      setEncounterFormError("Pick two different teams.");
      return;
    }

    const payload = editingEncounter
      ? ({
          name: encounterFormData.name.trim(),
          stage_id: encounterFormData.stage_id,
          stage_item_id: encounterFormData.stage_item_id,
          home_team_id: encounterFormData.home_team_id,
          away_team_id: encounterFormData.away_team_id,
          round: encounterFormData.round,
          home_score: encounterFormData.home_score,
          away_score: encounterFormData.away_score,
          status: encounterFormData.status as EncounterEditableStatus
        } satisfies EncounterUpdateInput)
      : ({
          name: encounterFormData.name.trim(),
          tournament_id: tournamentId,
          stage_id: encounterFormData.stage_id,
          stage_item_id: encounterFormData.stage_item_id,
          home_team_id: encounterFormData.home_team_id,
          away_team_id: encounterFormData.away_team_id,
          round: encounterFormData.round,
          home_score: encounterFormData.home_score,
          away_score: encounterFormData.away_score,
          status: encounterFormData.status as EncounterEditableStatus
        } satisfies EncounterCreateInput);

    saveEncounterMutation.mutate(
      editingEncounter
        ? { mode: "update", encounterId: editingEncounter.id, data: payload }
        : { mode: "create", data: payload }
    );
  };

  const handleStandingSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingStanding) return;

    const payload: StandingUpdateInput = {
      position: standingFormData.position,
      points: standingFormData.points,
      win: standingFormData.win,
      draw: standingFormData.draw,
      lose: standingFormData.lose
    };

    updateStandingMutation.mutate({ standingId: editingStanding.id, data: payload });
  };

  const encounterFormInitial = editingEncounter
    ? getEncounterForm(editingEncounter)
    : getEmptyEncounterForm(defaultStageId, defaultStageItemId);
  const standingFormInitial = editingStanding
    ? getStandingForm(editingStanding)
    : { position: 0, points: 0, win: 0, draw: 0, lose: 0 };

  const isEncounterDirty =
    encounterDialogOpen && hasUnsavedChanges(encounterFormData, encounterFormInitial);
  const isStandingDirty =
    standingDialogOpen && hasUnsavedChanges(standingFormData, standingFormInitial);
  const selectedEncounterStage =
    stages.find((stage) => stage.id === encounterFormData.stage_id) ?? null;
  const selectedEncounterStageItem =
    selectedEncounterStage?.items.find((item) => item.id === encounterFormData.stage_item_id) ??
    null;
  const isEncounterGroupStage = isGroupStageScoreContext(
    selectedEncounterStage,
    selectedEncounterStageItem
  );

  const encounterGroups = useMemo(() => getStageScopeGroups(stages), [stages]);
  const standingGroups = useMemo(() => getStandingGroups(standings), [standings]);
  const rawEncounterScopeFilter = searchParams.get(ENCOUNTERS_SCOPE_QUERY_PARAM) ?? "all";
  const rawStandingsScopeFilter = searchParams.get(STANDINGS_SCOPE_QUERY_PARAM) ?? "all";
  const encounterScopeFilter =
    rawEncounterScopeFilter === "all" ||
    encounterGroups.some((group) => group.id === rawEncounterScopeFilter)
      ? rawEncounterScopeFilter
      : "all";
  const standingsGroupFilter =
    rawStandingsScopeFilter === "all" ||
    standingGroups.some((group) => group.id === rawStandingsScopeFilter)
      ? rawStandingsScopeFilter
      : "all";
  const filteredEncounters =
    encounterScopeFilter === "all"
      ? encounters
      : encounters.filter((encounter) => getEncounterScopeKey(encounter) === encounterScopeFilter);
  const visibleEncounters = filteredEncounters.slice(0, TOURNAMENT_DETAIL_PREVIEW_LIMIT);
  const filteredStandings =
    standingsGroupFilter === "all"
      ? standings
      : standings.filter((standing) => getStandingScopeKey(standing) === standingsGroupFilter);
  const sortedStandings = sortStandings(filteredStandings, standingsSort);
  const visibleStandings = standingsExpanded
    ? sortedStandings
    : sortedStandings.slice(0, TOURNAMENT_DETAIL_PREVIEW_LIMIT);
  const hasMoreStandings = sortedStandings.length > TOURNAMENT_DETAIL_PREVIEW_LIMIT;
  const completedEncounterCount = encounters.filter(
    (encounter) => encounter.status?.toUpperCase() === "COMPLETED"
  ).length;
  const missingLogCount = encounters.filter((encounter) => !encounter.has_logs).length;
  const standingsLeader = sortedStandings[0]?.team?.name ?? "No leader yet";

  useEffect(() => {
    if (
      rawEncounterScopeFilter === encounterScopeFilter &&
      rawStandingsScopeFilter === standingsGroupFilter
    ) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    setScopeParam(params, ENCOUNTERS_SCOPE_QUERY_PARAM, encounterScopeFilter);
    setScopeParam(params, STANDINGS_SCOPE_QUERY_PARAM, standingsGroupFilter);
    replaceSearchParams(params);
  }, [
    encounterScopeFilter,
    rawEncounterScopeFilter,
    rawStandingsScopeFilter,
    replaceSearchParams,
    searchParams,
    standingsGroupFilter
  ]);

  const toggleStandingSort = (key: StandingSortKey) => {
    setStandingsSort((current) => {
      if (!current || current.key !== key) {
        return { key, dir: "asc" };
      }

      return {
        key,
        dir: current.dir === "asc" ? "desc" : "asc"
      };
    });
  };

  const syncEncountersButton = canSyncEncounters ? (
    <Button
      variant="outline"
      onClick={() => syncEncountersMutation.mutate()}
      disabled={syncEncountersMutation.isPending || !hasChallongeSource}
    >
      <RefreshCw className="mr-2 size-4" aria-hidden />
      Sync encounters
    </Button>
  ) : null;

  const createEncounterButton = canCreateEncounter ? (
    <Button onClick={openCreateEncounterDialog} disabled={!canCreateEncounterNow}>
      <Plus className="mr-2 size-4" aria-hidden />
      Create encounter
    </Button>
  ) : null;

  return (
    <>
      <div role="status" className="mb-4">
        <StatTileGrid className="xl:grid-cols-3">
          <StatTile
            label="Encounters"
            value={encounters.length}
            detail={`${completedEncounterCount} completed`}
            icon={Swords}
            tone="accent"
          />
          <StatTile
            label="Log coverage"
            value={`${encounters.length - missingLogCount}/${encounters.length}`}
            detail={`${missingLogCount} missing log${missingLogCount === 1 ? "" : "s"}`}
            icon={FileCheck2}
            tone={missingLogCount ? "warning" : "success"}
          />
          <StatTile
            label="Standings"
            value={standings.length}
            detail={`Leader: ${standingsLeader}`}
            icon={Trophy}
            tone={standings.length ? "success" : "neutral"}
          />
        </StatTileGrid>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card className="border-border/40">
          <CardHeader className="gap-3 pb-3">
            <div className="flex min-w-0 flex-col gap-2">
              <CardTitle asChild className="text-base font-semibold">
                <h2>Match control</h2>
              </CardTitle>
              <CardDescription>
                Create, sync, score, and attach logs to tournament encounters.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {syncEncountersButton}
              {createEncounterButton}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {encounterGroups.length > 1 ? (
              <ScopeFilter
                id="encounters-scope-filter"
                param={ENCOUNTERS_SCOPE_QUERY_PARAM}
                value={encounterScopeFilter}
                groups={encounterGroups}
                onChange={updateScopeFilter}
              />
            ) : null}

            <AdminDetailTableShell variant="compact">
              <Table>
                <TableHeader>
                  <TableRow className={tableStyles.headerRow}>
                    <TableHead className={tableStyles.head}>Encounter</TableHead>
                    <TableHead className={tableStyles.head}>Stage</TableHead>
                    <TableHead className={tableStyles.head}>Round</TableHead>
                    <TableHead className={tableStyles.head}>Score</TableHead>
                    <TableHead className={tableStyles.head}>Status</TableHead>
                    <TableHead className={tableStyles.head}>Logs</TableHead>
                    <TableHead className={`${tableStyles.head} text-right`}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleEncounters.length ? (
                    visibleEncounters.map((encounter) => (
                      <TableRow key={encounter.id} className={tableStyles.row}>
                        <TableCell className={tableStyles.cell}>
                          <div className="space-y-1">
                            <span className="font-medium">{encounter.name}</span>
                            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <TeamName team={encounter.home_team} fallback="TBD" size="xs" />
                              <span>vs</span>
                              <TeamName team={encounter.away_team} fallback="TBD" size="xs" />
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className={tableStyles.cell}>
                          {getEncounterStageLabel(encounter)}
                        </TableCell>
                        <TableCell className={`${tableStyles.cell} tabular-nums`}>
                          {encounter.round}
                        </TableCell>
                        <TableCell className={`${tableStyles.cell} tabular-nums`}>
                          {encounter.score.home} - {encounter.score.away}
                        </TableCell>
                        <TableCell className={tableStyles.cell}>
                          {(() => {
                            const status = encounter.status?.toUpperCase() ?? "";
                            if (status === "COMPLETED") {
                              return (
                                <StatusIcon
                                  icon={CheckCircle}
                                  label="Completed"
                                  variant="success"
                                />
                              );
                            }
                            if (status === "PENDING") {
                              return <StatusIcon icon={Clock} label="Pending" variant="warning" />;
                            }

                            return (
                              <StatusIcon
                                icon={CircleAlert}
                                label={
                                  status
                                    ? `${status[0]}${status.slice(1).toLowerCase()}`
                                    : "Unknown"
                                }
                                variant="muted"
                              />
                            );
                          })()}
                        </TableCell>
                        <TableCell className={tableStyles.cell}>
                          {encounter.has_logs ? (
                            <StatusIcon icon={FileCheck2} label="Available" variant="success" />
                          ) : (
                            <StatusIcon icon={FileX2} label="Missing" variant="muted" />
                          )}
                        </TableCell>
                        <TableCell className={tableStyles.cell}>
                          <div className="flex items-center justify-end gap-2">
                            {canUpdateEncounter ? (
                              <TournamentLogUploadDialog
                                tournamentId={tournamentId}
                                encounters={encounters}
                                initialEncounterId={encounter.id}
                                onUploaded={() =>
                                  invalidateTournamentWorkspace(queryClient, tournamentId)
                                }
                                trigger={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Upload logs for ${encounter.name}`}
                                  >
                                    <Upload className="size-4" aria-hidden />
                                  </Button>
                                }
                              />
                            ) : null}
                            {canUpdateEncounter ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${encounter.name}`}
                                onClick={() => openEditEncounterDialog(encounter)}
                              >
                                <Pencil className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                            {canDeleteEncounter ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                aria-label={`Delete ${encounter.name}`}
                                onClick={() => setEncounterPendingDelete(encounter)}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className={tableStyles.row}>
                      <TableCell className={tableStyles.cell} colSpan={7}>
                        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                          <span>
                            No encounters yet. Add at least two teams, then sync from Challonge or
                            create the first encounter.
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {syncEncountersButton}
                            {createEncounterButton}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </AdminDetailTableShell>
            {filteredEncounters.length > TOURNAMENT_DETAIL_PREVIEW_LIMIT ? (
              <div className="border-t border-border/30 px-3 py-2">
                <Link
                  href={`/admin/encounters?tournament=${tournamentId}`}
                  className="text-sm tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                >
                  Show all {filteredEncounters.length} encounters <span aria-hidden>→</span>
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border/40">
          <CardHeader className="gap-3 pb-3">
            <div className="flex min-w-0 flex-col gap-2">
              <CardTitle asChild className="text-base font-semibold">
                <h2>Standings control</h2>
              </CardTitle>
              <CardDescription>
                Calculate, sort, and adjust the ranking table for the selected scope.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {hasMoreStandings ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setStandingsExpanded((current) => !current)}
                >
                  {standingsExpanded ? (
                    <ChevronsDownUp className="mr-2 size-4" aria-hidden />
                  ) : (
                    <ChevronsUpDown className="mr-2 size-4" aria-hidden />
                  )}
                  {standingsExpanded ? "Collapse all" : "Expand all"}
                </Button>
              ) : null}
              {canRecalculateStandings && standings.length === 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => calculateStandingsMutation.mutate()}
                  disabled={calculateStandingsMutation.isPending || !canManageStandingsNow}
                >
                  <RefreshCw className="mr-2 size-4" aria-hidden />
                  Calculate standings
                </Button>
              ) : null}
              {canRecalculateStandings && standings.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => recalculateStandingsMutation.mutate()}
                  disabled={recalculateStandingsMutation.isPending || !canManageStandingsNow}
                >
                  <RefreshCw className="mr-2 size-4" aria-hidden />
                  Recalculate standings
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {standingGroups.length > 1 ? (
              <ScopeFilter
                id="standings-scope-filter"
                param={STANDINGS_SCOPE_QUERY_PARAM}
                value={standingsGroupFilter}
                groups={standingGroups}
                onChange={updateScopeFilter}
              />
            ) : null}

            <AdminDetailTableShell variant="compact">
              <Table>
                <TableHeader>
                  <TableRow className={tableStyles.headerRow}>
                    {(
                      [
                        { key: "position", label: "Pos" },
                        { key: "team", label: "Team" },
                        { key: "scope", label: "Scope" },
                        { key: "points", label: "Points" },
                        { key: "win", label: "W" },
                        { key: "draw", label: "D" },
                        { key: "lose", label: "L" }
                      ] as Array<{ key: StandingSortKey; label: string }>
                    ).map((column) => {
                      const active = standingsSort?.key === column.key;

                      return (
                        <TableHead
                          key={column.key}
                          className={tableStyles.head}
                          aria-sort={ariaSortValue(active ? standingsSort?.dir : null)}
                        >
                          <button
                            type="button"
                            className="flex select-none items-center gap-1 transition-colors hover:text-foreground"
                            onClick={() => toggleStandingSort(column.key)}
                          >
                            {column.label}
                            <SortIcon state={standingsSort} active={active} />
                          </button>
                        </TableHead>
                      );
                    })}
                    <TableHead className={`${tableStyles.head} text-right`}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleStandings.length ? (
                    visibleStandings.map((standing) => (
                      <TableRow key={standing.id} className={tableStyles.row}>
                        <TableCell className={`${tableStyles.cell} tabular-nums`}>
                          {standing.position}
                        </TableCell>
                        <TableCell className={`${tableStyles.cell} font-medium`}>
                          {standing.team?.name ?? "Unknown team"}
                        </TableCell>
                        <TableCell className={tableStyles.cell}>
                          {getStandingScopeLabel(standing)}
                        </TableCell>
                        <TableCell className={`${tableStyles.cell} tabular-nums`}>
                          {standing.points}
                        </TableCell>
                        <TableCell className={`${tableStyles.cell} tabular-nums`}>
                          {standing.win}
                        </TableCell>
                        <TableCell className={`${tableStyles.cell} tabular-nums`}>
                          {standing.draw}
                        </TableCell>
                        <TableCell className={`${tableStyles.cell} tabular-nums`}>
                          {standing.lose}
                        </TableCell>
                        <TableCell className={tableStyles.cell}>
                          <div className="flex items-center justify-end gap-2">
                            {canUpdateStanding ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit standing for ${standing.team?.name ?? "team"}`}
                                onClick={() => openEditStandingDialog(standing)}
                              >
                                <Pencil className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                            {canDeleteStanding ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                aria-label={`Delete standing for ${standing.team?.name ?? "team"}`}
                                onClick={() => setStandingPendingDelete(standing)}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className={tableStyles.row}>
                      <TableCell className={tableStyles.cell} colSpan={8}>
                        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                          <span>
                            No standings yet. Complete a few encounters, then calculate standings.
                          </span>
                          {canRecalculateStandings ? (
                            <Button
                              variant="outline"
                              onClick={() => calculateStandingsMutation.mutate()}
                              disabled={
                                calculateStandingsMutation.isPending || !canManageStandingsNow
                              }
                            >
                              <RefreshCw className="mr-2 size-4" aria-hidden />
                              Calculate standings
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </AdminDetailTableShell>
          </CardContent>
        </Card>
      </div>

      <EntityFormDialog
        open={encounterDialogOpen}
        onOpenChange={(open) => {
          setEncounterDialogOpen(open);
          if (!open) {
            resetEncounterDialog();
          }
        }}
        title={editingEncounter ? "Edit encounter" : "Create encounter"}
        description="Create or update tournament encounters without leaving the workspace."
        onSubmit={handleEncounterSubmit}
        isSubmitting={saveEncounterMutation.isPending}
        submittingLabel={editingEncounter ? "Updating encounter…" : "Creating encounter…"}
        errorMessage={encounterFormError}
        isDirty={isEncounterDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="workspace-encounter-name">Encounter name</Label>
            <Input
              id="workspace-encounter-name"
              value={encounterFormData.name}
              onChange={(event) =>
                setEncounterFormData((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-encounter-stage">Stage</Label>
            <Select
              value={encounterFormData.stage_id?.toString() ?? ""}
              onValueChange={(value) => {
                const stage = stages.find((entry) => entry.id === Number(value)) ?? null;
                setEncounterFormData((current) => ({
                  ...current,
                  stage_id: stage?.id ?? null,
                  stage_item_id: stage?.items[0]?.id ?? null
                }));
              }}
            >
              <SelectTrigger id="workspace-encounter-stage">
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id.toString()}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="workspace-encounter-stage-item">Stage item</Label>
            <Select
              value={encounterFormData.stage_item_id?.toString() ?? "none"}
              onValueChange={(value) =>
                setEncounterFormData((current) => {
                  const nextStageItemId = value === "none" ? null : Number(value);
                  const nextStageId =
                    nextStageItemId != null
                      ? (stages.find((stage) =>
                          stage.items.some((item) => item.id === nextStageItemId)
                        )?.id ?? current.stage_id)
                      : current.stage_id;

                  return {
                    ...current,
                    stage_id: nextStageId,
                    stage_item_id: nextStageItemId
                  };
                })
              }
            >
              <SelectTrigger id="workspace-encounter-stage-item">
                <SelectValue placeholder="Select stage item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No stage item</SelectItem>
                {stages
                  .filter((stage) => stage.id === encounterFormData.stage_id)
                  .flatMap((stage) => stage.items)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id.toString()}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="workspace-encounter-home">Home team</Label>
              <TeamCombobox
                id="workspace-encounter-home"
                teams={teams}
                value={encounterFormData.home_team_id}
                placeholder="Select home team"
                onSelect={(team) =>
                  setEncounterFormData((current) => {
                    const homeTeamId = team?.id ?? null;
                    return {
                      ...current,
                      name: buildEncounterName(teams, homeTeamId, current.away_team_id),
                      home_team_id: homeTeamId
                    };
                  })
                }
              />
            </div>

            <div>
              <Label htmlFor="workspace-encounter-away">Away team</Label>
              <TeamCombobox
                id="workspace-encounter-away"
                teams={teams}
                value={encounterFormData.away_team_id}
                placeholder="Select away team"
                onSelect={(team) =>
                  setEncounterFormData((current) => {
                    const awayTeamId = team?.id ?? null;
                    return {
                      ...current,
                      name: buildEncounterName(teams, current.home_team_id, awayTeamId),
                      away_team_id: awayTeamId
                    };
                  })
                }
              />
            </div>
          </div>

          <div>
            <Label htmlFor="workspace-encounter-round">Round</Label>
            <NumberInput
              id="workspace-encounter-round"
              integer
              value={encounterFormData.round}
              onValueChange={(next) =>
                setEncounterFormData((current) => ({
                  ...current,
                  round: next ?? 1
                }))
              }
            />
          </div>

          <EncounterScoreControls
            idPrefix="workspace-encounter"
            homeScore={encounterFormData.home_score}
            awayScore={encounterFormData.away_score}
            presetLabel={isEncounterGroupStage ? "Group stage presets" : "Result presets"}
            showGroupStageHint={isEncounterGroupStage}
            onScoreChange={(score) =>
              setEncounterFormData((current) => ({
                ...current,
                home_score: score.homeScore,
                away_score: score.awayScore
              }))
            }
            onPresetSelect={(score) =>
              setEncounterFormData((current) => ({
                ...current,
                home_score: score.homeScore,
                away_score: score.awayScore,
                status: "completed"
              }))
            }
          />

          <div>
            <Label htmlFor="workspace-encounter-status">Status</Label>
            <Select
              value={encounterFormData.status}
              onValueChange={(value) =>
                setEncounterFormData((current) => ({ ...current, status: value }))
              }
            >
              <SelectTrigger id="workspace-encounter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </EntityFormDialog>

      <EntityFormDialog
        open={standingDialogOpen}
        onOpenChange={(open) => {
          setStandingDialogOpen(open);
          if (!open) {
            resetStandingDialog();
          }
        }}
        title="Edit standing"
        description="Adjust a stored standings row manually."
        onSubmit={handleStandingSubmit}
        isSubmitting={updateStandingMutation.isPending}
        submittingLabel="Updating standing…"
        errorMessage={
          updateStandingMutation.isError
            ? `Could not update the standing. ${updateStandingMutation.error.message}`
            : undefined
        }
        isDirty={isStandingDirty}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="workspace-standing-position">Position</Label>
            <NumberInput
              id="workspace-standing-position"
              integer
              min={1}
              value={standingFormData.position}
              onValueChange={(next) =>
                setStandingFormData((current) => ({
                  ...current,
                  position: next ?? 0
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor="workspace-standing-points">Points</Label>
            <NumberInput
              id="workspace-standing-points"
              value={standingFormData.points}
              onValueChange={(next) =>
                setStandingFormData((current) => ({
                  ...current,
                  points: next ?? 0
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor="workspace-standing-win">Wins</Label>
            <NumberInput
              id="workspace-standing-win"
              integer
              min={0}
              value={standingFormData.win}
              onValueChange={(next) =>
                setStandingFormData((current) => ({
                  ...current,
                  win: next ?? 0
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor="workspace-standing-draw">Draws</Label>
            <NumberInput
              id="workspace-standing-draw"
              integer
              min={0}
              value={standingFormData.draw}
              onValueChange={(next) =>
                setStandingFormData((current) => ({
                  ...current,
                  draw: next ?? 0
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor="workspace-standing-lose">Losses</Label>
            <NumberInput
              id="workspace-standing-lose"
              integer
              min={0}
              value={standingFormData.lose}
              onValueChange={(next) =>
                setStandingFormData((current) => ({
                  ...current,
                  lose: next ?? 0
                }))
              }
            />
          </div>
        </div>
      </EntityFormDialog>

      <DeleteConfirmDialog
        open={!!encounterPendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setEncounterPendingDelete(null);
          }
        }}
        onConfirm={() => {
          if (encounterPendingDelete) {
            deleteEncounterMutation.mutate(encounterPendingDelete.id);
          }
        }}
        title="Delete encounter"
        description={`Delete "${encounterPendingDelete?.name ?? "this encounter"}"? This action cannot be undone.`}
        cascadeInfo={["All matches in this encounter", "Attached match statistics and logs"]}
        isDeleting={deleteEncounterMutation.isPending}
      />

      <DeleteConfirmDialog
        open={!!standingPendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setStandingPendingDelete(null);
          }
        }}
        onConfirm={() => {
          if (standingPendingDelete) {
            deleteStandingMutation.mutate(standingPendingDelete.id);
          }
        }}
        title="Delete standing"
        description={`Delete the standings row for "${standingPendingDelete?.team?.name ?? "this team"}"? The row stays gone until standings are recalculated.`}
        isDeleting={deleteStandingMutation.isPending}
      />
    </>
  );
}
