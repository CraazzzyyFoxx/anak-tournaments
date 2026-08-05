"use client";

import { useState, type FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, RotateCcw, Trash2, Info, CalendarDays, EyeOff, Wrench } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateTimePicker } from "@/components/ui/date-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EYEBROW_CLASS } from "@/components/admin/tone";
import { RosterShapeEditor } from "@/components/admin/tournaments/RosterShapeEditor";
import { payloadTotalError } from "@/components/admin/tournaments/roster-shape-editor.model";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import { normalizeChallongeSlug } from "@/lib/challonge";
import { hasUnsavedChanges } from "@/lib/form-change";
import { DEFAULT_WORKSPACE_TIMEZONE, getUtcOffsetLabel } from "@/lib/timezone";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Tournament } from "@/types/tournament.types";
import type { DivisionGridVersion } from "@/types/workspace.types";
import type {
  DiscordChannelRead,
  TournamentPhaseScheduleEntryInput,
  TournamentUpdateInput
} from "@/types/admin.types";
import {
  getPhaseSchedulePayload,
  getTournamentForm,
  SCHEDULABLE_PHASES,
  type SchedulablePhase,
  type TournamentFormState
} from "./tournamentWorkspace.helpers";
import { TournamentPreviewAllowlist } from "./TournamentPreviewAllowlist";
import { TournamentIntegrationsPanel } from "./TournamentIntegrationsPanel";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";

const PHASE_LABELS: Record<SchedulablePhase, string> = {
  registration: "Registration",
  draft: "Draft",
  check_in: "Check-in",
  live: "Live"
};

interface TournamentSettingsTabProps {
  tournament: Tournament;
  tournamentId: number;
  divisionGridVersions: DivisionGridVersion[];
  divisionGridLoading: boolean;
  canDeleteTournament: boolean;
  canUpdateTournament: boolean;
  hasChallongeSource: boolean;
  discordChannel: DiscordChannelRead | null | undefined;
  discordChannelLoading: boolean;
}

