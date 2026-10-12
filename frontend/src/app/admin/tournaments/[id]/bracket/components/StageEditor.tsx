"use client";

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useBracketRoundLabel } from "@/hooks/useBracketRoundLabel";
import { usePathname, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  GitMerge,
  MoreHorizontal,
  PlayCircle,
  Shuffle,
  Trash2,
  Undo2,
  Wand2,
  Workflow,
  Link2,
  Zap
} from "lucide-react";

import { LinkTabs, type LinkTabItem } from "@/components/kit/LinkTabs";
import { ConfirmDialog, type ConfirmIntent } from "@/components/kit/ConfirmDialog";
import { EntityHubHeader } from "@/components/kit/EntityHubHeader";
import { SaveBar } from "@/components/kit/SaveBar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { Stage, StageItem, Tournament } from "@/types/tournament.types";
import type { Team } from "@/types/team.types";

import {
  BRACKET_STAGE_TYPES,
  FFA_STAGE_TYPES,
  getDefaultMergedStageName,
  getStageStatus,
  getStageStatusTone,
  GROUP_STAGE_TYPES,
  isMergeableGroupStage,
  normalizeMaxRounds,
  projectStage,
  type StageProgress
} from "@/lib/bracket/projection";
import { Spinner } from "@/components/ui/spinner";
import {
  buildStageUpdatePayload,
  stageFormChanges,
  stageFormFromStage,
  type StageForm
} from "../stageForm";
import { BracketLayoutSection } from "./BracketLayoutSection";
import { FfaScoringSection } from "./FfaScoringSection";
import { RoundScheduleSection } from "./RoundScheduleSection";
import { StageItemsSection } from "./StageItemsSection";
import {
  BestOfSection,
  GeneralSection,
  SeedingSection,
  TiebreakersSection
} from "./StageSettingsSections";
import { tabFallback } from "../../hubQueries";
import { MatchesView } from "../../matches/MatchesView";

// The standings table is the heaviest thing the editor can show and only one
// section of eight needs it, so it is split out of the Bracket tab's bundle.
const StandingsBrowser = dynamic(
  () =>
    import("@/components/admin/StandingsBrowser").then((module) => ({
      default: module.StandingsBrowser
    })),
  { loading: () => tabFallback }
);

export const BRACKET_SECTIONS = [
  "general",
  "seeding",
  "ffa-scoring",
  "tiebreakers",
  "best-of",
  "schedule",
  "layout",
  "standings",
  "items"
] as const;
export type BracketSection = (typeof BRACKET_SECTIONS)[number];

/** Each section's tab label key in `adminBracket.editor`. */
const BRACKET_SECTION_MESSAGE_KEYS = {
  general: "general",
  seeding: "seeding",
  "ffa-scoring": "ffaScoring",
  tiebreakers: "tiebreakers",
  "best-of": "bestOf",
  schedule: "schedule",
  layout: "layout",
  standings: "standings",
  items: "items"
} as const satisfies Record<BracketSection, string>;

/** Every confirm-guarded stage operation, and what the dialog says about it. */
type PendingOp =
  | { kind: "delete-stage" }
  | { kind: "delete-item"; item: StageItem }
  | { kind: "remove-input"; inputId: number; label: string }
  | { kind: "seed" }
  | { kind: "merge" }
  | { kind: "force-activate" }
  | { kind: "deactivate" }
  | { kind: "regenerate" };

interface StageEditorProps {
  stage: Stage;
  stages: Stage[];
  tournament: Tournament | undefined;
  teams: Team[];
  isTeamsLoading: boolean;
  progress: StageProgress | undefined;
  isSuperuser: boolean;
  /** `Matches › Encounters` scoped to this stage. */
  encountersHref: string;
  onChanged: () => void;
  /** After a delete or a merge the selected stage is gone. */
  onSelect: (stageId: number | null) => void;
}

/**
 * The detail column of the Bracket tab: one stage, five sections, one save.
 *
 * The pre-redesign screen put all of this behind an `Advanced` disclosure and
 * spread seven separate delete-confirmation dialogs around it. Here the
 * sections are routed (`?section=`), the drafts are one object, and every
 * destructive operation goes through the single `ConfirmDialog` below with a
 * swapped `intent`.
 *
 * Mount with `key={stage.id}`: the drafts are per-stage, and remounting is how
 * they reset when the selection changes.
 */
