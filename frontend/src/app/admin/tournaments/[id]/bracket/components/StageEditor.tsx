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
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
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
import type { Stage, Tournament } from "@/types/tournament.types";
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
import { BestOfSection } from "./stage-settings/BestOfSection";
import { GeneralSection } from "./stage-settings/GeneralSection";
import { SeedingSection } from "./stage-settings/SeedingSection";
import { TiebreakersSection } from "./stage-settings/TiebreakersSection";
import { tabFallback } from "../../hubQueries";
import { useStageOperations } from "./stage-editor/useStageOperations";
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

const BRACKET_SECTIONS = [
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
  const tr = (key: string, values?: Record<string, unknown>) => tRoot(key as never, values as never);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<StageForm>(() => stageFormFromStage(stage));
  // The last refusal of a save. The FFA rules are the one part of this form the
  // server rejects by position inside a field, and a toast cannot point at one.
  const [saveError, setSaveError] = useState<unknown>(null);

  const hasEncounters = (progress?.total ?? 0) > 0;
  const stageStatus = getStageStatus(stage, hasEncounters);
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
  const {
    pendingOp,
    setPendingOp,
    intent,
    opPending,
    runPendingOp,
    activateMutation,
    generateMutation,
    applyBestOfMutation,
    autoWireMutation,
    activateAndGenerateMutation
  } = useStageOperations({ stage, teams, mergeCandidates, mergedName, onChanged, onSelect });

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

  const isBracket = BRACKET_STAGE_TYPES.includes(stage.stage_type);
  // A lobby is seated the same way a group is filled: teams into the stage's
  // items. Only a bracket takes its slots from a preceding stage instead.
  const canSeed = !isBracket && teams.length > 0 && stage.items.length > 0;
  const canDeactivate = (stage.is_active || stage.is_published) && !stage.is_completed;

  const tabs: LinkTabItem[] = BRACKET_SECTIONS.map((key) => ({
    key,
    label: t(BRACKET_SECTION_MESSAGE_KEYS[key]),
    href: sectionHref(key),
    badge: key === "items" ? stage.items.length || undefined : undefined,
    hidden: !sectionAllowed[key]
  }));

  return (
    <div className="min-w-0">
      <div className="border-b border-border pb-3">
        <EntityHubHeader
          level={2}
          title={stage.name}
          // A pill only while captains play (or are about to): draft and
          // completed are the default ends of every stage.
          status={
            stageStatus === "Active" || stageStatus === "Preview"
              ? {
                  label: tr(`extra.statuses.${stageStatus.toLowerCase()}`),
                  tone: getStageStatusTone(stage, hasEncounters)
                }
              : undefined
          }
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

      <div className="border-b border-border py-2">
        <LinkTabs
          items={tabs}
          activeKey={activeSection}
          level={2}
          ariaLabel={t("sections", { name: stage.name })}
        />
      </div>

      <div className="pt-4">
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
