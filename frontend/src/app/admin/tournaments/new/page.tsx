"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

import { SCHEDULABLE_PHASES } from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.helpers";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DivisionGridVersion } from "@/types/workspace.types";

import { BasicsStep } from "./steps/BasicsStep";
import { RegistrationStep } from "./steps/RegistrationStep";
import { ReviewStep } from "./steps/ReviewStep";
import { RulesStep } from "./steps/RulesStep";
import { ScheduleStep } from "./steps/ScheduleStep";
import {
  canCreateNow,
  canNavigateToWizardStep,
  nextWizardStep,
  previousWizardStep,
  validateWizardStep,
  visibleWizardSteps,
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
  const { canAccessPermission } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
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

  const basics: WizardBasicsState = {
    source,
    name: form.name,
    challongeSlug,
    startDate: form.start_date,
    endDate: form.end_date
  };
  const createNowReady = canCreateNow(basics);

  const createTournament = (publish: boolean) => {
    // TODO(T11): lazy Unpublished draft (POST with is_hidden), Create now with
    // defaults, publish on Review & Create, then redirect to the hub overview.
    console.info("[tournament-wizard] create (stub, T11)", {
      publish,
      source,
      challongeSlug,
      form,
      schedule,
      registration: canTeamImport ? registration : null
    });
    notify.info("Not wired yet", {
      description: "Tournament creation lands with the draft flow (next iteration)."
    });
  };

  const next = () => {
    if (validateWizardStep(activeStep, basics).length > 0) {
      notify.warning("Fill in the required fields to continue");
      return;
    }
    setStep(nextWizardStep(steps, activeStep));
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="New Tournament"
        description="Set up a tournament step by step. Only the basics are required."
      />

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
            <RegistrationStep value={registration} onChange={setRegistration} />
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
                disabled={!createNowReady}
                onClick={() => createTournament(false)}
              >
                Create now
              </Button>
            )}
            {activeStep === "review" ? (
              <Button type="button" onClick={() => createTournament(true)}>
                Create tournament
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
