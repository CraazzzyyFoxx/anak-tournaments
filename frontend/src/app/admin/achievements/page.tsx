"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MoreHorizontal, Plus } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EvaluationRunSummary } from "@/components/admin/achievements/EvaluationRunSummary";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Spinner } from "@/components/ui/spinner";
import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { AchievementRule } from "@/types/admin.types";

import { AchievementFormDialog } from "./_components/AchievementFormDialog";
import { AchievementImportDialog } from "./_components/AchievementImportDialog";
import { AchievementOverridesCard } from "./_components/AchievementOverridesCard";
import { AchievementsTable } from "./_components/AchievementsTable";
import { DryRunResultPanel } from "./_components/DryRunResultPanel";
import { EvaluateAchievementsDialog } from "./_components/EvaluateAchievementsDialog";
import { useAchievementCatalog } from "./_hooks/useAchievementCatalog";
import { useAchievementDiscipline } from "./_hooks/useAchievementDiscipline";
import { useAchievementRuleActions } from "./_hooks/useAchievementRuleActions";
import { useAchievementRuleForm } from "./_hooks/useAchievementRuleForm";

/** The one confirmation the page can ask for, with its subject. */
type Confirmation = { kind: "delete"; rule: AchievementRule } | { kind: "reset" };

export default function AchievementsPage() {
  const t = useTranslations("adminAchievements");
  const router = useRouter();
  const { canAccessPermission } = usePermissions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const {
    discipline,
    resolved,
    disciplines,
    select,
    isError,
    refetch: refetchDisciplines
  } = useAchievementDiscipline();

  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // One domain dialog at a time; it is mounted only while open.
  const [dialog, setDialog] = useState<"evaluate" | "import" | null>(null);
  const [evalTournamentId, setEvalTournamentId] = useState<number | undefined>(undefined);
  const [evalSelectedRuleIds, setEvalSelectedRuleIds] = useState<Set<number>>(new Set());

  const canCreate = canAccessPermission("achievement.create", workspaceId);
  const canUpdate = canAccessPermission("achievement.update", workspaceId);
  const canDelete = canAccessPermission("achievement.delete", workspaceId);

  const { tournaments, overrides, allRules } = useAchievementCatalog({
    workspaceId,
    discipline,
    pickersOpen: dialog === "evaluate",
  });
  // Evaluating names a tournament: only the selected game's can be one.
  const tournamentOptions = (tournaments?.results ?? []).filter((tournament) => tournament.discipline === discipline);

  // Everything the page holds for one game — picked rules, the tournament, an open dialog — is that game's: when
  // the game (or the workspace) changes, it is dropped rather than carried into the next one.
  const scopeKey = `${workspaceId}:${discipline}`;
  const [heldScopeKey, setHeldScopeKey] = useState(scopeKey);
  if (heldScopeKey !== scopeKey) {
    setHeldScopeKey(scopeKey);
    setConfirmation(null);
    setDialog(null);
    setEvalTournamentId(undefined);
    setEvalSelectedRuleIds(new Set());
  }

  const form = useAchievementRuleForm(workspaceId, discipline);

  const actions = useAchievementRuleActions({
    workspaceId,
    discipline,
    onDeleted: () => setConfirmation(null),
    onEvaluated: () => setDialog(null),
  });

  const openEvaluate = (ruleIds: Set<number>) => {
    setEvalSelectedRuleIds(ruleIds);
    setEvalTournamentId(undefined);
    setDialog("evaluate");
  };

  const closeImport = () => {
    setDialog(null);
    actions.dismissImportResult();
    actions.dismissImportError();
  };

  if (!workspaceId || !discipline) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title={t("common.achievements")} />
        {!workspaceId ? (
          <EmptyNote>{t("list.selectWorkspace")}</EmptyNote>
        ) : resolved?.kind === "invalid" || resolved?.kind === "empty" ? (
          <DisciplineUnavailable resolved={resolved} disciplines={disciplines ?? []} allowsAll={false} onSelect={select} />
        ) : isError ? (
          <PageStateCard state="error" onAction={refetchDisciplines} />
        ) : null}
      </div>
    );
  }

  const busy = actions.seedMutation.isPending || actions.hardResetMutation.isPending;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t("common.achievements")}
        actions={
          <>
            {disciplines && disciplines.length > 1 ? (
              <DisciplineSelector
                disciplines={disciplines}
                value={discipline}
                allowsAll={false}
                onSelect={select}
                disabled={form.open}
              />
            ) : null}
            {canCreate && (
              <Button onClick={form.openCreate}>
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {t("list.create")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("common.moreActions")}
                  title={t("common.moreActions")}
                >
                  {busy ? <Spinner /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openEvaluate(new Set())}>{t("list.evaluate")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void actions.exportRules()}>{t("list.exportJson")}</DropdownMenuItem>
                {(canCreate || canUpdate) && (
                  <DropdownMenuItem onSelect={() => setDialog("import")}>{t("list.import")}</DropdownMenuItem>
                )}
                {canCreate && (
                  <>
                    <DropdownMenuItem onSelect={() => actions.seed()} disabled={busy}>
                      {t("list.seedDefaults")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setConfirmation({ kind: "reset" })}
                      disabled={busy}
                      className="text-danger focus:text-danger"
                    >
                      {t("list.hardReset")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
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

      <AchievementsTable
        workspaceId={workspaceId}
        discipline={discipline}
        actions={{
          canUpdate,
          canDelete,
          onOpen: (rule) => router.push(`/admin/achievements/${rule.id}`),
          onEdit: form.openEdit,
          onTest: (rule) => actions.testMutation.mutate(rule.id),
          onEvaluate: (rule) => openEvaluate(new Set([rule.id])),
          onToggle: (rule) => actions.toggle(rule.id, !rule.enabled),
          onDelete: (rule) => setConfirmation({ kind: "delete", rule }),
        }}
      />

      {actions.testResult && (
        <DryRunResultPanel result={actions.testResult} onDismiss={actions.dismissTestResult} />
      )}

      {overrides && overrides.length > 0 && (
        <AchievementOverridesCard
          overrides={overrides}
          rules={allRules ?? []}
          tournaments={tournamentOptions}
          onDelete={(id) => actions.removeOverride(id)}
          isDeleting={actions.deleteOverrideMutation.isPending}
        />
      )}

      {dialog === "evaluate" && (
        <EvaluateAchievementsDialog
          onClose={() => setDialog(null)}
          tournaments={tournamentOptions}
          rules={allRules ?? []}
          tournamentId={evalTournamentId}
          onTournamentChange={setEvalTournamentId}
          selectedRuleIds={evalSelectedRuleIds}
          onSelectedRuleIdsChange={setEvalSelectedRuleIds}
          onRun={() => actions.evaluate(evalTournamentId, evalSelectedRuleIds)}
          isRunning={actions.evaluateMutation.isPending}
        />
      )}

      {dialog === "import" && (
        <AchievementImportDialog
          onClose={closeImport}
          workspaceId={workspaceId}
          discipline={discipline}
          onImportFile={(file) => void actions.importRulesFromFile(file)}
          isImportingFile={actions.importMutation.isPending}
          result={actions.importResult}
          error={actions.importError}
          onImported={actions.setImportResult}
        />
      )}

      <AchievementFormDialog form={form} />

      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
        onConfirm={() => {
          if (confirmation?.kind === "delete") {
            actions.remove(confirmation.rule.id);
          } else {
            setConfirmation(null);
            actions.hardReset();
          }
        }}
        pending={confirmation?.kind === "delete" ? actions.deleteMutation.isPending : actions.hardResetMutation.isPending}
        intent={
          confirmation?.kind === "delete"
            ? {
                title: t("list.deleteAchievement"),
                description: t("list.deleteDescription", {
                  name: confirmation.rule.name,
                  slug: confirmation.rule.slug,
                }),
                confirmLabel: actions.deleteMutation.isPending ? t("common.deleting") : t("common.delete"),
                tone: "danger",
                cascade: [t("list.deleteCascadeResult"), t("list.deleteCascadeOverride")],
              }
            : {
                title: t("list.resetTitle"),
                description: t("list.resetDescription"),
                confirmLabel: t("list.hardReset"),
                tone: "danger",
                cascade: [t("list.resetCascade")],
              }
        }
      />
    </div>
  );
}