export function TournamentSettingsTab({
  tournament,
  tournamentId,
  divisionGridVersions,
  divisionGridLoading,
  canDeleteTournament,
  canUpdateTournament,
  hasChallongeSource,
  discordChannel,
  discordChannelLoading
}: TournamentSettingsTabProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Schedule times are entered/shown in the tournament workspace's zone;
  // storage and the API stay UTC.
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const timezone =
    workspaces.find((ws) => ws.id === tournament.workspace_id)?.timezone ??
    DEFAULT_WORKSPACE_TIMEZONE;

  const [formData, setFormData] = useState<TournamentFormState>(
    getTournamentForm(tournament, timezone)
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const initialFormData = getTournamentForm(tournament, timezone);
  const isDirty = hasUnsavedChanges(formData, initialFormData);

  // Sync state if tournament updates in background (or the zone loads in).
  useEffect(() => {
    setFormData(getTournamentForm(tournament, timezone));
  }, [tournament, timezone]);

  const updateMutation = useMutation({
    mutationFn: async ({
      payload,
      schedule
    }: {
      payload: TournamentUpdateInput;
      schedule: TournamentPhaseScheduleEntryInput[];
    }) => {
      await adminService.updateTournament(tournamentId, payload);
      return adminService.setTournamentSchedule(tournamentId, schedule);
    },
    onSuccess: () => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      notify.success("Tournament settings updated successfully");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => adminService.deleteTournament(tournamentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      notify.success("Tournament deleted successfully");
      router.push("/admin/tournaments");
    }
  });

  const handleReset = () => {
    setFormData(initialFormData);
    notify.info("Changes discarded", { description: "Form reset to current tournament settings." });
  };

  const setPhaseField = (
    phase: SchedulablePhase,
    field: "starts_at" | "ends_at",
    nextValue: string
  ) =>
    setFormData({
      ...formData,
      phase_schedule: {
        ...formData.phase_schedule,
        [phase]: { ...formData.phase_schedule[phase], [field]: nextValue }
      }
    });

  const visiblePhases = SCHEDULABLE_PHASES.filter(
    (phase) => phase !== "draft" || formData.team_formation === "draft"
  );

  // The server rejects an out-of-range roster total with a 422; blocking the save
  // here keeps that verdict inline, where the numbers are.
  const rosterTotalError = payloadTotalError(formData.roster_slots_json);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (rosterTotalError) return;

    const payload: TournamentUpdateInput = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      challonge_slug: formData.challonge_slug
        ? normalizeChallongeSlug(formData.challonge_slug)
        : null,
      is_league: formData.is_league,
      is_finished: formData.is_finished,
      is_hidden: formData.is_hidden,
      start_date: formData.start_date,
      end_date: formData.end_date,
      win_points: formData.win_points,
      draw_points: formData.draw_points,
      loss_points: formData.loss_points,
      auto_transitions_enabled: formData.auto_transitions_enabled,
      allow_late_registration: formData.allow_late_registration,
      division_grid_version_id: formData.division_grid_version_id,
      team_formation: formData.team_formation,
      roster_slots_json: formData.roster_slots_json
    };

    updateMutation.mutate({
      payload,
      schedule: getPhaseSchedulePayload(formData.phase_schedule, timezone)
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-20">
      {/* Dirty state notification bar — the only place settings are saved from. */}
      {isDirty && (
        <div className="sticky top-4 z-40 flex items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3.5 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2 text-sm text-primary">
            <Info className="size-4 shrink-0" aria-hidden />
            <span className="font-medium">You have unsaved changes in settings.</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="h-8 border-primary/30 text-primary hover:bg-primary/20"
              disabled={updateMutation.isPending}
            >
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
              Discard
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8"
              disabled={updateMutation.isPending || rosterTotalError !== null}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}

      {/* One grid, not two hand-packed columns of cards. Card heights differ by
          hundreds of pixels, so auto-placement left a hole under whichever card
          was shorter. The two tall stacks pair up — configuration on the left,
          integrations on the right — and the schedule spans the full width,
          where its phase grid lays out as rows instead of stacking. */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          {/* Identity and description */}
          <Card className="border-border/40 bg-card/50">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Info className="size-4 text-primary" aria-hidden />
                <CardTitle asChild className="text-sm font-semibold">
                  <h2>General information</h2>
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Update core tournament identity metadata.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="settings-name" className="text-xs">
                  Tournament name
                </Label>
                <Input
                  id="settings-name"
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  required
                  className="mt-1.5 bg-background/50"
                />
              </div>
              <div>
                <Label htmlFor="settings-description" className="text-xs">
                  Description
                </Label>
                <Textarea
                  id="settings-description"
                  value={formData.description}
                  onChange={(event) =>
                    setFormData({ ...formData, description: event.target.value })
                  }
                  rows={4}
                  className="mt-1.5 bg-background/50"
                  placeholder="Optional tournament description…"
                />
              </div>
            </CardContent>
          </Card>

          {/* Format rules and scoring */}
          <Card className="border-border/40 bg-card/50">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Wrench className="size-4 text-primary" aria-hidden />
                <CardTitle asChild className="text-sm font-semibold">
                  <h2>Rules & grid configuration</h2>
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Adjust grid versions, team formation, scoring points and league status.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="settings-team-formation" className="text-xs">
                    Team formation
                  </Label>
                  <Select
                    value={formData.team_formation}
                    onValueChange={(nextValue) =>
                      setFormData({ ...formData, team_formation: nextValue })
                    }
                  >
                    <SelectTrigger id="settings-team-formation" className="mt-1.5 bg-background/50">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="balancer">Auto-balance (Balancer)</SelectItem>
                      <SelectItem value="draft">Live draft</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="settings-division-grid-version" className="text-xs">
                    Division grid version
                  </Label>
                  <Select
                    value={formData.division_grid_version_id?.toString() ?? "none"}
                    onValueChange={(nextValue) =>
                      setFormData({
                        ...formData,
                        division_grid_version_id: nextValue === "none" ? null : Number(nextValue)
                      })
                    }
                  >
                    <SelectTrigger
                      id="settings-division-grid-version"
                      className="mt-1.5 bg-background/50"
                    >
                      <SelectValue
                        placeholder={
                          divisionGridLoading ? "Loading division grids…" : "Select version"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Workspace default</SelectItem>
                      {divisionGridVersions.map((version) => (
                        <SelectItem key={version.id} value={version.id.toString()}>
                          {version.label} (v{version.version}, {version.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Checkboxes panel */}
              <div className="flex flex-col gap-4 bg-muted/20 border border-border/50 rounded-lg p-3.5">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="settings-is-league"
                    checked={formData.is_league}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, is_league: checked === true })
                    }
                  />
                  <Label
                    htmlFor="settings-is-league"
                    className="cursor-pointer text-sm font-medium"
                  >
                    Treat as league season
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="settings-is-finished"
                    checked={formData.is_finished}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, is_finished: checked === true })
                    }
                  />
                  <Label
                    htmlFor="settings-is-finished"
                    className="cursor-pointer text-sm font-medium"
                  >
                    Mark tournament as finished
                  </Label>
                </div>
              </div>

              <section className="space-y-2 border-t border-border/30 pt-4">
                <h3 className={EYEBROW_CLASS}>Scoring points</h3>
                <p className="text-xs text-muted-foreground">
                  Points awarded in standings logic for match outcomes.
                </p>
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div>
                    <Label htmlFor="settings-win-points" className="text-xs">
                      Win
                    </Label>
                    <NumberInput
                      id="settings-win-points"
                      value={formData.win_points}
                      onValueChange={(next) => setFormData({ ...formData, win_points: next ?? 0 })}
                      className="mt-1.5 bg-background/50"
                    />
                  </div>
                  <div>
                    <Label htmlFor="settings-draw-points" className="text-xs">
                      Draw
                    </Label>
                    <NumberInput
                      id="settings-draw-points"
                      value={formData.draw_points}
                      onValueChange={(next) => setFormData({ ...formData, draw_points: next ?? 0 })}
                      className="mt-1.5 bg-background/50"
                    />
                  </div>
                  <div>
                    <Label htmlFor="settings-loss-points" className="text-xs">
                      Loss
                    </Label>
                    <NumberInput
                      id="settings-loss-points"
                      value={formData.loss_points}
                      onValueChange={(next) => setFormData({ ...formData, loss_points: next ?? 0 })}
                      className="mt-1.5 bg-background/50"
                    />
                  </div>
                </div>
              </section>

              <RosterShapeEditor
                value={formData.roster_slots_json}
                effective={tournament.roster_shape}
                locked={tournament.roster_locked_by_draft === true}
                disabled={!canUpdateTournament}
                onChange={(next) => setFormData({ ...formData, roster_slots_json: next })}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right column: what points outward — external connections and public
            visibility. The integration buttons fire their own mutations, so they
            carry an explicit type inside this form. */}
        <div className="flex flex-col gap-6">
          <TournamentIntegrationsPanel
            tournamentId={tournamentId}
            tournament={tournament}
            hasChallongeSource={hasChallongeSource}
            canUpdateTournament={canUpdateTournament}
            discordChannel={discordChannel}
            discordChannelLoading={discordChannelLoading}
            challongeSlug={formData.challonge_slug}
            onChallongeSlugChange={(value) => setFormData({ ...formData, challonge_slug: value })}
          />

          {/* Public visibility is its own card, not a third section of the rules
            card: it is the one setting here that decides what the outside world
            sees, it owns a sub-list, and stacked under the integrations it
            balances the two columns instead of leaving 480px of nothing. */}
          <Card className="border-border/40 bg-card/50">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <EyeOff className="size-4 text-primary" aria-hidden />
                <CardTitle asChild className="text-sm font-semibold">
                  <h2>Visibility</h2>
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Hide this tournament and all its data from the public site. Only workspace admins
                and the preview allowlist can see a hidden tournament.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 bg-muted/20 border border-border/50 rounded-lg p-3.5">
                <Checkbox
                  id="settings-is-hidden"
                  checked={formData.is_hidden}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_hidden: checked === true })
                  }
                />
                <Label htmlFor="settings-is-hidden" className="cursor-pointer text-sm font-medium">
                  Hidden (preview) — not visible to the public
                </Label>
              </div>

              <div className="space-y-2">
                <h3 className={EYEBROW_CLASS}>Preview allowlist</h3>
                {formData.is_hidden ? (
                  <TournamentPreviewAllowlist
                    tournamentId={tournamentId}
                    workspaceId={tournament.workspace_id}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                    Tick “Hidden (preview)” above to choose who may view this tournament while it is
                    still private.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Schedule: full width so the phase grid can lay out as rows. In half a
            grid it needs 780px of columns and overflows the card. */}
        <Card className="xl:col-span-2 border-border/40 bg-card/50">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-primary" aria-hidden />
              <CardTitle asChild className="text-sm font-semibold">
                <h2>Schedule & timeline</h2>
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Manage operational dates, registration periods, and player check-in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Field>
                <FieldLabel
                  htmlFor="settings-date-range"
                  className="text-xs font-normal text-foreground"
                >
                  Tournament duration range
                </FieldLabel>
                <div className="mt-1.5">
                  <DateRangePicker
                    id="settings-date-range"
                    startDate={formData.start_date}
                    endDate={formData.end_date}
                    onChange={(start, end) =>
                      setFormData({ ...formData, start_date: start, end_date: end })
                    }
                  />
                </div>
              </Field>
            </div>

            <section className="space-y-4 border-t border-border/30 pt-4">
              <div>
                <h3 className={EYEBROW_CLASS}>Phase schedule</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each phase starts automatically at its start time when automatic transitions are
                  enabled. An end time only closes that phase&apos;s action window early — it never
                  changes the tournament status.
                </p>
                <p className="mt-1 text-xs font-medium text-foreground/80">
                  Time zone: {timezone} ({getUtcOffsetLabel(timezone)})
                </p>
              </div>

              {/* One header row instead of four repeated label pairs. Stacked
                  below lg, where each picker shows its own labels again. */}
              <div
                role="group"
                aria-label="Phase schedule"
                className="space-y-4 lg:grid lg:grid-cols-[minmax(6rem,8rem)_1fr_1fr] lg:items-center lg:gap-x-4 lg:gap-y-3 lg:space-y-0"
              >
                <div aria-hidden className="hidden lg:contents">
                  <span />
                  <span className={EYEBROW_CLASS}>Starts at</span>
                  <span className={EYEBROW_CLASS}>Ends at (optional)</span>
                </div>

                {visiblePhases.map((phase) => (
                  <div key={phase} className="space-y-2 lg:contents">
                    <p className="text-xs font-medium text-foreground lg:py-1">
                      {PHASE_LABELS[phase]}
                    </p>
                    <DateTimePicker
                      id={`settings-phase-${phase}-starts`}
                      timeId={`settings-phase-${phase}-starts-time`}
                      dateLabel={`${PHASE_LABELS[phase]} starts at`}
                      timeLabel={`${PHASE_LABELS[phase]} start time`}
                      labelClassName="lg:sr-only"
                      value={formData.phase_schedule[phase].starts_at}
                      onChange={(nextValue) => setPhaseField(phase, "starts_at", nextValue)}
                    />
                    <DateTimePicker
                      id={`settings-phase-${phase}-ends`}
                      timeId={`settings-phase-${phase}-ends-time`}
                      dateLabel={`${PHASE_LABELS[phase]} ends at (optional)`}
                      timeLabel={`${PHASE_LABELS[phase]} end time`}
                      labelClassName="lg:sr-only"
                      value={formData.phase_schedule[phase].ends_at}
                      onChange={(nextValue) => setPhaseField(phase, "ends_at", nextValue)}
                    />
                  </div>
                ))}
              </div>
            </section>

            <div className="flex flex-col gap-4 bg-muted/20 border border-border/50 rounded-lg p-3.5">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="settings-auto-transitions"
                    className="cursor-pointer text-sm font-medium"
                  >
                    Automatic phase transitions
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Re-enabling immediately catches up any overdue phases. Manual status changes
                    switch this off.
                  </p>
                </div>
                <Switch
                  id="settings-auto-transitions"
                  checked={formData.auto_transitions_enabled}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, auto_transitions_enabled: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="settings-allow-late-registration"
                    className="cursor-pointer text-sm font-medium"
                  >
                    Allow late registration
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Keep registration open after the registration phase, until the tournament is
                    completed.
                  </p>
                </div>
                <Switch
                  id="settings-allow-late-registration"
                  checked={formData.allow_late_registration}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, allow_late_registration: checked })
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Full width, so the action sits beside its warning rather than under
            it: a destructive button stretched across the whole grid is a
            1500px-wide target for the one irreversible action on the page. */}
        {canDeleteTournament && (
          <Card className="xl:col-span-2 border-destructive/30 bg-destructive/5">
            <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
                <p className="text-xs text-destructive/70">
                  Deleting a tournament permanently removes its logs, rosters and standings.
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                className="sm:w-auto"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-2 size-4" aria-hidden />
                {deleteMutation.isPending ? "Deleting…" : "Delete tournament"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {canDeleteTournament && (
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={() => deleteMutation.mutate()}
          title="Delete tournament"
          description={`"${tournament.name}" and every piece of workspace data linked to it will be removed. This cannot be undone.`}
          cascadeInfo={[
            "Tournament stages",
            "Teams and players",
            "Encounters and matches",
            "Standings rows"
          ]}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </form>
  );
}
