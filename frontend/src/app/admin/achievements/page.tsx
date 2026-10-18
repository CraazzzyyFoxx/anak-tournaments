"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Download,
  LibraryBig,
  Play,
  Plus,
  RotateCcw,
  Sprout,
  Upload,
  UserPlus,
} from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EvaluationRunSummary } from "@/components/admin/achievements/EvaluationRunSummary";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { AchievementRule } from "@/types/admin.types";

import { AchievementFormDialog } from "./_components/AchievementFormDialog";
import { AchievementLibraryDialog } from "./_components/AchievementLibraryDialog";
import { AchievementOverrideDialog, type OverrideDraftState } from "./_components/AchievementOverrideDialog";
import { AchievementOverridesCard } from "./_components/AchievementOverridesCard";
import { AchievementsTable } from "./_components/AchievementsTable";
import { DryRunResultDialog } from "./_components/DryRunResultDialog";
import { EvaluateAchievementsDialog } from "./_components/EvaluateAchievementsDialog";
import { ImportErrorPanel, ImportResultPanel } from "./_components/ImportOutcomePanels";
import { DisciplineSelect } from "./_components/DisciplineSelect";
import { useAchievementCatalog } from "./_hooks/useAchievementCatalog";
import { useAchievementRuleActions } from "./_hooks/useAchievementRuleActions";
import { useAchievementRuleForm } from "./_hooks/useAchievementRuleForm";
import { useAchievementDiscipline } from "./_hooks/useAchievementDiscipline";

const emptyOverrideDraft: OverrideDraftState = { userName: "", action: "grant", reason: "" };

