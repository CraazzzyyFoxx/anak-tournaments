"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import adminService from "@/services/admin.service";
import { achievementQueryKeys } from "@/lib/achievements/query-keys";
import type {
  AchievementOverrideCreateInput,
  AchievementRuleExportEnvelope,
  AchievementRuleImportResult,
  EvaluationRunRead,
} from "@/types/admin.types";

import { portableFileProblem } from "../achievement-import";

export interface DryRunResult {
  slug: string;
  count: number;
  sample: number[][];
}

/**
 * Everything the achievements screen *does* to the catalog of the selected game:
 * seeding, resetting, JSON import/export, evaluation runs, dry runs,
 * enable/disable, deletion and manual overrides.
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
  /**
   * The hidden picker behind "Import JSON". Its value is cleared once a file
   * has been read, or the same file can never be picked twice in a row. It is
   * owned by the page: a ref handed back out of a hook makes everything else
   * the hook returns look ref-shaped to the compiler.
   */
  jsonInputRef,
  onDeleted,
  onEvaluated,
  onOverrideSaved,
  onOverrideRemoved,
}: {
  workspaceId: number | null;
  /** The selected game; `null` when the workspace has none enabled. */
  discipline: string | null;
  jsonInputRef: React.RefObject<HTMLInputElement | null>;
  onDeleted: () => void;
  onEvaluated: () => void;
  onOverrideSaved: () => void;
  onOverrideRemoved: () => void;
}) {
  const t = useTranslations("adminAchievements");
  const queryClient = useQueryClient();

  const [evaluationResult, setEvaluationResult] = useState<EvaluationRunRead | null>(null);
  const [importResult, setImportResult] = useState<AchievementRuleImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<DryRunResult | null>(null);

  const invalidateRules = () => {
    queryClient.invalidateQueries({ queryKey: achievementQueryKeys.adminList(workspaceId, discipline) });
    queryClient.invalidateQueries({ queryKey: achievementQueryKeys.publicLists() });
  };

  const clearFilePicker = () => {
    if (jsonInputRef.current) {
      jsonInputRef.current.value = "";
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteAchievementRule(workspaceId!, id),
    onSuccess: () => {
      invalidateRules();
      onDeleted();
    },
  });

  const seedMutation = useMutation({
    mutationFn: () => adminService.seedAchievementRules(workspaceId!, discipline!),
    onSuccess: invalidateRules,
  });

  const hardResetMutation = useMutation({
    mutationFn: () => adminService.hardResetAchievementRules(workspaceId!, discipline!),
    onSuccess: (data) => {
      invalidateRules();
      queryClient.invalidateQueries({ queryKey: achievementQueryKeys.overridesAll(workspaceId, discipline) });
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
      clearFilePicker();
    },
    onError: (error) => {
      // The server refused the whole file (unsupported format, a missing or foreign
      // character, a disabled game): say so, and report no success.
      setImportResult(null);
      setImportError(error instanceof Error ? error.message : t("list.importFailed"));
      clearFilePicker();
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: (params: { tournament_id?: number; rule_ids?: number[] }) =>
      adminService.evaluateAchievements(workspaceId!, discipline!, params),
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
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      adminService.updateAchievementRule(workspaceId!, id, { enabled }),
    onSuccess: invalidateRules,
  });

  const overrideMutation = useMutation({
    mutationFn: (draft: AchievementOverrideCreateInput) =>
      adminService.createAchievementOverride(workspaceId!, draft),
    onSuccess: onOverrideSaved,
  });

  const deleteOverrideMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteAchievementOverride(workspaceId!, id),
    onSuccess: onOverrideRemoved,
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
      clearFilePicker();
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
      clearFilePicker();
      return;
    }
    // portableFileProblem proved the envelope; the server validates every rule in it.
    importMutation.mutate(parsed as AchievementRuleExportEnvelope);
  };

  const evaluate = (tournamentId: number | undefined, ruleIds: Set<number>) =>
    evaluateMutation.mutate({
      tournament_id: tournamentId,
      rule_ids: ruleIds.size > 0 ? Array.from(ruleIds) : undefined,
    });

  return {
    evaluationResult,
    dismissEvaluationResult: () => setEvaluationResult(null),
    importResult,
    dismissImportResult: () => setImportResult(null),
    /** The library dialog imports through its own mutation and reports back here. */
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
    overrideMutation,
    deleteOverrideMutation,
    exportRules,
    importRulesFromFile,
    evaluate,
  };
}
