"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ClipboardList,
  FolderInput,
  Gauge,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Sparkles,
  Users
} from "lucide-react";

import TeamName from "@/components/TeamName";
import {
  AdminDetailTableShell,
  getAdminDetailTableStyles
} from "@/components/admin/AdminDetailTable";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
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
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import balancerAdminService from "@/services/balancer-admin.service";
import type {
  ChallongeTeamMapping,
  ChallongeTeamPreviewParticipant
} from "@/types/admin.types";
import type { Team } from "@/types/team.types";
import { TOURNAMENT_DETAIL_PREVIEW_LIMIT } from "./tournamentWorkspace.helpers";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";

interface TournamentTeamsTabProps {
  tournamentId: number;
  teams: Team[];
  stagesCount: number;
  hasChallongeSource: boolean;
  canCreateTeam: boolean;
  canUpdateTeam: boolean;
  canDeleteTeam: boolean;
  canImportTeams: boolean;
  canCreatePlayer: boolean;
  canUpdatePlayer: boolean;
  canDeletePlayer: boolean;
}

const UNMAPPED_TEAM_VALUE = "unmapped";

function getChallongeParticipantKey(participant: ChallongeTeamPreviewParticipant) {
  return `${participant.participant_id}:${participant.group_id ?? "none"}`;
}

function summarizeChallongeSyncResult(result: {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}) {
  return (
    <span className="tabular-nums">
      {result.created} created, {result.updated} updated, {result.unchanged} unchanged,{" "}
      {result.skipped} skipped
    </span>
  );
}

