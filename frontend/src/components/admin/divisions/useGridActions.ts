"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import type { DivisionGridEntity, DivisionGridPortableImportDocument } from "@/types/workspace.types";

import type { GridFormValues } from "./GridFormDialog";

type DivisionsT = ReturnType<typeof useTranslations<"adminSettings.divisions">>;

/**
 * Captured when a write is submitted: a game or workspace switch while it is in flight must not redirect what it
 * refreshes (§2.6).
 */
export interface SubmitScope {
  workspaceId: number;
  discipline: string;
}

export function reportFailure(title: string, t: DivisionsT) {
  return (error: unknown) =>
    notify.error(title, {
      description: t("failureDescription", {
        reason: error instanceof Error ? error.message : t("operationFailed")
      })
    });
}

/**
 * The grid-level writes of the divisions page: create (from the ladder or a copy), rename, archive and restore,
 * delete (detaching pinned tournaments when asked), and the portable JSON both ways. Version-level writes (drafts,
 * activation) stay with the page, which owns the versions they act on.
 *
 * Create and rename report a refusal inside their dialog (the mutation's `error`); the one-click writes toast it.
 */
export function useGridActions({
  workspaceId,
  refresh,
  onOpen,
  onDeleted
}: Readonly<{
  workspaceId: number;
  refresh: (scope: SubmitScope) => Promise<void>;
  /** Opens a grid that just came into being (created or imported) as the owner of its game. */
  onOpen: (grid: DivisionGridEntity) => void;
  onDeleted: (grid: DivisionGridEntity) => void;
}>) {
  const t = useTranslations("adminSettings.divisions");
  const [exporting, setExporting] = useState(false);
  const scopeOf = (grid: DivisionGridEntity): SubmitScope => ({
    workspaceId: grid.workspace_id ?? workspaceId,
    discipline: grid.discipline
  });

  const create = useMutation({
    mutationFn: (input: { workspaceId: number; values: GridFormValues }) =>
      workspaceService.createDivisionGrid(input.workspaceId, {
        name: input.values.name,
        discipline: input.values.discipline,
        from_version_id: input.values.fromVersionId
      }),
    onSuccess: async (grid, input) => {
      await refresh({ workspaceId: input.workspaceId, discipline: grid.discipline });
      notify.success(t("toast.gridCreated", { name: grid.name }));
      onOpen(grid);
    }
  });

  const rename = useMutation({
    mutationFn: (input: { grid: DivisionGridEntity; name: string }) =>
      workspaceService.updateDivisionGrid(input.grid.id, { name: input.name }),
    onSuccess: async (grid, input) => {
      await refresh(scopeOf(input.grid));
      notify.success(t("toast.gridRenamed", { name: grid.name }));
    }
  });

  const archive = useMutation({
    mutationFn: (input: { grid: DivisionGridEntity; archived: boolean }) =>
      workspaceService.updateDivisionGrid(input.grid.id, { archived: input.archived }),
    onSuccess: async (grid, input) => {
      await refresh(scopeOf(input.grid));
      notify.success(t(input.archived ? "toast.gridArchived" : "toast.gridRestored", { name: grid.name }));
    },
    onError: reportFailure(t("errors.gridArchive"), t)
  });

  const remove = useMutation({
    mutationFn: (input: { grid: DivisionGridEntity; force: boolean }) =>
      workspaceService.deleteDivisionGrid(input.grid.id, input.force),
    onSuccess: async (_deleted, input) => {
      await refresh(scopeOf(input.grid));
      notify.success(t("toast.gridDeleted", { name: input.grid.name }));
      onDeleted(input.grid);
    },
    onError: reportFailure(t("errors.gridDelete"), t)
  });

  const importPortable = useMutation({
    mutationFn: (input: { workspaceId: number; document: DivisionGridPortableImportDocument }) =>
      workspaceService.importDivisionGridPortable(input.workspaceId, input.document),
    onSuccess: async (grid, input) => {
      await refresh({ workspaceId: input.workspaceId, discipline: grid.discipline });
      notify.success(t("toast.jsonImported"));
      onOpen(grid);
    },
    onError: reportFailure(t("errors.jsonImport"), t)
  });

  const importFile = async (file: File) => {
    let document: DivisionGridPortableImportDocument;
    try {
      document = JSON.parse(await file.text()) as DivisionGridPortableImportDocument;
    } catch (error) {
      notify.error(t("errors.invalidJson"), {
        description: t("errors.invalidJsonDescription", {
          reason: error instanceof Error ? error.message : t("errors.invalidJsonReason")
        })
      });
      return;
    }
    importPortable.mutate({ workspaceId, document });
  };

  const exportPortable = async (grid: DivisionGridEntity) => {
    setExporting(true);
    try {
      const document = await workspaceService.exportDivisionGridPortable(grid.id);
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${grid.slug}.division-grid.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      reportFailure(t("errors.jsonExport"), t)(error);
    } finally {
      setExporting(false);
    }
  };

  return {
    create,
    rename,
    archive,
    remove,
    importPortable,
    importFile,
    exportPortable,
    /** A grid write is in flight: the grid menu starts nothing else. */
    pending: rename.isPending || archive.isPending || remove.isPending || exporting
  };
}
