"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  UsersRound,
  Wrench
} from "lucide-react";

import {
  getPhaseSchedulePayload,
  SCHEDULABLE_PHASES
} from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.helpers";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePermissions } from "@/hooks/usePermissions";
import { normalizeChallongeSlug } from "@/lib/challonge";
import { notify } from "@/lib/notify";
import { DEFAULT_WORKSPACE_TIMEZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import tournamentService from "@/services/tournament.service";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Tournament } from "@/types/tournament.types";
import type { DivisionGridVersion } from "@/types/workspace.types";

import { BasicsStep } from "./steps/BasicsStep";
import { RegistrationStep } from "./steps/RegistrationStep";
import { ReviewStep } from "./steps/ReviewStep";
import { RulesStep } from "./steps/RulesStep";
import { ScheduleStep } from "./steps/ScheduleStep";
import {
  buildDraftCreateInput,
  buildDraftUpdateInput,
  canCreateNow,
  canNavigateToWizardStep,
  findResumableDraft,
  nextWizardStep,
  previousWizardStep,
  stepEntryRequiresDraft,
  validateWizardStep,
  visibleWizardSteps,
  wizardStateFromDraft,
  type WizardBasicsState,
  type WizardFormData,
  type WizardRegistrationState,
  type WizardScheduleState,
  type WizardSource,
  type WizardStep
} from "./wizard-model";

const STEP_META: Record<
  WizardStep,
  { label: string; description: string; icon: typeof ClipboardList }
> = {
  basics: {
    label: "Basics",
    description: "Name the tournament and pick its dates, or import from Challonge.",
    icon: ClipboardList
  },
  schedule: {
    label: "Schedule",
    description: "Optional phase schedule and automatic transitions.",
    icon: CalendarDays
  },
  rules: {
    label: "Rules",
    description: "Team formation, division grid, and scoring points.",
    icon: Wrench
  },
  registration: {
    label: "Registration",
    description: "How players sign up. The full form builder opens after creation.",
    icon: UsersRound
  },
  review: {
    label: "Review & Create",
    description: "Check the configuration and create the tournament.",
    icon: ClipboardCheck
  }
};

const emptyForm: WizardFormData = {
  name: "",
  description: "",
  is_league: false,
  start_date: "",
  end_date: "",
  division_grid_version_id: null,
  team_formation: "balancer",
  win_points: 1,
  draw_points: 0.5,
  loss_points: 0
};

const emptySchedule: WizardScheduleState = {
  phase_schedule: Object.fromEntries(
    SCHEDULABLE_PHASES.map((phase) => [phase, { starts_at: "", ends_at: "" }])
  ) as WizardScheduleState["phase_schedule"],
  auto_transitions_enabled: true,
  allow_late_registration: false
};

