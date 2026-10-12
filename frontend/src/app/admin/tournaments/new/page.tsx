"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, PenLine } from "lucide-react";

import { getPhaseSchedulePayload } from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.helpers";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  WizardShell,
  type WizardStep as WizardRailStep
} from "@/components/kit/WizardShell";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { normalizeChallongeSlug } from "@/lib/tournament/challonge";
import { notify } from "@/lib/notify";
import { DEFAULT_WORKSPACE_TIMEZONE } from "@/lib/workspace/timezone";
import { SCHEDULABLE_PHASES } from "@/lib/tournament/lifecycle";
import adminService from "@/services/admin.service";
import balancerAdminService from "@/services/balancer-admin.service";
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
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";
import { workspaceQueryKeys } from "@/lib/workspace/query-keys";

const STEP_META: Record<WizardStep, { labelKey: WizardStep; descriptionKey: WizardStep }> = {
  basics: {
    labelKey: "basics",
    descriptionKey: "basics"
  },
  schedule: {
    labelKey: "schedule",
    descriptionKey: "schedule"
  },
  rules: {
    labelKey: "rules",
    descriptionKey: "rules"
  },
  registration: {
    labelKey: "registration",
    descriptionKey: "registration"
  },
  review: {
    labelKey: "review",
    descriptionKey: "review"
  }
};

/** `validateWizardStep` returns codes; the wizard turns them into a fix. */
const BASICS_ERRORS: Record<string, string> = {
  name_required: "nameRequired",
  challonge_slug_required: "challongeRequired",
  dates_required: "datesRequired"
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
  auto_transitions_enabled: true
};

