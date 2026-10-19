"use client";

import type { ReactNode, RefObject } from "react";
import { Download, Upload, Wand2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type { Ladder } from "@/app/admin/settings/divisions/editor/draftReducer";
import {
  VersionHistory,
  type VersionHistoryProps
} from "@/app/admin/settings/divisions/VersionHistory";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DivisionGridEntity, DivisionGridVersion } from "@/types/workspace.types";

import { editorHref } from "./model";

/**
 * The open grid's versions, the drafts that can be started from them, and —
 * when the browsed game has more than one grid — which grid is open.
 */
export function VersionHistorySection({
  canCreate,
  versions,
  latestVersion,
  ladder,
  grids,
  selectedGrid,
  onSelectGrid,
  activeVersionId,
  tournamentCounts,
  activatable,
  onActivate,
  onNewDraft,
  newDraftPending,
  onLoadStandard,
  loadStandardPending,
  children
}: Readonly<
  Pick<VersionHistoryProps, "activeVersionId" | "tournamentCounts" | "activatable" | "onActivate"> & {
    canCreate: boolean;
    versions: DivisionGridVersion[];
    latestVersion: DivisionGridVersion | null;
    ladder: Ladder | null;
    /** The browsed game's grids. */
    grids: DivisionGridEntity[];
    selectedGrid: DivisionGridEntity | null;
    onSelectGrid: (gridId: string) => void;
    onNewDraft: (fromVersionId: number) => void;
    newDraftPending: boolean;
    onLoadStandard: () => void;
    loadStandardPending: boolean;
    /** The transfer row under the list. */
    children: ReactNode;
  }
>) {
  const t = useTranslations("adminSettings.divisions");
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="divisions-history">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="divisions-history" className="font-display text-base font-semibold">
            {t("versionHistory")}
          </h2>
          <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
            {t("versionHistoryDescription")}
          </p>
        </div>
        {canCreate ? (
          <div className="flex flex-wrap gap-2">
            {latestVersion ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNewDraft(latestVersion.id)}
                disabled={newDraftPending}
              >
                + {t("newDraft", { version: latestVersion.version })}
              </Button>
            ) : null}
            {ladder ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onLoadStandard}
                disabled={loadStandardPending || selectedGrid === null}
              >
                <Wand2 aria-hidden className="size-3.5" />
                {t("loadStandard")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {grids.length > 1 ? (
        <div className="flex items-center gap-2">
          <label className={EYEBROW_CLASS} htmlFor="division-grid-select">
            {t("grid")}
          </label>
          <Select
            value={selectedGrid ? String(selectedGrid.id) : undefined}
            onValueChange={onSelectGrid}
          >
            <SelectTrigger id="division-grid-select" className="h-9 w-72">
              <SelectValue placeholder={t("chooseGrid")} />
            </SelectTrigger>
            <SelectContent>
              {grids.map((grid) => (
                <SelectItem key={grid.id} value={String(grid.id)}>
                  {grid.name}
                  {grid.archived_at ? " (archived)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {versions.length === 0 ? (
        <EmptyNote title={t("noVersions")}>{t("noVersionsDescription")}</EmptyNote>
      ) : (
        <VersionHistory
          versions={versions}
          activeVersionId={activeVersionId}
          ladder={ladder}
          tournamentCounts={tournamentCounts}
          activatable={activatable}
          onActivate={onActivate}
          editorHref={editorHref}
        />
      )}

      {children}
    </section>
  );
}

/** A grid in and out of the workspace: portable JSON both ways, or the guided workspace import. */
export function GridTransferBar({
  canCreate,
  inputRef,
  onImportFile,
  importPending,
  onExport,
  exportDisabled
}: Readonly<{
  canCreate: boolean;
  /** Owned by the caller, which clears it once the picked file is read. */
  inputRef: RefObject<HTMLInputElement | null>;
  onImportFile: (file: File) => void;
  importPending: boolean;
  onExport: () => void;
  exportDisabled: boolean;
}>) {
  const t = useTranslations("adminSettings.divisions");
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <span className={cn(EYEBROW_CLASS, "mr-2")}>{t("transfer")}</span>
      {canCreate ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportFile(file);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={importPending}
          >
            <Upload aria-hidden className="size-3.5" />
            {t("importJson")}
          </Button>
        </>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onExport} disabled={exportDisabled}>
        <Download aria-hidden className="size-3.5" />
        {t("exportJson")}
      </Button>
      {canCreate ? (
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/settings/divisions/import">{t("importWorkspace")}</Link>
        </Button>
      ) : null}
    </div>
  );
}