export default function AchievementsPage() {
  const t = useTranslations("adminAchievements");
  const router = useRouter();
  const { canAccessPermission } = usePermissions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { discipline, disciplines, select } = useAchievementDiscipline();

  const [deletingRule, setDeletingRule] = useState<AchievementRule | null>(null);
  const [hardResetOpen, setHardResetOpen] = useState(false);
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);

  const [evaluateDialogOpen, setEvaluateDialogOpen] = useState(false);
  const [evalTournamentId, setEvalTournamentId] = useState<number | undefined>(undefined);
  const [evalSelectedRuleIds, setEvalSelectedRuleIds] = useState<Set<number>>(new Set());

  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState<OverrideDraftState>(emptyOverrideDraft);
  const [overrideFormError, setOverrideFormError] = useState<string | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const canCreate = canAccessPermission("achievement.create", workspaceId);
  const canUpdate = canAccessPermission("achievement.update", workspaceId);
  const canDelete = canAccessPermission("achievement.delete", workspaceId);

  const { tournaments, overrides, refetchOverrides, allRules } = useAchievementCatalog({
    workspaceId,
    discipline,
    pickersOpen: evaluateDialogOpen || overrideDialogOpen,
  });
  // Evaluating and overriding name a tournament: only the selected game's can be one.
  const tournamentOptions = (tournaments?.results ?? []).filter((tournament) => tournament.discipline === discipline);

  const form = useAchievementRuleForm(workspaceId, discipline);

  const actions = useAchievementRuleActions({
    workspaceId,
    discipline,
    jsonInputRef,
    onDeleted: () => setDeletingRule(null),
    onEvaluated: () => setEvaluateDialogOpen(false),
    onOverrideSaved: () => {
      refetchOverrides();
      setOverrideDialogOpen(false);
      setOverrideDraft((prev) => ({ ...emptyOverrideDraft, action: prev.action }));
      setOverrideFormError(null);
    },
    onOverrideRemoved: () => refetchOverrides(),
  });

  // Validated on submit rather than by disabling the button, so the reader can
  // read what is missing instead of guessing why nothing happens.
  const handleOverrideSubmit = () => {
    const missingLabels = [
      !overrideDraft.userId ? t("list.missingUser") : null,
      !overrideDraft.ruleId ? t("list.missingAchievement") : null,
      !overrideDraft.reason.trim() ? t("list.missingReason") : null,
    ].filter((label): label is string => label !== null);
    if (missingLabels.length > 0) {
      setOverrideFormError(t("list.pickBeforeOverride", { items: missingLabels.join(", ") }));
      return;
    }
    setOverrideFormError(null);
    actions.overrideMutation.mutate({
      achievement_rule_id: overrideDraft.ruleId!,
      user_id: overrideDraft.userId!,
      tournament_id: overrideDraft.tournamentId ?? null,
      action: overrideDraft.action,
      reason: overrideDraft.reason,
    });
  };

  if (!workspaceId || !discipline) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title={t("common.achievements")}
          description={t("list.headerDescription")}
        />
        <EmptyNote>
          {workspaceId ? t("discipline.none") : t("list.selectWorkspace")}
        </EmptyNote>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t("common.achievements")}
        description={t("list.headerDescription")}
        actions={
          <div className="flex gap-2">
            <DisciplineSelect
              value={discipline}
              disciplines={disciplines}
              onChange={select}
              disabled={form.open}
            />
            <input
              ref={jsonInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void actions.importRulesFromFile(file);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => void actions.exportRules()}>
              <Download className="mr-2 h-4 w-4" aria-hidden />
              {t("list.exportJson")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLibraryDialogOpen(true)}>
              <LibraryBig className="mr-2 h-4 w-4" aria-hidden />
              {t("list.browseLibrary")}
            </Button>
            {(canCreate || canUpdate) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => jsonInputRef.current?.click()}
                disabled={actions.importMutation.isPending}
              >
                <Upload className={`mr-2 h-4 w-4 ${actions.importMutation.isPending ? "animate-spin" : ""}`} aria-hidden />
              {t("list.importJson")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEvalSelectedRuleIds(new Set());
                setEvalTournamentId(undefined);
                setEvaluateDialogOpen(true);
              }}
            >
              <Play className="mr-2 h-4 w-4" aria-hidden />
              {t("list.evaluate")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                actions.overrideMutation.reset();
                setOverrideFormError(null);
                setOverrideDialogOpen(true);
              }}
            >
              <UserPlus className="mr-2 h-4 w-4" aria-hidden />
              {t("list.addOverride")}
            </Button>
            {canCreate && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => actions.seedMutation.mutate()}
                disabled={actions.seedMutation.isPending}
              >
                <Sprout className={`mr-2 h-4 w-4 ${actions.seedMutation.isPending ? "animate-spin" : ""}`} aria-hidden />
                {t("list.seedDefaults")}
              </Button>
            )}
            {canCreate && (
              <Button
                variant="destructive"
                onClick={() => setHardResetOpen(true)}
                disabled={actions.hardResetMutation.isPending}
              >
                <RotateCcw className={`mr-2 h-4 w-4 ${actions.hardResetMutation.isPending ? "animate-spin" : ""}`} aria-hidden />
                {t("list.hardReset")}
              </Button>
            )}
            {canCreate && (
              <Button onClick={form.openCreate}>
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {t("list.create")}
              </Button>
            )}
          </div>
        }
      />

      {actions.evaluationResult && (
        <EvaluationRunSummary
          run={actions.evaluationResult}
          onDismiss={actions.dismissEvaluationResult}
          tournamentName={
            tournaments?.results.find(
              (tournament) => tournament.id === actions.evaluationResult?.tournament_id,
            )?.name
          }
        />
      )}

      {actions.importError && (
        <ImportErrorPanel message={actions.importError} onDismiss={actions.dismissImportError} />
      )}

      {actions.importResult && (
        <ImportResultPanel result={actions.importResult} onDismiss={actions.dismissImportResult} />
      )}

      <AchievementsTable
        workspaceId={workspaceId}
        discipline={discipline}
        actions={{
          canUpdate,
          canDelete,
          onOpen: (rule) => router.push(`/admin/achievements/${rule.id}`),
          onEdit: form.openEdit,
          onTest: (rule) => actions.testMutation.mutate(rule.id),
          onEvaluate: (rule) => {
            setEvalSelectedRuleIds(new Set([rule.id]));
            setEvalTournamentId(undefined);
            setEvaluateDialogOpen(true);
          },
          onToggle: (rule) => actions.toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled }),
          onDelete: setDeletingRule,
        }}
      />

      {overrides && overrides.length > 0 && (
        <AchievementOverridesCard
          overrides={overrides}
          rules={allRules}
          onDelete={(id) => actions.deleteOverrideMutation.mutate(id)}
          isDeleting={actions.deleteOverrideMutation.isPending}
        />
      )}

      <AchievementLibraryDialog
        key={discipline}
        open={libraryDialogOpen}
        onOpenChange={setLibraryDialogOpen}
        workspaceId={workspaceId}
        discipline={discipline}
        canImport={canCreate || canUpdate}
        onImported={actions.setImportResult}
      />

      <EvaluateAchievementsDialog
        open={evaluateDialogOpen}
        onOpenChange={setEvaluateDialogOpen}
        tournaments={tournamentOptions}
        rules={allRules ?? []}
        tournamentId={evalTournamentId}
        onTournamentChange={setEvalTournamentId}
        selectedRuleIds={evalSelectedRuleIds}
        onSelectedRuleIdsChange={setEvalSelectedRuleIds}
        onRun={() => actions.evaluate(evalTournamentId, evalSelectedRuleIds)}
        isRunning={actions.evaluateMutation.isPending}
      />

      <AchievementOverrideDialog
        open={overrideDialogOpen}
        onOpenChange={setOverrideDialogOpen}
        rules={allRules ?? []}
        tournaments={tournamentOptions}
        draft={overrideDraft}
        onDraftChange={setOverrideDraft}
        onSubmit={handleOverrideSubmit}
        isSaving={actions.overrideMutation.isPending}
        formError={overrideFormError}
        saveError={
          actions.overrideMutation.error instanceof Error
            ? actions.overrideMutation.error.message
            : undefined
        }
      />

      <AchievementFormDialog form={form} />

      {canDelete && deletingRule && (
        <ConfirmDialog
          open={!!deletingRule}
          onOpenChange={(open) => !open && setDeletingRule(null)}
          onConfirm={() => actions.deleteMutation.mutate(deletingRule.id)}
          pending={actions.deleteMutation.isPending}
          intent={{
            title: t("list.deleteAchievement"),
            description: t("list.deleteDescription", { name: deletingRule.name, slug: deletingRule.slug }),
            confirmLabel: actions.deleteMutation.isPending ? t("common.deleting") : t("common.delete"),
            tone: "danger",
            cascade: [
              t("list.deleteCascadeResult"),
              t("list.deleteCascadeOverride"),
            ],
          }}
        />
      )}

      {canCreate && (
        <ConfirmDialog
          open={hardResetOpen}
          onOpenChange={setHardResetOpen}
          onConfirm={() => {
            setHardResetOpen(false);
            actions.hardResetMutation.mutate();
          }}
          pending={actions.hardResetMutation.isPending}
          intent={{
            title: t("list.resetTitle"),
            description: t("list.resetDescription"),
            confirmLabel: actions.hardResetMutation.isPending ? t("common.saving") : t("list.hardReset"),
            tone: "danger",
            cascade: [t("list.resetCascade")],
          }}
        />
      )}

      <DryRunResultDialog result={actions.testResult} onDismiss={actions.dismissTestResult} />
    </div>
  );
}
