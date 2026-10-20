"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { BracketTemplateEditor } from "@/components/bracket/editor/BracketTemplateEditor";
import {
  draftFromTemplate,
  draftReducer,
  draftToTemplate,
  type Draft
} from "@/components/bracket/editor/templateDraft";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { EYEBROW_CLASS, TONE_TEXT } from "@/components/kit/tone";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { ApiError, errorBodyFields } from "@/lib/api/error";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { TemplateProblem } from "@/types/admin.types";
import type { Stage } from "@/types/tournament.types";

import { useHubEncountersQuery } from "../../hubQueries";

const EMPTY_DRAFT: Draft = { upper_seeds: 0, lower_seeds: 0, matches: [] };

/**
 * The validator's complaints out of a refused PUT (422).
 *
 * The gateway relays the worker's structured entry — `{code, problems}` — and
 * the parser keeps it in `body.fields` while flattening `details` down to the
 * human text, so both places are read: whichever carries the array wins.
 */
function templateProblems(error: unknown): TemplateProblem[] {
  if (!(error instanceof ApiError)) return [];
  const entries: Record<string, unknown>[] = [
    ...(error.details as unknown as Record<string, unknown>[]),
    ...errorBodyFields(error.body)
  ];
  const entry = entries.find(
    (candidate) => candidate.code === "invalid_bracket_template" && Array.isArray(candidate.problems)
  );
  return (entry?.problems as TemplateProblem[]) ?? [];
}

/**
 * The stage's bracket drawn as a wiring diagram the organizer can edit: every
 * slot is a seed placeholder (`U1`, `L3`) or the winner/loser of another match,
 * saved as the stage's `bracket_template` and used by every generation path.
 *
 * The seed counts in the header are the template's OWN (`upper_seeds`,
 * `lower_seeds`), not the stage's: a layout may be drawn before the groups that
 * fill it exist. When the two disagree the stage refuses to generate, so the
 * disagreement is spelled out rather than silently corrected.
 *
 * Editing is refused once the stage has matches — the same rule as regenerating
 * — so the section then shows only the server's own 409 text.
 */
