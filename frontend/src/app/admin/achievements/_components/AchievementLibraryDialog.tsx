"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, CircleOff, LibraryBig } from "lucide-react";

import { StatusIcon } from "@/components/admin/StatusIcon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import adminService from "@/services/admin.service";
import { achievementQueryKeys } from "@/lib/achievements/query-keys";
import type { AchievementRuleImportResult } from "@/types/admin.types";

/**
 * Copies achievements out of another workspace. Both the source list and the
 * selection are scoped to the dialog — nothing outside it needs either, and a
 * closed dialog should not be holding a half-made selection.
 */
export function AchievementLibraryDialog({
  open,
  onOpenChange,
  workspaceId,
  discipline,
  canImport,
  onImported,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  /** The game being copied: the source list, the selection and the import all stay inside it. */
  discipline: string;
  canImport: boolean;
  onImported: (result: AchievementRuleImportResult) => void;
}>) {
  const t = useTranslations("adminAchievements");
  const queryClient = useQueryClient();
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<number | undefined>(undefined);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());

  const { data: libraryWorkspaces } = useQuery({
    queryKey: achievementQueryKeys.libraryWorkspaces(workspaceId, discipline),
    queryFn: () => adminService.getAchievementLibraryWorkspaces(workspaceId, discipline),
    enabled: open,
  });

  const { data: libraryRules } = useQuery({
    queryKey: achievementQueryKeys.libraryRules(workspaceId, sourceWorkspaceId, discipline),
    queryFn: () => adminService.getAchievementLibraryRules(workspaceId, sourceWorkspaceId!, discipline),
    enabled: open && !!sourceWorkspaceId,
  });

  // A failed import keeps the selection: nothing was imported, and the admin can fix the cause and retry.
  const importMutation = useMutation({
    mutationFn: (data: { source_workspace_id: number; slugs: string[] }) =>
      adminService.importAchievementLibraryRules(workspaceId, { ...data, discipline }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: achievementQueryKeys.adminList(workspaceId, discipline) });
      queryClient.invalidateQueries({ queryKey: achievementQueryKeys.publicLists() });
      onImported(data);
      onOpenChange(false);
      setSelectedSlugs(new Set());
    },
  });

  const allSlugs = (libraryRules ?? []).map((rule) => rule.slug);
  const allSelected = allSlugs.length > 0 && allSlugs.every((slug) => selectedSlugs.has(slug));

  const toggleSlug = (slug: string, checked: boolean) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (checked) next.add(slug);
      else next.delete(slug);
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setSelectedSlugs(new Set());
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("library.title")}</DialogTitle>
          <DialogDescription>
            {t("library.description")}
          </DialogDescription>
        </DialogHeader>

        {importMutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {importMutation.error instanceof Error ? importMutation.error.message : t("library.importFailed")}
          </p>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="library-source-workspace">{t("library.sourceWorkspace")}</Label>
            <Select
              value={sourceWorkspaceId ? String(sourceWorkspaceId) : ""}
              onValueChange={(value) => {
                setSourceWorkspaceId(value ? Number(value) : undefined);
                setSelectedSlugs(new Set());
              }}
            >
              <SelectTrigger id="library-source-workspace">
                <SelectValue placeholder={t("library.selectWorkspace")} />
              </SelectTrigger>
              <SelectContent>
                {(libraryWorkspaces ?? []).map((workspace) => (
                  <SelectItem key={workspace.id} value={String(workspace.id)}>
                    {workspace.name} ({workspace.rules_count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {t.rich("library.achievementSelection", {
                  count: selectedSlugs.size,
                  num: (chunks) => <span className="tabular-nums text-muted-foreground">{chunks}</span>,
                })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedSlugs(new Set(allSlugs))}
                  disabled={allSlugs.length === 0 || allSelected}
                >
                  {t("common.selectAll")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedSlugs(new Set())}
                  disabled={selectedSlugs.size === 0}
                >
                  {t("common.clear")}
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[40vh] rounded border p-3">
              {!sourceWorkspaceId && (
                <p className="text-sm text-muted-foreground">
                  {t("library.pickWorkspace")}
                </p>
              )}
              {sourceWorkspaceId && (libraryRules?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("library.empty")}
                </p>
              )}
              <div className="space-y-2">
                {(libraryRules ?? []).map((rule) => (
                  <label
                    key={rule.slug}
                    className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Checkbox
                        checked={selectedSlugs.has(rule.slug)}
                        onCheckedChange={(checked) => toggleSlug(rule.slug, !!checked)}
                        aria-label={t("library.copy", { name: rule.name })}
                      />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{rule.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {t("library.ruleMeta", {
                            slug: rule.slug,
                            category: t(`common.categoryValues.${rule.category}`),
                          })}
                        </p>
                      </div>
                    </div>
                    {rule.enabled ? (
                      <StatusIcon icon={CheckCircle} label={t("common.on")} variant="success" />
                    ) : (
                      <StatusIcon icon={CircleOff} label={t("common.off")} variant="muted" />
                    )}
                  </label>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => {
              if (!sourceWorkspaceId || selectedSlugs.size === 0) return;
              importMutation.mutate({
                source_workspace_id: sourceWorkspaceId,
                slugs: Array.from(selectedSlugs),
              });
            }}
            disabled={
              !sourceWorkspaceId ||
              selectedSlugs.size === 0 ||
              importMutation.isPending ||
              !canImport
            }
          >
            <LibraryBig className={`mr-2 h-4 w-4 ${importMutation.isPending ? "animate-spin" : ""}`} aria-hidden />
            {importMutation.isPending ? t("library.importing") : t("library.importSelected")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