export default function NewTournamentPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { canAccessPermission } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const timezone =
    workspaces.find((ws) => ws.id === currentWorkspaceId)?.timezone ?? DEFAULT_WORKSPACE_TIMEZONE;
  const canTeamImport = canAccessPermission("team.import", currentWorkspaceId);
  const steps = useMemo(() => visibleWizardSteps(canTeamImport), [canTeamImport]);

  const [step, setStep] = useState<WizardStep>("basics");
  const [source, setSource] = useState<WizardSource>("manual");
  const [challongeSlug, setChallongeSlug] = useState("");
  const [form, setForm] = useState<WizardFormData>(emptyForm);
  const [schedule, setSchedule] = useState<WizardScheduleState>(emptySchedule);
  const [registration, setRegistration] = useState<WizardRegistrationState>({
    is_open: true,
    auto_approve: false,
    require_open_profile: false
  });

  // Lazy Unpublished draft (D4): created by the first action needing an id.
  // The ref mirrors the state so async closures never see a stale draft, and
  // the promise ref collapses concurrent triggers into one POST.
  const [draft, setDraft] = useState<Tournament | null>(null);
  const draftRef = useRef<Tournament | null>(null);
  const draftPromiseRef = useRef<Promise<Tournament> | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);

  // The registration step can disappear while active (permission profile loads in).
  const activeStep = steps.includes(step) ? step : "basics";
  const activeIndex = steps.indexOf(activeStep);

  const divisionGridsQuery = useQuery({
    queryKey: ["admin", "tournaments", "create", "division-grids", currentWorkspaceId],
    queryFn: async () => {
      if (!currentWorkspaceId) return [];
      return workspaceService.getDivisionGrids(currentWorkspaceId);
    },
    enabled: Boolean(currentWorkspaceId)
  });
  const divisionGridVersions: DivisionGridVersion[] = (divisionGridsQuery.data ?? [])
    .flatMap((grid) => grid.versions)
    .slice()
    .sort((left, right) => right.version - left.version);

  // Resume (D4): the latest Unpublished stage-less tournament of this
  // workspace is an abandoned wizard draft — offer to continue it.
  const resumeQuery = useQuery({
    queryKey: ["admin", "tournaments", "wizard-resume", currentWorkspaceId],
    queryFn: () => tournamentService.getAll(null, currentWorkspaceId),
    enabled: Boolean(currentWorkspaceId),
    staleTime: Infinity
  });
  const resumable = findResumableDraft(resumeQuery.data?.results ?? [], currentWorkspaceId);
  const showResumePrompt = Boolean(resumable) && !resumeDismissed && !draft;

  const adoptDraft = (tournament: Tournament) => {
    draftRef.current = tournament;
    draftPromiseRef.current = Promise.resolve(tournament);
    setDraft(tournament);
  };

  const resumeDraft = (candidate: Tournament) => {
    const prefill = wizardStateFromDraft(candidate, timezone);
    setSource("manual");
    setChallongeSlug(candidate.challonge_slug ?? "");
    setForm(prefill.form);
    setSchedule(prefill.schedule);
    adoptDraft(candidate);
    setResumeDismissed(true);
  };

  const basics: WizardBasicsState = {
    source,
    name: form.name,
    challongeSlug,
    startDate: form.start_date,
    endDate: form.end_date
  };
  const createNowReady = canCreateNow(basics);

  /** ensureSession pattern (DraftSetupWizard): first caller POSTs the hidden
   * draft, everyone after — including retries of Create now / publish —
   * reuses the same tournament and only PATCHes it. */
  const ensureDraft = (): Promise<Tournament> => {
    if (draftRef.current) return Promise.resolve(draftRef.current);
    if (!draftPromiseRef.current) {
      const workspaceId = currentWorkspaceId;
      draftPromiseRef.current = (async () => {
        if (!workspaceId) throw new Error("Select a workspace first");
        let created: Tournament;
        if (source === "challonge") {
          const imported = await adminService.createTournamentWithGroups({
            workspace_id: workspaceId,
            challonge_slug: normalizeChallongeSlug(challongeSlug),
            is_league: form.is_league,
            start_date: form.start_date,
            end_date: form.end_date,
            division_grid_version_id: form.division_grid_version_id ?? null
          });
          // Adopt BEFORE hiding: a failed hide must never re-run the import
          // (duplicate tournaments). with_groups cannot take is_hidden itself.
          adoptDraft(imported);
          try {
            created = await adminService.updateTournament(imported.id, { is_hidden: true });
          } catch {
            try {
              created = await adminService.updateTournament(imported.id, { is_hidden: true });
            } catch {
              notify.warning("Imported from Challonge, but hiding it failed", {
                description:
                  "The tournament is temporarily public — hide it from Settings → Visibility if needed."
              });
              created = imported;
            }
          }
        } else {
          created = await adminService.createTournament(buildDraftCreateInput(workspaceId, form));
        }
        adoptDraft(created);
        void queryClient.invalidateQueries({ queryKey: ["tournaments"] });
        void queryClient.invalidateQueries({
          queryKey: ["admin", "tournaments", "wizard-resume"]
        });
        return created;
      })().catch((error) => {
        // A created-but-unadopted draft only happens before the import resolves;
        // after adoption draftRef short-circuits this initializer entirely.
        draftPromiseRef.current = null;
        throw error;
      });
    }
    return draftPromiseRef.current;
  };

  const finishMutation = useMutation({
    mutationFn: async (publish: boolean) => {
      const active = await ensureDraft();
      await adminService.updateTournament(
        active.id,
        buildDraftUpdateInput(form, schedule, { publish })
      );
      const scheduleEntries = getPhaseSchedulePayload(schedule.phase_schedule, timezone);
      if (scheduleEntries.length > 0) {
        await adminService.setTournamentSchedule(active.id, scheduleEntries);
      }
      return { id: active.id, publish };
    },
    onSuccess: ({ id, publish }) => {
      void queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "tournaments", "wizard-resume"] });
      notify.success(publish ? "Tournament created" : "Draft created", {
        description: publish
          ? undefined
          : "It stays Unpublished until you publish it from Review or Settings."
      });
      router.push(`/admin/tournaments/${id}/overview`);
    },
    onError: (error) => notify.apiError(error, { title: "Could not create the tournament" })
  });

  const createTournament = (publish: boolean) => finishMutation.mutate(publish);

  const next = () => {
    if (validateWizardStep(activeStep, basics).length > 0) {
      notify.warning("Fill in the required fields to continue");
      return;
    }
    const target = nextWizardStep(steps, activeStep);
    // Step 4 links the form builder and review publishes via PATCH — both
    // need the draft; create it in the background on entry.
    if (stepEntryRequiresDraft(target)) {
      ensureDraft().catch((error) =>
        notify.apiError(error, { title: "Could not create the draft" })
      );
    }
    setStep(target);
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="New Tournament"
        description="Set up a tournament step by step. Only the basics are required."
      />

      <AlertDialog open={showResumePrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Continue setup?</AlertDialogTitle>
            <AlertDialogDescription>
              “{resumable?.name}” is an Unpublished draft you started earlier. Continue setting it
              up, or start a new tournament from scratch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setResumeDismissed(true)}>
              Start new
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => resumable && resumeDraft(resumable)}>
              Continue setup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-[640px] items-center gap-2" aria-label="Creation steps">
          {steps.map((entry, index) => {
            const Icon = STEP_META[entry].icon;
            const complete = index < activeIndex;
            const active = entry === activeStep;
            const reachable = canNavigateToWizardStep(steps, activeStep, entry);
            return (
              <li key={entry} className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => setStep(entry)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 border-y border-border/40 px-3 py-2.5 text-left transition-colors",
                    active && "border-primary bg-primary/10 text-primary",
                    complete && !active && "text-foreground",
                    !active && !complete && "text-muted-foreground",
                    reachable && !active && "hover:border-primary/50",
                    !reachable && "cursor-default"
                  )}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted/40">
                    {complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <span className="truncate text-xs font-medium">
                    {index + 1}. {STEP_META[entry].label}
                  </span>
                </button>
                {index < steps.length - 1 && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <Card className="border-border/40 bg-card/50 overflow-hidden py-0">
        <div className="border-b border-border/40 px-5 py-5 sm:px-7">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
            Step {activeIndex + 1} of {steps.length}
          </p>
          <h2 className="mt-2 text-2xl font-semibold">{STEP_META[activeStep].label}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {STEP_META[activeStep].description}
          </p>
        </div>

        <div className="p-4 sm:p-7">
          {activeStep === "basics" && (
            <BasicsStep
              source={source}
              onSourceChange={setSource}
              value={form}
              onChange={setForm}
              challongeSlug={challongeSlug}
              onChallongeSlugChange={setChallongeSlug}
              divisionGridVersions={divisionGridVersions}
              divisionGridLoading={divisionGridsQuery.isLoading}
            />
          )}
          {activeStep === "schedule" && (
            <ScheduleStep
              value={schedule}
              onChange={setSchedule}
              showDraftPhase={form.team_formation === "draft"}
            />
          )}
          {activeStep === "rules" && (
            <RulesStep
              value={form}
              onChange={setForm}
              divisionGridVersions={divisionGridVersions}
              divisionGridLoading={divisionGridsQuery.isLoading}
            />
          )}
          {activeStep === "registration" && (
            <RegistrationStep value={registration} onChange={setRegistration} draftId={draft?.id ?? null} />
          )}
          {activeStep === "review" && (
            <ReviewStep
              source={source}
              challongeSlug={challongeSlug}
              form={form}
              schedule={schedule}
              registration={registration}
              registrationVisible={canTeamImport}
              divisionGridVersions={divisionGridVersions}
            />
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border/40 bg-background/95 px-4 py-3 backdrop-blur supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-7">
          <Button
            type="button"
            variant="ghost"
            disabled={activeIndex === 0}
            onClick={() => setStep(previousWizardStep(steps, activeStep))}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            {activeStep !== "review" && (
              <Button
                type="button"
                variant="outline"
                disabled={!createNowReady || finishMutation.isPending}
                onClick={() => createTournament(false)}
              >
                Create now
              </Button>
            )}
            {activeStep === "review" ? (
              <Button
                type="button"
                disabled={finishMutation.isPending}
                onClick={() => createTournament(true)}
              >
                {finishMutation.isPending ? "Creating…" : "Create tournament"}
              </Button>
            ) : (
              <Button type="button" onClick={next}>
                Continue
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