export default function NewTournamentPage() {
  const t = useTranslations("adminTournaments.new");
  const validationMessages: Record<string, string> = {
    nameRequired: t("validation.nameRequired"),
    challongeRequired: t("validation.challongeRequired"),
    datesRequired: t("validation.datesRequired")
  };
  const router = useRouter();
  const queryClient = useQueryClient();
  const { canAccessPermission } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const timezone =
    workspaces.find((ws) => ws.id === currentWorkspaceId)?.timezone ?? DEFAULT_WORKSPACE_TIMEZONE;
  const canCreate = canAccessPermission("tournament.create", currentWorkspaceId);
  const canTeamImport = canAccessPermission("team.create", currentWorkspaceId);
  const steps = useMemo(() => visibleWizardSteps(canTeamImport), [canTeamImport]);

  // Step and source live in the URL: the step so a reload keeps the place, the
  // source so "import from Challonge" is a linkable entry to this same wizard.
  // `push`, not `replace` — the browser Back button should step back a step.
  const { searchParams, setParams } = useQueryParams({ mode: "push" });
  const requestedStep = searchParams?.get("step");
  // The registration step can disappear while active (the permission profile
  // loads in), and `?step=` is user-supplied — both fall back to step 1.
  const activeStep = steps.find((entry) => entry === requestedStep) ?? "basics";
  const activeIndex = steps.indexOf(activeStep);
  const source: WizardSource = searchParams?.get("source") === "challonge" ? "challonge" : "manual";

  const [challongeSlug, setChallongeSlug] = useState("");
  const [form, setForm] = useState<WizardFormData>(emptyForm);
  const [schedule, setSchedule] = useState<WizardScheduleState>(emptySchedule);
  const [registration, setRegistration] = useState<WizardRegistrationState>({
    auto_approve: false,
    require_open_profile: false,
    require_subscription: false
  });

  // Lazy Unpublished draft (D4): created by the first action needing an id.
  // The ref mirrors the state so async closures never see a stale draft, and
  // the promise ref collapses concurrent triggers into one POST.
  const [draft, setDraft] = useState<Tournament | null>(null);
  const draftRef = useRef<Tournament | null>(null);
  const draftPromiseRef = useRef<Promise<Tournament> | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);

  const divisionGridsQuery = useQuery({
    queryKey: adminQueryKeys.tournamentWizardDivisionGrids(currentWorkspaceId),
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

  // The subscription rule is a workspace property now, so the review step reads it
  // from the workspace rather than from the wizard state. Fetched here, next to the
  // division grids, because that is where this wizard loads its server data.
  const subscriptionRequirementQuery = useQuery({
    queryKey: workspaceQueryKeys.subscriptionRequirement(currentWorkspaceId),
    queryFn: () => balancerAdminService.getSubscriptionRequirement(currentWorkspaceId as number),
    enabled: Boolean(currentWorkspaceId)
  });

  // Resume (D4): the latest Unpublished stage-less tournament of this
  // workspace is an abandoned wizard draft — offer to continue it.
  const resumeQuery = useQuery({
    queryKey: adminQueryKeys.tournamentWizardResume(currentWorkspaceId),
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

  const goToStep = (target: WizardStep) => setParams({ step: target });

  const resumeDraft = (candidate: Tournament) => {
    const prefill = wizardStateFromDraft(candidate, timezone);
    setParams({ step: "basics", source: null });
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

  /** ensureSession pattern (DraftSetupWizard): first caller POSTs the hidden
   * draft, everyone after — including retries of Save as draft / publish —
   * reuses the same tournament and only PATCHes it. */
  const ensureDraft = (): Promise<Tournament> => {
    if (draftRef.current) return Promise.resolve(draftRef.current);
    if (!draftPromiseRef.current) {
      const workspaceId = currentWorkspaceId;
      draftPromiseRef.current = (async () => {
        if (!workspaceId) throw new Error(t("selectWorkspace"));
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
              notify.warning(t("importHideWarning"), { description: t("importHideDescription") });
              created = imported;
            }
          }
        } else {
          created = await adminService.createTournament(buildDraftCreateInput(workspaceId, form));
        }
        adoptDraft(created);
        void queryClient.invalidateQueries({ queryKey: tournamentQueryKeys.list() });
        void queryClient.invalidateQueries({
          queryKey: adminQueryKeys.tournamentWizardResumeAll()
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
      void queryClient.invalidateQueries({ queryKey: tournamentQueryKeys.list() });
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.tournamentWizardResumeAll() });
      notify.success(publish ? t("created") : t("draftCreated"), {
        description: publish
          ? undefined
          : t("draftDescription")
      });
      router.push(`/admin/tournaments/${id}/overview`);
    },
    onError: (error) => notify.apiError(error, { title: t("createError") })
  });

  /** Validation runs on submit, so every action stays reachable and explains
   * itself. Both writes go through here — the step is in the URL, so review is
   * reachable by a pasted link that never passed a Continue. */
  const createTournament = (publish: boolean) => {
    const problems = validateWizardStep("basics", basics);
    if (problems.length > 0) {
      notify.warning(problems.map((code) => validationMessages[BASICS_ERRORS[code] ?? code] ?? code).join(" "));
      return;
    }
    finishMutation.mutate(publish);
  };

  const next = () => {
    const problems = validateWizardStep(activeStep, basics);
    if (problems.length > 0) {
      notify.warning(problems.map((code) => validationMessages[BASICS_ERRORS[code] ?? code] ?? code).join(" "));
      return;
    }
    const target = nextWizardStep(steps, activeStep);
    // Step 4 links the form builder and review publishes via PATCH — both
    // need the draft; create it in the background on entry.
    if (stepEntryRequiresDraft(target)) {
      ensureDraft().catch((error) =>
        notify.apiError(error, { title: t("draftError") })
      );
    }
    goToStep(target);
  };

  const rail: WizardRailStep[] = steps.map((entry, index) => ({
    key: entry,
    label: t(`steps.${STEP_META[entry].labelKey}.label`),
    state: index === activeIndex ? "current" : index < activeIndex ? "done" : "todo"
  }));

  // Keeps `step` when flipping the source, so the link never resets the wizard.
  const sourceHref = useMemo(() => {
    const query = new URLSearchParams(searchParams?.toString() ?? "");
    if (source === "challonge") query.delete("source");
    else query.set("source", "challonge");
    const search = query.toString();
    return search ? `/admin/tournaments/new?${search}` : "/admin/tournaments/new";
  }, [searchParams, source]);

  if (!canCreate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("unauthorized")}</CardTitle>
          <CardDescription>
            {t("unauthorizedDescription")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={t("title")}
        description={t("description")}
      />

      <ConfirmDialog
        open={showResumePrompt}
        onOpenChange={(open) => {
          if (!open) setResumeDismissed(true);
        }}
        intent={{
          title: t("resumeTitle"),
          description: t("resumeDescription", { name: resumable?.name ?? "" }),
          confirmLabel: t("resume"),
          tone: "neutral"
        }}
        onConfirm={() => {
          if (resumable) resumeDraft(resumable);
        }}
      />

      <WizardShell
        steps={rail}
        aside={
          <Link
            href={sourceHref}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            {source === "challonge" ? (
              <PenLine aria-hidden className="size-4 shrink-0" />
            ) : (
              <Download aria-hidden className="size-4 shrink-0" />
            )}
            {source === "challonge"
              ? t("manualInstead")
              : t("importInstead")}
          </Link>
        }
        footer={{
          back: activeIndex > 0 ? () => goToStep(previousWizardStep(steps, activeStep)) : undefined,
          secondary:
            activeStep === "review" ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={finishMutation.isPending}
                onClick={() => createTournament(false)}
              >
                {finishMutation.isPending ? t("saving") : t("saveDraft")}
              </Button>
            ),
          next:
            activeStep === "review"
              ? {
                  label: finishMutation.isPending ? t("creating") : t("create"),
                  onClick: () => createTournament(true),
                  disabled: finishMutation.isPending
                }
              : { label: t("continue"), onClick: next }
        }}
      >
        <div className="space-y-1">
          <p className={`${EYEBROW_CLASS} tabular-nums`}>
            {t("stepOf", { current: activeIndex + 1, total: steps.length })}
          </p>
          <h2 className="font-display text-xl font-semibold text-foreground">
            {t(`steps.${STEP_META[activeStep].labelKey}.label`)}
          </h2>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t(`steps.${STEP_META[activeStep].descriptionKey}.description`)}
          </p>
        </div>

        <Card className="mt-5 p-4 sm:p-6">
          {activeStep === "basics" && (
            <BasicsStep
              source={source}
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
            <RegistrationStep
              value={registration}
              onChange={setRegistration}
              draftId={draft?.id ?? null}
            />
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
              subscriptionRequirement={subscriptionRequirementQuery.data?.requirement}
            />
          )}
        </Card>
      </WizardShell>
    </div>
  );
}
