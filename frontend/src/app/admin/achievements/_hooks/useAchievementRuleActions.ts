"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import adminService from "@/services/admin.service";
import { achievementQueryKeys } from "@/lib/achievements/query-keys";
import { ALL_DISCIPLINES } from "@/lib/site/discipline-scope";
import type {
  AchievementRule,
  AchievementRuleExportEnvelope,
  AchievementRuleImportResult,
  EvaluationRunRead,
} from "@/types/admin.types";

import { portableFileProblem } from "../achievement-import";

/**
 * The workspace and game an action was started for. It travels in the mutation's
 * variables because TanStack hands a pending mutation the *latest* render's
 * callbacks: a callback that read the current game would invalidate whichever
 * game is selected when the request finishes, not the one it changed.
 */
interface RuleScope {
  workspaceId: number;
  discipline: string;
}

export interface DryRunResult {
  slug: string;
  count: number;
  sample: number[][];
}

/**
 * Everything the achievements screen *does* to the catalog of the selected game:
 * seeding, resetting, JSON import/export, evaluation runs, dry runs,
 * enable/disable, deletion and removing manual overrides.
 *
 * Every call names `discipline` — two games share the workspace, so "seed" or
 * "reset" without a game would be a different, much larger operation. A file
 * import is the exception that proves it: the portable file names each rule's
 * game itself, so its result stales every game's list.
 *
 * The outcomes each action leaves on screen (the run summary, the import
 * report, the dry-run sample) are held here too — they are mutation results,
 * not page state, and nothing else decides when they appear.
 */
