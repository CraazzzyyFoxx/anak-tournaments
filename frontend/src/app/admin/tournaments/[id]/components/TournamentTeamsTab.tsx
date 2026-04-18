"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderInput, Loader2, Minus, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AdminDetailTableShell, getAdminDetailTableStyles } from "@/components/admin/AdminDetailTable";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { UserSearchCombobox } from "@/components/admin/UserSearchCombobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasUnsavedChanges } from "@/lib/form-change";
import { useToast } from "@/hooks/use-toast";
import adminService from "@/services/admin.service";
import balancerAdminService from "@/services/balancer-admin.service";
import type { TeamCreateInput, TeamUpdateInput } from "@/types/admin.types";
import type { Team } from "@/types/team.types";
import type { MinimizedUser } from "@/types/user.types";
import {
  TOURNAMENT_DETAIL_PREVIEW_LIMIT,
  getEmptyTeamForm,
  getTeamForm,
  type TeamFormState,
} from "./tournamentWorkspace.helpers";
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
}

interface TeamNumberInputProps {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

function clampTeamNumber(value: number, min?: number, max?: number) {
  if (typeof min === "number" && value < min) {
    return min;
  }

  if (typeof max === "number" && value > max) {
    return max;
  }

  return value;
}

function normalizeTeamNumberDraft(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function TeamNumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: TeamNumberInputProps) {
  const [draft, setDraft] = useState(normalizeTeamNumberDraft(value));

  useEffect(() => {
    setDraft(normalizeTeamNumberDraft(value));
  }, [value]);

  const commitValue = (nextDraft: string) => {
    const nextValue = Number.parseFloat(nextDraft);

    if (Number.isNaN(nextValue)) {
      setDraft(normalizeTeamNumberDraft(value));
      return;
    }

    const clamped = clampTeamNumber(nextValue, min, max);
    setDraft(normalizeTeamNumberDraft(clamped));
    onChange(clamped);
  };

  const stepValue = (direction: -1 | 1) => {
    const nextValue = clampTeamNumber(value + step * direction, min, max);
    setDraft(normalizeTeamNumberDraft(nextValue));
    onChange(nextValue);
  };

  return (
    <div className="flex h-10 overflow-hidden rounded-md border border-input bg-background/80 shadow-sm focus-within:ring-1 focus-within:ring-ring">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full w-10 shrink-0 rounded-r-none border-r"
        onClick={() => stepValue(-1)}
        disabled={typeof min === "number" && value <= min}
        aria-label={`Decrease ${id}`}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <div className="flex min-w-0 flex-1 items-center">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value.replace(/[^\d.-]/g, "");
            setDraft(nextDraft);

            if (nextDraft && nextDraft !== "-" && nextDraft !== "." && nextDraft !== "-.") {
              commitValue(nextDraft);
            }
          }}
          onBlur={() => commitValue(draft)}
          className="h-full rounded-none border-0 bg-transparent text-center shadow-none focus-visible:ring-0"
        />
        {suffix ? (
          <span className="shrink-0 pr-3 text-xs font-medium text-muted-foreground">{suffix}</span>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full w-10 shrink-0 rounded-l-none border-l"
        onClick={() => stepValue(1)}
        disabled={typeof max === "number" && value >= max}
        aria-label={`Increase ${id}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function getTeamCaptainName(team: Team | null) {
  if (!team) {
    return undefined;
  }

  const captain = team.players.find((player) => player.user_id === team.captain_id);
  return captain?.user?.name;
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
}: TournamentTeamsTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tableStyles = getAdminDetailTableStyles("compact");
  const importTeamsFileRef = useRef<HTMLInputElement>(null);

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamFormData, setTeamFormData] = useState<TeamFormState>(getEmptyTeamForm());
  const [selectedCaptainName, setSelectedCaptainName] = useState<string | undefined>();
  const [teamFormError, setTeamFormError] = useState<string | undefined>();
  const [teamPendingDelete, setTeamPendingDelete] = useState<Team | null>(null);

  const resetTeamDialog = () => {
    setTeamDialogOpen(false);
    setEditingTeam(null);
    setTeamFormData(getEmptyTeamForm());
    setSelectedCaptainName(undefined);
    setTeamFormError(undefined);
    saveTeamMutation.reset();
  };

  const saveTeamMutation = useMutation({
    mutationFn: async ({
      mode,
      teamId,
      data,
    }: {
      mode: "create" | "update";
      teamId?: number;
      data: TeamCreateInput | TeamUpdateInput;
    }) => {
      if (mode === "create") {
        return adminService.createTeam(data as TeamCreateInput);
      }

      return adminService.updateTeam(teamId!, data as TeamUpdateInput);
    },
    onSuccess: async (_data, variables) => {
      await invalidateTournamentWorkspace(queryClient, tournamentId);
      resetTeamDialog();
      toast({ title: variables.mode === "create" ? "Team created" : "Team updated" });
    },
    onError: (error: Error) => {
      setTeamFormError(error.message);
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: (teamId: number) => adminService.deleteTeam(teamId),
    onSuccess: async () => {
      await invalidateTournamentWorkspace(queryClient, tournamentId);
      setTeamPendingDelete(null);
      toast({ title: "Team deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const syncTeamsMutation = useMutation({
    mutationFn: () => adminService.syncTeamsFromChallonge(tournamentId),
    onSuccess: async () => {
      await invalidateTournamentWorkspace(queryClient, tournamentId);
      toast({ title: "Teams synced from Challonge" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importTeamsMutation = useMutation({
    mutationFn: (file: File) => balancerAdminService.importTeamsFromJson(tournamentId, file),
    onSuccess: async (result) => {
      await invalidateTournamentWorkspace(queryClient, tournamentId);
      toast({ title: "Teams imported", description: `${result.imported_teams} teams created.` });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to import teams",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const openCreateTeamDialog = () => {
    setTeamFormError(undefined);
    setEditingTeam(null);
    setTeamFormData(getEmptyTeamForm());
    setSelectedCaptainName(undefined);
    setTeamDialogOpen(true);
  };

  const openEditTeamDialog = (team: Team) => {
    setTeamFormError(undefined);
    setEditingTeam(team);
    setTeamFormData(getTeamForm(team));
    setSelectedCaptainName(getTeamCaptainName(team));
    setTeamDialogOpen(true);
  };

  const handleCaptainSelect = (user: MinimizedUser | undefined) => {
    setTeamFormData((current) => ({ ...current, captain_id: user?.id ?? 0 }));
    setSelectedCaptainName(user?.name);
  };

  const handleTeamSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!teamFormData.name.trim()) {
      setTeamFormError("Team name is required.");
      return;
    }

    if (teamFormData.captain_id <= 0) {
      setTeamFormError("Captain user ID is required.");
      return;
    }

    const payload = editingTeam
      ? ({
          name: teamFormData.name.trim(),
          captain_id: teamFormData.captain_id,
          avg_sr: teamFormData.avg_sr,
          total_sr: teamFormData.total_sr,
        } satisfies TeamUpdateInput)
      : ({
          name: teamFormData.name.trim(),
          tournament_id: tournamentId,
          captain_id: teamFormData.captain_id,
          avg_sr: teamFormData.avg_sr,
          total_sr: teamFormData.total_sr,
        } satisfies TeamCreateInput);

    saveTeamMutation.mutate(
      editingTeam
        ? { mode: "update", teamId: editingTeam.id, data: payload }
        : { mode: "create", data: payload }
    );
  };

  const teamFormInitial = editingTeam ? getTeamForm(editingTeam) : getEmptyTeamForm();
  const isTeamDirty = teamDialogOpen && hasUnsavedChanges(teamFormData, teamFormInitial);

  return (
    <>
      <Card className="border-border/40">
        <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <CardTitle className="text-sm font-semibold">Teams</CardTitle>
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50">
              <span>{teams.length} teams</span>
              <span>·</span>
              <span>{stagesCount} stages configured</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canImportTeams ? (
              <Button
                variant="outline"
                onClick={() => syncTeamsMutation.mutate()}
                disabled={syncTeamsMutation.isPending || !hasChallongeSource}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Teams
              </Button>
            ) : null}
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FolderInput className="mr-2 h-4 w-4" />
                  )}
                  Import from JSON
                </Button>
              </>
            ) : null}
            {canCreateTeam ? (
              <Button onClick={openCreateTeamDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Create Team
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
                        <span className="font-medium">{team.name}</span>
                      </TableCell>
                      <TableCell className={tableStyles.cell}>{team.avg_sr.toFixed(0)}</TableCell>
                      <TableCell className={tableStyles.cell}>{team.total_sr}</TableCell>
                      <TableCell className={tableStyles.cell}>{team.players.length}</TableCell>
                      <TableCell className={tableStyles.cell}>
                        <div className="flex items-center justify-end gap-2">
                          {canUpdateTeam ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${team.name}`}
                              onClick={() => openEditTeamDialog(team)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canDeleteTeam ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              aria-label={`Delete ${team.name}`}
                              onClick={() => setTeamPendingDelete(team)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className={tableStyles.row}>
                    <TableCell className={tableStyles.cell} colSpan={5}>
                      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                        <span>
                          No teams loaded for this tournament yet. Create one manually or sync from
                          Challonge if the workspace is linked.
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {canImportTeams ? (
                            <Button
                              variant="outline"
                              onClick={() => syncTeamsMutation.mutate()}
                              disabled={syncTeamsMutation.isPending || !hasChallongeSource}
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Sync Teams
                            </Button>
                          ) : null}
                          {canCreateTeam ? (
                            <Button variant="outline" onClick={openCreateTeamDialog}>
                              <Plus className="mr-2 h-4 w-4" />
                              Create First Team
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

          {teams.length > TOURNAMENT_DETAIL_PREVIEW_LIMIT ? (
            <div className="border-t border-border/30 px-3 py-2">
              <Link
                href={`/admin/teams?tournament=${tournamentId}`}
                className="text-[12px] text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                Show all {teams.length} teams →
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <EntityFormDialog
        open={teamDialogOpen}
        onOpenChange={(open) => {
          setTeamDialogOpen(open);
          if (!open) {
            resetTeamDialog();
          }
        }}
        title={editingTeam ? "Edit Team" : "Create Team"}
        description="Set the team identity, captain, and rating values used by standings and balancing."
        onSubmit={handleTeamSubmit}
        isSubmitting={saveTeamMutation.isPending}
        submittingLabel={editingTeam ? "Updating team..." : "Creating team..."}
        errorMessage={teamFormError}
        isDirty={isTeamDirty}
      >
        <div className="space-y-5">
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p className="text-sm font-medium">{editingTeam ? "Update team roster anchor" : "Create a team shell"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Captain search accepts player names from the user catalog. Rating fields can be typed or nudged with the side controls.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-team-name">Team Name</Label>
            <Input
              id="workspace-team-name"
              value={teamFormData.name}
              placeholder="Team name"
              onChange={(event) =>
                setTeamFormData((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-team-captain">Captain</Label>
            <UserSearchCombobox
              id="workspace-team-captain"
              value={teamFormData.captain_id || undefined}
              selectedName={selectedCaptainName}
              onSelect={handleCaptainSelect}
              placeholder="Select captain"
              searchPlaceholder="Search captain..."
            />
            <p className="text-xs text-muted-foreground">
              Current value: {teamFormData.captain_id > 0 ? `User #${teamFormData.captain_id}` : "No captain selected"}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="workspace-team-avg-sr">Average SR</Label>
              <TeamNumberInput
                id="workspace-team-avg-sr"
                value={teamFormData.avg_sr}
                min={0}
                step={50}
                suffix="SR"
                onChange={(value) =>
                  setTeamFormData((current) => ({
                    ...current,
                    avg_sr: value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-team-total-sr">Total SR</Label>
              <TeamNumberInput
                id="workspace-team-total-sr"
                value={teamFormData.total_sr}
                min={0}
                step={250}
                suffix="SR"
                onChange={(value) =>
                  setTeamFormData((current) => ({
                    ...current,
                    total_sr: value,
                  }))
                }
              />
            </div>
          </div>
        </div>
      </EntityFormDialog>

      <DeleteConfirmDialog
        open={!!teamPendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setTeamPendingDelete(null);
          }
        }}
        onConfirm={() => {
          if (teamPendingDelete) {
            deleteTeamMutation.mutate(teamPendingDelete.id);
          }
        }}
        title="Delete Team"
        description={`Delete "${teamPendingDelete?.name ?? "this team"}"? This also removes roster members and related match records.`}
        cascadeInfo={[
          "Players in this team",
          "Related encounter references",
          "Stored standings rows",
        ]}
        isDeleting={deleteTeamMutation.isPending}
      />
    </>
  );
}