export function StageEditor({
  stage,
  stages,
  tournament,
  teams,
  isTeamsLoading,
  progress,
  isSuperuser,
  encountersHref,
  onChanged,
  onSelect
}: Readonly<StageEditorProps>) {
  const t = useTranslations("adminBracket.editor");
  const tRoot = useTranslations("adminBracket");
  const formatRound = useBracketRoundLabel();
  const intentT = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const intentRootT = tRoot as unknown as (key: string, values?: Record<string, unknown>) => string;
  const tr = (key: string, values?: Record<string, unknown>) => tRoot(key as never, values as never);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<StageForm>(() => stageFormFromStage(stage));
  const [pendingOp, setPendingOp] = useState<PendingOp | null>(null);
  // The last refusal of a save. The FFA rules are the one part of this form the
  // server rejects by position inside a field, and a toast cannot point at one.
  const [saveError, setSaveError] = useState<unknown>(null);

  const hasEncounters = (progress?.total ?? 0) > 0;
  const changes = stageFormChanges(stage, form);
  // The engine's own round list: the shape the bracket will actually be
  // generated in, including an uneven upper/lower split (and, later, a custom
  // bracket template) that no team-count formula can derive. Keyed on the whole
  // `stage` the way the bracket preview is, so a save refetches it.
  const plannedRoundsQuery = useQuery({
    queryKey: adminQueryKeys.stagePlannedRounds(stage.id, stage),
    queryFn: () => adminService.getStagePlannedRounds(stage.id),
    enabled: BRACKET_STAGE_TYPES.includes(stage.stage_type)
  });
  // The engine answered for the SAVED format. With another one picked and not
  // yet saved, its rounds describe a stage that is about to stop existing, so
  // the projection falls back to the team-count formula until the save lands.
  const plannedRounds =
    form.stageType === stage.stage_type ? plannedRoundsQuery.data : undefined;

  const projection = useMemo(
    () =>
      projectStage({
        stage,
        stages,
        stageType: form.stageType,
        maxRounds: normalizeMaxRounds(form.maxRounds, stage.max_rounds ?? 5),
        bestOf: form.bestOf,
        plannedRounds,
        formatRound
      }),
    [stage, stages, form.stageType, form.maxRounds, form.bestOf, plannedRounds, formatRound]
  );

  const mergeCandidates = isMergeableGroupStage(stage)
    ? stages.filter(
        (candidate) =>
          candidate.id !== stage.id &&
          candidate.stage_type === stage.stage_type &&
          isMergeableGroupStage(candidate)
      )
    : [];
  const mergedName = getDefaultMergedStageName(stage);

  const sectionAllowed: Record<BracketSection, boolean> = {
    general: true,
    seeding: true,
    "ffa-scoring": FFA_STAGE_TYPES.includes(form.stageType),
    // Standings presets and tiebreakers rank the stages that produce a table:
    // a group, and an FFA league (whose lobby IS its table).
    tiebreakers:
      GROUP_STAGE_TYPES.includes(form.stageType) || FFA_STAGE_TYPES.includes(form.stageType),
    "best-of": true,
    schedule: true,
    // Only an elimination bracket HAS a layout to draw.
    layout: BRACKET_STAGE_TYPES.includes(form.stageType),
    standings: true,
    items: true
  };
  const requested = searchParams?.get("section") ?? "";
  const section: BracketSection = (BRACKET_SECTIONS as readonly string[]).includes(requested)
    ? (requested as BracketSection)
    : "general";
  const activeSection = sectionAllowed[section] ? section : "general";

  const sectionHref = (key: BracketSection) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("stage", String(stage.id));
    next.set("section", key);
    return `${pathname}?${next.toString()}`;
  };

  const updateMutation = useMutation({
    mutationFn: () => adminService.updateStage(stage.id, buildStageUpdatePayload(stage, form)),
    onMutate: () => setSaveError(null),
    onSuccess: (saved) => {
      setForm(stageFormFromStage(saved));
      onChanged();
    },
    onError: (error) => {
      setSaveError(error);
      notify.apiError(error, { title: t("saveError") });
    }
  });

  const activateMutation = useMutation({
    mutationFn: () => adminService.activateStage(stage.id),
    onSuccess: () => onChanged()
  });

  const deactivateMutation = useMutation({
    mutationFn: () => adminService.deactivateStage(stage.id),
    onSuccess: () => {
      setPendingOp(null);
      onChanged();
      notify.success(t("reverted"));
    },
    onError: (error) => notify.apiError(error, { title: t("revertError") })
  });

  const generateMutation = useMutation({
    mutationFn: () => adminService.generateBracket(stage.id),
    onSuccess: () => {
      setPendingOp(null);
      onChanged();
    },
    onError: (error) => notify.apiError(error, { title: t("generateError") })
  });

  const applyBestOfMutation = useMutation({
    mutationFn: () => adminService.applyStageBestOf(stage.id),
    onSuccess: ({ updated }) => {
      notify.success(t("updatedBestOf", { count: updated }));
      onChanged();
    },
    onError: (error) =>
      notify.apiError(error, { title: t("applyBestOfError") })
  });

  const deleteMutation = useMutation({
    mutationFn: () => adminService.deleteStage(stage.id),
    onSuccess: () => {
      setPendingOp(null);
      onSelect(null);
      onChanged();
    }
  });

  const mergeMutation = useMutation({
    mutationFn: () =>
      adminService.mergeGroupStages(stage.id, {
        source_stage_ids: mergeCandidates.map((candidate) => candidate.id),
        target_name: mergedName
      }),
    onSuccess: (merged) => {
      setPendingOp(null);
      onSelect(merged.id);
      onChanged();
    }
  });

  const autoWireMutation = useMutation({
    mutationFn: () => adminService.autoWireStage(stage.id),
    onSuccess: () => {
      onChanged();
      notify.success(t("autoWired"));
    },
    onError: (error) =>
      notify.apiError(error, { title: t("autoWireError") })
  });

  const activateAndGenerateMutation = useMutation({
    mutationFn: (force?: boolean) =>
      adminService.activateAndGenerateStage(stage.id, force ? { force: true } : undefined),
    onSuccess: () => {
      setPendingOp(null);
      onChanged();
    },
    onError: (error, force) => {
      // The server refuses while an upstream stage is unfinished; that refusal
      // is the prompt for the force confirmation, not an error toast.
      const detail =
        error && typeof error === "object" && "detail" in error ? error.detail : null;
      const upstreamPending =
        typeof detail === "object" &&
        detail !== null &&
        "code" in detail &&
        typeof detail.code === "string" &&
        detail.code === "upstream_stages_not_completed";
      if (upstreamPending && !force) {
        setPendingOp({ kind: "force-activate" });
        return;
      }
      setPendingOp(null);
      notify.apiError(error, { title: t("activateError") });
    }
  });

  const seedMutation = useMutation({
    mutationFn: () =>
      adminService.seedTeams(stage.id, {
        team_ids: teams.map((team) => team.id),
        mode: "snake_sr"
      }),
    onSuccess: () => {
      setPendingOp(null);
      onChanged();
    },
    onError: (error) => notify.apiError(error, { title: t("seedError") })
  });

  const deleteItemMutation = useMutation({
    mutationFn: (stageItemId: number) => adminService.deleteStageItem(stageItemId),
    onSuccess: () => {
      setPendingOp(null);
      onChanged();
    },
    onError: (error) => notify.apiError(error, { title: t("deleteItemError") })
  });

  const removeInputMutation = useMutation({
    mutationFn: (inputId: number) => adminService.deleteStageItemInput(inputId),
    onSuccess: () => {
      setPendingOp(null);
      onChanged();
    },
    onError: (error) => notify.apiError(error, { title: t("removeSlotError") })
  });

  const isBracket = BRACKET_STAGE_TYPES.includes(stage.stage_type);
  // A lobby is seated the same way a group is filled: teams into the stage's
  // items. Only a bracket takes its slots from a preceding stage instead.
  const canSeed = !isBracket && teams.length > 0 && stage.items.length > 0;
  const canDeactivate = (stage.is_active || stage.is_published) && !stage.is_completed;

  const intent = pendingOp
    ? INTENTS(intentT, intentRootT)[pendingOp.kind](stage, pendingOp, {
        teamCount: teams.length,
        mergedName,
        mergeCandidates
      })
    : NEUTRAL_INTENT;

  const pendingByOp: Record<PendingOp["kind"], boolean> = {
    "delete-stage": deleteMutation.isPending,
    "delete-item": deleteItemMutation.isPending,
    "remove-input": removeInputMutation.isPending,
    seed: seedMutation.isPending,
    merge: mergeMutation.isPending,
    "force-activate": activateAndGenerateMutation.isPending,
    deactivate: deactivateMutation.isPending,
    regenerate: generateMutation.isPending
  };
  const opPending = pendingOp ? pendingByOp[pendingOp.kind] : false;

  const runPendingOp = () => {
    if (!pendingOp) return;
    if (pendingOp.kind === "delete-stage") deleteMutation.mutate();
    else if (pendingOp.kind === "delete-item") deleteItemMutation.mutate(pendingOp.item.id);
    else if (pendingOp.kind === "remove-input") removeInputMutation.mutate(pendingOp.inputId);
    else if (pendingOp.kind === "seed") seedMutation.mutate();
    else if (pendingOp.kind === "merge") mergeMutation.mutate();
    else if (pendingOp.kind === "force-activate") activateAndGenerateMutation.mutate(true);
    else if (pendingOp.kind === "deactivate") deactivateMutation.mutate();
    else generateMutation.mutate();
  };

  const tabs: LinkTabItem[] = BRACKET_SECTIONS.map((key) => ({
    key,
    label: t(BRACKET_SECTION_MESSAGE_KEYS[key]),
    href: sectionHref(key),
    badge: key === "items" ? stage.items.length || undefined : undefined,
    hidden: !sectionAllowed[key]
  }));

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <EntityHubHeader
          level={2}
          title={stage.name}
          status={{
            label: tr(`extra.statuses.${getStageStatus(stage, hasEncounters).toLowerCase()}`),
            tone: getStageStatusTone(stage, hasEncounters)
          }}
          meta={[
            tRoot(`labels.types.${stage.stage_type}`),
            <span key="slots" className="tabular-nums">
              {tRoot("extra.slotsSummary", { assigned: projection.assigned, total: projection.slots })}
            </span>,
            hasEncounters ? (
              <span key="matches" className="tabular-nums">
                {tRoot("extra.matchesSummary", { completed: progress?.completed ?? 0, total: progress?.total ?? 0 })}
              </span>
            ) : null,
            // Captain visibility used to sit in the General form under a second
            // "Status" label, beside a second status badge. It is a fact about
            // the stage, so it lives with the other facts up here.
            stage.is_published ? t("published") : t("notVisible"),
            stage.challonge_slug ? (
              <a
                key="challonge"
                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                href={`https://challonge.com/${stage.challonge_slug}`}
                target="_blank"
                rel="noreferrer"
              >
                <Link2 className="size-3" aria-hidden />
                {tRoot("extra.challonge")}
              </a>
            ) : null
          ]}
          actions={
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={generateMutation.isPending}
                onClick={() => {
                  if (hasEncounters) setPendingOp({ kind: "regenerate" });
                  else generateMutation.mutate();
                }}
                title={t("generateTitle")}
              >
                {generateMutation.isPending ? (
                  <Spinner />
                ) : (
                  <Wand2 className="size-4" aria-hidden />
                )}
                {hasEncounters ? t("regenerate") : t("generate")}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={t("actions", { name: stage.name })}>
                    <MoreHorizontal className="size-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {stage.is_active ? null : (
                    <DropdownMenuItem
                      disabled={activateMutation.isPending}
                      onSelect={() => activateMutation.mutate()}
                    >
                      <PlayCircle className="size-4" aria-hidden />
                      {t("activate")}
                    </DropdownMenuItem>
                  )}
                  {isBracket ? (
                    <DropdownMenuItem
                      disabled={activateAndGenerateMutation.isPending}
                      onSelect={() => activateAndGenerateMutation.mutate(undefined)}
                    >
                      <Zap className="size-4" aria-hidden />
                      {t("activateGenerate")}
                    </DropdownMenuItem>
                  ) : null}
                  {isBracket ? (
                    <DropdownMenuItem
                      disabled={autoWireMutation.isPending}
                      onSelect={() => autoWireMutation.mutate()}
                    >
                      <Workflow className="size-4" aria-hidden />
                      {t("autoWire")}
                    </DropdownMenuItem>
                  ) : null}
                  {canSeed ? (
                    <DropdownMenuItem onSelect={() => setPendingOp({ kind: "seed" })}>
                      <Shuffle className="size-4" aria-hidden />
                      {t("seed")}
                    </DropdownMenuItem>
                  ) : null}
                  {mergeCandidates.length > 0 ? (
                    <DropdownMenuItem onSelect={() => setPendingOp({ kind: "merge" })}>
                      <GitMerge className="size-4" aria-hidden />
                      {t("merge")}
                    </DropdownMenuItem>
                  ) : null}
                  {canDeactivate ? (
                    <DropdownMenuItem onSelect={() => setPendingOp({ kind: "deactivate" })}>
                      <Undo2 className="size-4" aria-hidden />
                      {t("revert")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    className="text-danger focus:text-danger"
                    onSelect={() => setPendingOp({ kind: "delete-stage" })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      </div>

      <div className="border-b border-border px-4 py-2">
        <LinkTabs
          items={tabs}
          activeKey={activeSection}
          level={2}
          ariaLabel={t("sections", { name: stage.name })}
        />
      </div>

      <div className="p-4">
        {activeSection === "general" ? (
          <GeneralSection
            stage={stage}
            form={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            isSuperuser={isSuperuser}
            projection={projection}
            teams={teams}
          />
        ) : null}

        {activeSection === "seeding" ? (
          <SeedingSection
            stage={stage}
            stages={stages}
            form={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            onChanged={onChanged}
          />
        ) : null}

        {activeSection === "ffa-scoring" ? (
          <FfaScoringSection
            form={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            saveError={saveError}
          />
        ) : null}

        {activeSection === "tiebreakers" ? (
          <TiebreakersSection
            stage={stage}
            form={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            winPointsDefault={tournament?.win_points ?? 1}
            drawPointsDefault={tournament?.draw_points ?? 0.5}
            lossPointsDefault={tournament?.loss_points ?? 0}
          />
        ) : null}

        {activeSection === "best-of" ? (
          <BestOfSection
            stage={stage}
            form={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            bracketTeamCount={projection.bracketTeams.count}
            lowerBracketTeamCount={projection.lowerBracketTeamCount}
            plannedRounds={plannedRounds}
            onApplyToExisting={() => applyBestOfMutation.mutate()}
            applying={applyBestOfMutation.isPending}
          />
        ) : null}

        {activeSection === "schedule" ? (
          <RoundScheduleSection
            stage={stage}
            bracketTeamCount={projection.bracketTeams.count}
            lowerBracketTeamCount={projection.lowerBracketTeamCount}
            plannedRounds={plannedRounds}
            onChanged={onChanged}
          />
        ) : null}

        {activeSection === "layout" ? <BracketLayoutSection stage={stage} /> : null}

        {activeSection === "standings" ? (
          <MatchesView tournamentId={stage.tournament_id}>
            {({ workspaceId }) => (
              <StandingsBrowser
                tournamentId={stage.tournament_id}
                workspaceId={workspaceId}
                stageId={stage.id}
              />
            )}
          </MatchesView>
        ) : null}

        {activeSection === "items" ? (
          <StageItemsSection
            stage={stage}
            stages={stages}
            teams={teams}
            isTeamsLoading={isTeamsLoading}
            progress={progress}
            encountersHref={encountersHref}
            onChanged={onChanged}
            onRequestDeleteItem={(item) => setPendingOp({ kind: "delete-item", item })}
            onRequestRemoveInput={(input, label) =>
              setPendingOp({ kind: "remove-input", inputId: input.id, label })
            }
          />
        ) : null}

        <SaveBar
          dirty={changes.length > 0}
          summary={
            <Fragment>
              {t("unsaved")} <span className="text-foreground">{changes.map((key) => tr(`changes.${key}`)).join(", ")}</span>
            </Fragment>
          }
          onDiscard={() => setForm(stageFormFromStage(stage))}
          onSave={() => updateMutation.mutate()}
          saving={updateMutation.isPending}
          // The five sections above are `?section=` links of THIS form, so the
          // anchor guard would demand a discard just to look at another one.
          // The stage list beside it is buttons, which the guard never saw.
          guardNavigation={false}
        />
      </div>

      <ConfirmDialog
        open={pendingOp !== null}
        onOpenChange={(open) => {
          if (!open) setPendingOp(null);
        }}
        intent={intent}
        onConfirm={runPendingOp}
        pending={opPending}
      />
    </div>
  );
}

const NEUTRAL_INTENT: ConfirmIntent = {
  title: "",
  description: "",
  confirmLabel: "",
  tone: "neutral"
};

/**
 * The seven confirmations of the old screen, as intents of one dialog. The
 * copy is carried over verbatim: it is the only place that explains what each
 * operation does to already-generated matches.
 */
const INTENTS = (t: (key: string, values?: Record<string, unknown>) => string, tRoot: (key: string, values?: Record<string, unknown>) => string): Record<
  PendingOp["kind"],
  (
    stage: Stage,
    op: PendingOp,
    context: { teamCount: number; mergedName: string; mergeCandidates: Stage[] }
  ) => ConfirmIntent
> => ({
  "delete-stage": (stage) => ({
    title: t("deleteStageTitle"),
    description: t("deleteStageDescription", { name: stage.name }),
    confirmLabel: t("deleteStageConfirm"),
    tone: "danger",
    cascade: [tRoot("extra.cascadeStageItems"), tRoot("extra.cascadeTeamSlots"), tRoot("extra.cascadeMatches")]
  }),
  "delete-item": (_stage, op) => {
    const item = op.kind === "delete-item" ? op.item : null;
    return {
      title: t("deleteItemTitle"),
      description: t("deleteItemDescription", { name: item?.name ?? "" }),
      confirmLabel: t("deleteItemConfirm"),
      tone: "danger",
      cascade: [
        tRoot("extra.cascadeTeamSlots"),
        tRoot("extra.cascadeItemMatches"),
        tRoot("extra.cascadeItemStandings")
      ]
    };
  },
  "remove-input": (_stage, op) => ({
    title: t("removeSlotTitle"),
    description: t("removeSlotDescription", { label: op.kind === "remove-input" ? op.label : t("slot") }),
    confirmLabel: t("removeSlotConfirm"),
    tone: "danger",
    cascade: [tRoot("extra.cascadeSeedSlot"), tRoot("extra.cascadeBracketPlace")]
  }),
  seed: (stage, _op, { teamCount }) => ({
    title: t("reseedTitle"),
    description: t("reseedDescription", { teams: teamCount, groups: stage.items.length, name: stage.name }),
    confirmLabel: t("reseedConfirm"),
    tone: "warning",
    cascade: [tRoot("extra.cascadeManualAssignments")]
  }),
  merge: (_stage, _op, { mergedName, mergeCandidates }) => ({
    title: t("mergeTitle"),
    description: t("mergeDescription", { count: mergeCandidates.length, name: mergedName }),
    confirmLabel: t("mergeConfirm"),
    tone: "warning",
    cascade: mergeCandidates.map((candidate) => tRoot("extra.cascadeStage", { name: candidate.name }))
  }),
  "force-activate": (stage) => ({
    title: t("forceActivateTitle"),
    description: t("forceActivateDescription", { name: stage.name }),
    confirmLabel: t("forceActivateConfirm"),
    tone: "warning"
  }),
  deactivate: (stage) => ({
    title: t("revertTitle"),
    description: t("revertDescription", { name: stage.name }),
    confirmLabel: t("revertConfirm"),
    tone: "warning"
  }),
  regenerate: (stage) => ({
    title: t("regenerateTitle"),
    description: t("regenerateDescription", { name: stage.name }),
    confirmLabel: t("regenerateConfirm"),
    tone: "warning"
  })
});