export function useAchievementRuleActions({
  workspaceId,
  discipline,
  onDeleted,
  onEvaluated,
}: {
  workspaceId: number | null;
  /** The game the per-game actions run in; `null` under all games (they wait for one) or with none enabled. */
  discipline: string | null;
  onDeleted: () => void;
  onEvaluated: () => void;
}) {
  const t = useTranslations("adminAchievements");
  const queryClient = useQueryClient();

  const [evaluationResult, setEvaluationResult] = useState<EvaluationRunRead | null>(null);
  const [importResult, setImportResult] = useState<AchievementRuleImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<DryRunResult | null>(null);

  /** The scope of what the user is looking at right now; call it when the action starts, never later. */
  const currentScope = (): RuleScope => ({ workspaceId: workspaceId!, discipline: discipline! });

  /** The game's list and the all-games list both show the rule. */
  const invalidateRules = (scope: RuleScope) => {
    queryClient.invalidateQueries({
      queryKey: achievementQueryKeys.adminList(scope.workspaceId, scope.discipline),
    });
    queryClient.invalidateQueries({ queryKey: achievementQueryKeys.adminList(scope.workspaceId, ALL_DISCIPLINES) });
    queryClient.invalidateQueries({ queryKey: achievementQueryKeys.publicLists() });
  };
  const invalidateOverrides = (scope: RuleScope) =>
    queryClient.invalidateQueries({
      queryKey: achievementQueryKeys.overridesAll(scope.workspaceId, scope.discipline),
    });

  const deleteMutation = useMutation({
    mutationFn: ({ scope, id }: { scope: RuleScope; id: number }) =>
      adminService.deleteAchievementRule(scope.workspaceId, id),
    onSuccess: (_data, { scope }) => {
      invalidateRules(scope);
      onDeleted();
    },
  });

  const seedMutation = useMutation({
    mutationFn: (scope: RuleScope) => adminService.seedAchievementRules(scope.workspaceId, scope.discipline),
    onSuccess: (_data, scope) => invalidateRules(scope),
  });

  const hardResetMutation = useMutation({
    mutationFn: (scope: RuleScope) => adminService.hardResetAchievementRules(scope.workspaceId, scope.discipline),
    onSuccess: (data, scope) => {
      invalidateRules(scope);
      invalidateOverrides(scope);
      setEvaluationResult(data.run);
    },
  });

  const importMutation = useMutation({
    mutationFn: (data: AchievementRuleExportEnvelope) => adminService.importAchievementRules(workspaceId!, data),
    onSuccess: (data) => {
      // The file names its own games, so every game's list may have moved.
      queryClient.invalidateQueries({ queryKey: achievementQueryKeys.adminListsOf(workspaceId) });
      queryClient.invalidateQueries({ queryKey: achievementQueryKeys.publicLists() });
      setImportError(null);
      setImportResult(data);
    },
    onError: (error) => {
      // The server refused the whole file (unsupported format, a missing or foreign
      // character, a disabled game): say so, and report no success.
      setImportResult(null);
      setImportError(error instanceof Error ? error.message : t("list.importFailed"));
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: ({ scope, params }: { scope: RuleScope; params: { tournament_id?: number; rule_ids?: number[] } }) =>
      adminService.evaluateAchievements(scope.workspaceId, scope.discipline, params),
    onSuccess: (data) => {
      setEvaluationResult(data);
      onEvaluated();
    },
  });

  const testMutation = useMutation({
    mutationFn: (ruleId: number) => adminService.testAchievementRule(workspaceId!, ruleId),
    onSuccess: (data) =>
      setTestResult({ slug: data.rule_slug, count: data.qualifying_count, sample: data.sample }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ scope, id, enabled }: { scope: RuleScope; id: number; enabled: boolean }) =>
      adminService.updateAchievementRule(scope.workspaceId, id, { enabled }),
    onSuccess: (_data, { scope }) => invalidateRules(scope),
  });

  const deleteOverrideMutation = useMutation({
    mutationFn: ({ scope, id }: { scope: RuleScope; id: number }) =>
      adminService.deleteAchievementOverride(scope.workspaceId, id),
    onSuccess: (_data, { scope }) => invalidateOverrides(scope),
  });

  /** Streams the selected game's rules to the browser as the v2 JSON the importer reads back. */
  const exportRules = async () => {
    const { blob, filename } = await adminService.exportAchievementRules(workspaceId!, discipline!);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  /**
   * Parses a picked export file and imports it. A parse failure — or a file that
   * is not portable v2 — is reported rather than thrown, and never reaches the
   * server as a success: the likely cause is the wrong or an old file, and the
   * admin needs to be told which one they picked.
   */
  const importRulesFromFile = async (file: File) => {
    setImportError(null);
    setImportResult(null);
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setImportError(t("list.invalidJson", { name: file.name }));
      return;
    }
    const problem = portableFileProblem(parsed);
    if (problem) {
      setImportError(
        problem.kind === "version"
          ? t("list.importUnsupportedVersion", { name: file.name, version: String(problem.version ?? "—") })
          : problem.kind === "hero_id"
            ? t("list.importLegacyHero", { name: file.name, slug: problem.slug })
            : t("list.importNotPortable", { name: file.name })
      );
      return;
    }
    // portableFileProblem proved the envelope; the server validates every rule in it.
    importMutation.mutate(parsed as AchievementRuleExportEnvelope);
  };

  const evaluate = (tournamentId: number | undefined, ruleIds: Set<number>) =>
    evaluateMutation.mutate({
      scope: currentScope(),
      params: { tournament_id: tournamentId, rule_ids: ruleIds.size > 0 ? Array.from(ruleIds) : undefined },
    });

  return {
    evaluationResult,
    dismissEvaluationResult: () => setEvaluationResult(null),
    importResult,
    dismissImportResult: () => setImportResult(null),
    /** The import dialog's workspace copy runs through its own mutation and reports back here. */
    setImportResult,
    importError,
    dismissImportError: () => setImportError(null),
    testResult,
    dismissTestResult: () => setTestResult(null),
    deleteMutation,
    seedMutation,
    hardResetMutation,
    importMutation,
    evaluateMutation,
    testMutation,
    toggleMutation,
    deleteOverrideMutation,
    /** Each starts for the game selected now and finishes against that game, whatever is selected then. */
    seed: () => seedMutation.mutate(currentScope()),
    hardReset: () => hardResetMutation.mutate(currentScope()),
    /** A rule acts in its own game, whatever the page shows (every game, or another one). */
    toggle: (rule: AchievementRule, enabled: boolean) =>
      toggleMutation.mutate({ scope: { workspaceId: workspaceId!, discipline: rule.discipline }, id: rule.id, enabled }),
    remove: (rule: AchievementRule) =>
      deleteMutation.mutate({ scope: { workspaceId: workspaceId!, discipline: rule.discipline }, id: rule.id }),
    removeOverride: (id: number) => deleteOverrideMutation.mutate({ scope: currentScope(), id }),
    exportRules,
    importRulesFromFile,
    evaluate,
  };
}