export function TournamentTeamsTab({
  tournamentId,
  teams,
  stagesCount,
  hasChallongeSource,
  canCreateTeam,
  canUpdateTeam,
  canDeleteTeam,
  canImportTeams,
  canCreatePlayer,
  canUpdatePlayer,
  canDeletePlayer
}: TournamentTeamsTabProps) {
  const queryClient = useQueryClient();
  const tableStyles = getAdminDetailTableStyles("compact");
  const importTeamsFileRef = useRef<HTMLInputElement>(null);

  const [challongeSyncDialogOpen, setChallongeSyncDialogOpen] = useState(false);
  const [challongeMappingDraft, setChallongeMappingDraft] = useState<Record<string, string>>({});

  const canManageRoster = canCreatePlayer || canUpdatePlayer || canDeletePlayer;
  const canManageTeams = canCreateTeam || canUpdateTeam || canDeleteTeam || canManageRoster;
  const teamsAdminHref = `/admin/teams?tournament=${tournamentId}`;

  const { data: challongePreview, isLoading: isChallongePreviewLoading } = useQuery({
    queryKey: ["admin", "challonge-team-sync-preview", tournamentId],
    queryFn: () => adminService.getChallongeTeamSyncPreview(tournamentId),
    enabled: challongeSyncDialogOpen && hasChallongeSource
  });

  const syncTeamsMutation = useMutation({
    mutationFn: (mappings: ChallongeTeamMapping[]) =>
      adminService.syncTeamsFromChallonge(tournamentId, { mappings }),
    onSuccess: (result) => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      setChallongeSyncDialogOpen(false);
      notify.success("Teams synced from Challonge", {
        description: summarizeChallongeSyncResult(result)
      });
    }
  });

  const importTeamsMutation = useMutation({
    mutationFn: (file: File) => balancerAdminService.importTeamsFromJson(tournamentId, file),
    onSuccess: async (result) => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      notify.success("Teams imported", { description: `${result.imported_teams} teams created.` });
    }
  });

  const challongeParticipants = useMemo(
    () => challongePreview?.participants ?? [],
    [challongePreview?.participants]
  );
  const challongeTeamOptions = useMemo(
    () => challongePreview?.teams ?? [],
    [challongePreview?.teams]
  );
  const challongeTeamsById = useMemo(
    () => new Map(challongeTeamOptions.map((team) => [team.id, team])),
    [challongeTeamOptions]
  );
  const getChallongeMappingValue = (participant: ChallongeTeamPreviewParticipant) =>
    challongeMappingDraft[getChallongeParticipantKey(participant)] ??
    (participant.mapped_team_id != null ? String(participant.mapped_team_id) : UNMAPPED_TEAM_VALUE);
  const activeUnmappedParticipants = challongeParticipants.filter(
    (participant) =>
      participant.active && getChallongeMappingValue(participant) === UNMAPPED_TEAM_VALUE
  );
  const selectedChallongeMappings = challongeParticipants.flatMap((participant) => {
    const value = getChallongeMappingValue(participant);
    if (!value || value === UNMAPPED_TEAM_VALUE) {
      return [];
    }

    const teamId = Number.parseInt(value, 10);
    if (Number.isNaN(teamId)) {
      return [];
    }

    return [
      {
        participant_id: participant.participant_id,
        group_id: participant.group_id,
        team_id: teamId
      }
    ];
  });
  const canSubmitChallongeMappings =
    !isChallongePreviewLoading &&
    challongeParticipants.length > 0 &&
    selectedChallongeMappings.length > 0 &&
    activeUnmappedParticipants.length === 0;

  const openChallongeSyncDialog = () => {
    syncTeamsMutation.reset();
    setChallongeMappingDraft({});
    setChallongeSyncDialogOpen(true);
  };

  const closeChallongeSyncDialog = () => {
    if (syncTeamsMutation.isPending) {
      return;
    }

    setChallongeSyncDialogOpen(false);
    setChallongeMappingDraft({});
  };

  const applyChallongeSuggestions = () => {
    setChallongeMappingDraft((current) => {
      const next = { ...current };
      for (const participant of challongeParticipants) {
        if (participant.suggested_team_id != null) {
          next[getChallongeParticipantKey(participant)] = String(participant.suggested_team_id);
        }
      }
      return next;
    });
  };

  const handleChallongeMappingSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!canSubmitChallongeMappings) {
      notify.error("Mappings incomplete", {
        description: `Map the remaining ${activeUnmappedParticipants.length} active Challonge participants before syncing.`
      });
      return;
    }

    syncTeamsMutation.mutate(selectedChallongeMappings);
  };

  const rosterPlayersCount = teams.reduce((sum, team) => sum + team.players.length, 0);
  const teamsWithRosterCount = teams.filter((team) => team.players.length > 0).length;
  const emptyRosterTeamsCount = teams.length - teamsWithRosterCount;
  const averageSr =
    teams.length > 0
      ? Math.round(teams.reduce((sum, team) => sum + team.avg_sr, 0) / teams.length)
      : 0;

  const syncTeamsButton = canImportTeams ? (
    <Button
      variant="outline"
      onClick={openChallongeSyncDialog}
      disabled={syncTeamsMutation.isPending || !hasChallongeSource}
    >
      <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
      Sync teams
    </Button>
  ) : null;

  return (
    <>
      <StatTileGrid className="mb-4">
        <StatTile
          label="Teams"
          value={teams.length}
          detail={`${stagesCount} stage${stagesCount === 1 ? "" : "s"} configured`}
          icon={Users}
        />
        <StatTile
          label="Roster records"
          value={rosterPlayersCount}
          detail={`${teamsWithRosterCount}/${teams.length} teams have players`}
          icon={ClipboardList}
        />
        <StatTile
          label="Average SR"
          value={teams.length ? averageSr : "—"}
          detail="Across loaded teams"
          icon={Gauge}
        />
        <StatTile
          label="Empty rosters"
          value={emptyRosterTeamsCount}
          detail={
            emptyRosterTeamsCount > 0
              ? "Add players before seeding stages"
              : "Every team has players"
          }
          icon={AlertTriangle}
          tone={emptyRosterTeamsCount > 0 ? "warning" : "success"}
        />
      </StatTileGrid>

      <Card className="border-border/40">
        <CardHeader className="gap-3 pb-3">
          <div className="min-w-0">
            <CardTitle asChild className="text-base font-semibold">
              <h2>Team operations</h2>
            </CardTitle>
            <CardDescription className="mt-1">
              Review tournament rosters, sync external mappings, or jump into the dedicated team
              workspace for detailed edits.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {syncTeamsButton}
            {canImportTeams ? (
              <>
                <input
                  ref={importTeamsFileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) importTeamsMutation.mutate(file);
                    event.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => importTeamsFileRef.current?.click()}
                  disabled={importTeamsMutation.isPending}
                >
                  {importTeamsMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <FolderInput className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  Import from JSON
                </Button>
              </>
            ) : null}
            {canImportTeams ? (
              <Button asChild variant="outline">
                {/* D30/A-O2: the sole UI entry to the balancer tool after the shell removal (v3.1). */}
                <Link href={`/balancer?tournament=${tournamentId}`}>
                  <Scale className="mr-2 h-4 w-4" aria-hidden />
                  Open balancer
                </Link>
              </Button>
            ) : null}
            {canManageTeams ? (
              <Button asChild>
                <Link href={teamsAdminHref}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  Manage teams
                </Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <AdminDetailTableShell variant="compact">
            <Table>
              <TableHeader>
                <TableRow className={tableStyles.headerRow}>
                  <TableHead className={tableStyles.head}>Team</TableHead>
                  <TableHead className={tableStyles.head}>Avg SR</TableHead>
                  <TableHead className={tableStyles.head}>Total SR</TableHead>
                  <TableHead className={tableStyles.head}>Players</TableHead>
                  <TableHead className={`${tableStyles.head} text-right`}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.length ? (
                  teams.slice(0, TOURNAMENT_DETAIL_PREVIEW_LIMIT).map((team) => (
                    <TableRow key={team.id} className={tableStyles.row}>
                      <TableCell className={tableStyles.cell}>
                        <TeamName team={team} size="xs" nameClassName="font-medium" />
                      </TableCell>
                      <TableCell className={`${tableStyles.cell} tabular-nums`}>
                        {team.avg_sr.toFixed(0)}
                      </TableCell>
                      <TableCell className={`${tableStyles.cell} tabular-nums`}>
                        {team.total_sr}
                      </TableCell>
                      <TableCell className={`${tableStyles.cell} tabular-nums`}>
                        {team.players.length}
                      </TableCell>
                      <TableCell className={tableStyles.cell}>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            aria-label={`Open team ${team.name}`}
                          >
                            <Link href={`/admin/teams/${team.id}`}>
                              <Pencil className="mr-2 h-4 w-4" aria-hidden />
                              Open team
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className={tableStyles.row}>
                    <TableCell className={tableStyles.cell} colSpan={5}>
                      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                        <span>
                          No teams loaded for this tournament yet. Sync from Challonge or open the
                          dedicated teams workspace to create the first roster.
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {syncTeamsButton}
                          {canManageTeams ? (
                            <Button asChild variant="outline">
                              <Link href={teamsAdminHref}>
                                <Plus className="mr-2 h-4 w-4" aria-hidden />
                                Manage teams
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </AdminDetailTableShell>
        </CardContent>
      </Card>

      <Dialog
        open={challongeSyncDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setChallongeSyncDialogOpen(true);
          } else {
            closeChallongeSyncDialog();
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader className="border-b border-border/60 pb-4">
            <DialogTitle>Sync Challonge teams</DialogTitle>
            <DialogDescription>
              Match each Challonge participant to the internal team used by analytics and matches.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleChallongeMappingSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary" className="tabular-nums">
                  {challongeParticipants.length} participants
                </Badge>
                <Badge
                  variant={activeUnmappedParticipants.length ? "destructive" : "secondary"}
                  className="tabular-nums"
                >
                  {activeUnmappedParticipants.length} unmapped
                </Badge>
                <Badge variant="secondary" className="tabular-nums">
                  {selectedChallongeMappings.length} selected
                </Badge>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={applyChallongeSuggestions}
                disabled={
                  isChallongePreviewLoading ||
                  !challongeParticipants.some(
                    (participant) => participant.suggested_team_id != null
                  )
                }
              >
                <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                Apply suggestions
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow className={tableStyles.headerRow}>
                    <TableHead className={tableStyles.head}>Challonge participant</TableHead>
                    <TableHead className={tableStyles.head}>Group</TableHead>
                    <TableHead className={tableStyles.head}>Current</TableHead>
                    <TableHead className={tableStyles.head}>Suggestion</TableHead>
                    <TableHead className={tableStyles.head}>Internal team</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isChallongePreviewLoading ? (
                    <TableRow className={tableStyles.row}>
                      <TableCell className={tableStyles.cell} colSpan={5}>
                        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          Loading Challonge participants…
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : challongeParticipants.length ? (
                    challongeParticipants.map((participant) => {
                      const participantKey = getChallongeParticipantKey(participant);
                      const currentTeam =
                        participant.mapped_team_id != null
                          ? challongeTeamsById.get(participant.mapped_team_id)
                          : undefined;
                      const suggestedTeam =
                        participant.suggested_team_id != null
                          ? challongeTeamsById.get(participant.suggested_team_id)
                          : undefined;

                      return (
                        <TableRow key={participantKey} className={tableStyles.row}>
                          <TableCell className={tableStyles.cell}>
                            <div className="min-w-0">
                              <div className="truncate font-medium" title={participant.name}>
                                {participant.name}
                              </div>
                              <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                                #{participant.participant_id} · Challonge #
                                {participant.challonge_id}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            {participant.group_name ?? "Main"}
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            {currentTeam ? (
                              <span className="truncate" title={currentTeam.name}>
                                {currentTeam.name}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Unmapped</span>
                            )}
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            {suggestedTeam ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 max-w-[180px] justify-start px-2"
                                aria-label={`Map ${participant.name} to ${suggestedTeam.name}`}
                                onClick={() =>
                                  setChallongeMappingDraft((current) => ({
                                    ...current,
                                    [participantKey]: String(suggestedTeam.id)
                                  }))
                                }
                              >
                                <Sparkles className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden />
                                <span className="truncate">{suggestedTeam.name}</span>
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">None</span>
                            )}
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            <Select
                              value={getChallongeMappingValue(participant)}
                              onValueChange={(value) =>
                                setChallongeMappingDraft((current) => ({
                                  ...current,
                                  [participantKey]: value
                                }))
                              }
                            >
                              <SelectTrigger aria-label={`Internal team for ${participant.name}`}>
                                <SelectValue placeholder="Select team" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={UNMAPPED_TEAM_VALUE}>Unmapped</SelectItem>
                                {challongeTeamOptions.map((team) => (
                                  <SelectItem key={team.id} value={String(team.id)}>
                                    {team.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow className={tableStyles.row}>
                      <TableCell className={tableStyles.cell} colSpan={5}>
                        <div className="py-4 text-sm text-muted-foreground">
                          No participants came back from Challonge. Check the Challonge link on the
                          Settings tab, then reopen this dialog.
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <DialogFooter className="mt-4 border-t border-border/60 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={closeChallongeSyncDialog}
                disabled={syncTeamsMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!canSubmitChallongeMappings || syncTeamsMutation.isPending}
              >
                {syncTeamsMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    Syncing…
                  </>
                ) : (
                  "Sync mappings"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