export function BracketLayoutSection({ stage }: Readonly<{ stage: Stage }>) {
  const t = useTranslations("adminBracket.layoutSection");
  const queryClient = useQueryClient();
  const encountersQuery = useHubEncountersQuery(stage.tournament_id);
  const hasEncounters = (encountersQuery.data?.results ?? []).some(
    (encounter) => encounter.stage_id === stage.id
  );

  const templateQuery = useQuery({
    queryKey: adminQueryKeys.stageBracketTemplate(stage.id),
    queryFn: () => adminService.getStageBracketTemplate(stage.id)
  });

  const [draft, dispatch] = useReducer(draftReducer, EMPTY_DRAFT);
  const [problems, setProblems] = useState<TemplateProblem[]>([]);
  const [highlightMatchId, setHighlightMatchId] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const template = templateQuery.data?.template ?? null;
  // The server's layout is the draft's origin: a fetch that brings a new one
  // (a save, a reset, a seed-count change) starts the draft over. A refetch
  // that brings the SAME one must not — the app refetches on window focus
  // (`providers.tsx`), and that would delete a layout drawn while the
  // organizer was elsewhere. React Query's structural sharing keeps the
  // identity of unchanged data, so the dependency below is already that test;
  // `bracketLayout.behavior.test.tsx` pins it.
  useEffect(() => {
    if (template) dispatch({ type: "reset", draft: draftFromTemplate(template) });
  }, [template]);

  const payload = useMemo(() => draftToTemplate(draft), [draft]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.stageBracketTemplate(stage.id) });
    // Prefixes: both of these keys carry the whole `stage` object as their last
    // part, so only the prefix can match every cached variant.
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.stageBracketPreview(stage.id) });
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.stagePlannedRounds(stage.id) });
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.stages(stage.tournament_id) });
  };

  const saveMutation = useMutation({
    mutationFn: () => adminService.setStageBracketTemplate(stage.id, payload!),
    onSuccess: () => {
      setProblems([]);
      setHighlightMatchId(null);
      invalidate();
      notify.success(t("save"));
    },
    onError: (error) => {
      setProblems(templateProblems(error));
      notify.apiError(error, { title: t("saveError") });
    }
  });

  const resetMutation = useMutation({
    mutationFn: () => adminService.clearStageBracketTemplate(stage.id),
    onSuccess: () => {
      setProblems([]);
      setResetOpen(false);
      invalidate();
      notify.success(t("reset"));
    },
    onError: (error) => notify.apiError(error, { title: t("resetError") })
  });

  const seeds = templateQuery.data?.seeds;
  // `draft.matches` is empty for the one render between the fetch landing and
  // the effect above seeding it; 0+0 seeds would flash the warning.
  const mismatch =
    seeds !== undefined &&
    draft.matches.length > 0 &&
    (seeds.upper !== draft.upper_seeds || seeds.lower !== draft.lower_seeds);

  return (
    <section aria-labelledby="bracket-layout-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="bracket-layout-heading" className="text-sm font-semibold text-foreground">
          {t("title")}
        </h3>
        <p className={EYEBROW_CLASS}>
          {templateQuery.data?.custom ? t("custom") : t("generated")}
        </p>
      </div>

      {hasEncounters ? (
        <p className="text-sm text-muted-foreground">
          {t("hasMatches")}
        </p>
      ) : templateQuery.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : template === null ? (
        <p className="text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              U
              <NumberInput
                integer
                min={2}
                max={512}
                aria-label={t("upper")}
                size="sm"
                className="w-20"
                value={draft.upper_seeds}
                onValueChange={(next) => {
                  if (next != null) dispatch({ type: "setSeeds", upper: next, lower: draft.lower_seeds });
                }}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              L
              <NumberInput
                integer
                min={0}
                max={512}
                aria-label={t("lower")}
                size="sm"
                className="w-20"
                value={draft.lower_seeds}
                onValueChange={(next) => {
                  if (next != null) dispatch({ type: "setSeeds", upper: draft.upper_seeds, lower: next });
                }}
              />
            </label>
            {seeds ? (
              <p className="text-xs text-muted-foreground">
                {t("wired", { upper: seeds.upper, lower: seeds.lower })}
              </p>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {templateQuery.data?.custom ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setResetOpen(true)}
                  disabled={resetMutation.isPending}
                >
                  {t("resetButton")}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={payload === null || saveMutation.isPending}
              >
                {t("saveButton")}
              </Button>
            </div>
          </div>

          {mismatch && seeds ? (
            <p className={cn("text-xs", TONE_TEXT.warning)}>
              {t("mismatch", { count: seeds.upper + seeds.lower })}
            </p>
          ) : null}

          <BracketTemplateEditor
            draft={draft}
            stageType={stage.stage_type}
            dispatch={dispatch}
            highlightMatchId={highlightMatchId}
          />

          {problems.length > 0 ? (
            <ul className="space-y-1" aria-label={t("problems")}>
              {problems.map((problem, index) => (
                <li key={`${problem.code}-${problem.match_id}-${index}`}>
                  <button
                    type="button"
                    className={cn(
                      "text-left text-xs underline-offset-4 hover:underline",
                      TONE_TEXT.danger
                    )}
                    onClick={() => setHighlightMatchId(problem.match_id)}
                  >
                    {problem.match_id === null
                      ? problem.message
                      : `M${problem.match_id}: ${problem.message}`}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        intent={{
          title: t("resetTitle"),
          description:
            t("resetDescription"),
          confirmLabel: t("resetConfirm"),
          tone: "warning"
        }}
        onConfirm={() => resetMutation.mutate()}
        pending={resetMutation.isPending}
      />
    </section>
  );
}
