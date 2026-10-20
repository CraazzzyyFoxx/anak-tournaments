"use client";

import type { ReactNode, RefObject } from "react";
import { MoreHorizontal } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { GameLabel } from "@/components/workspace/GameLabel";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { DivisionGridEntity, DivisionGridVersion } from "@/types/workspace.types";

import { editorHref } from "./model";

/**
 * The open grid's versions, the drafts that can be started from them, and,
 * when the index lists more than one grid, which grid is open.
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
  games,
  children
}: Readonly<
  Pick<VersionHistoryProps, "activeVersionId" | "tournamentCounts" | "activatable" | "onActivate"> & {
    canCreate: boolean;
    versions: DivisionGridVersion[];
    latestVersion: DivisionGridVersion | null;
    ladder: Ladder | null;
    /** The index's grids: the browsed game's, or every game's under "all games". */
    grids: DivisionGridEntity[];
    /** Installed games by code, passed only when `grids` spans several games: each option names its game. */
    games?: Map<string, DisciplineDescriptor>;
    selectedGrid: DivisionGridEntity | null;
    onSelectGrid: (gridId: string) => void;
    onNewDraft: (fromVersionId: number) => void;
    newDraftPending: boolean;
    onLoadStandard: () => void;
    loadStandardPending: boolean;
    /** The transfer menu, last among the header actions. */
    children: ReactNode;
  }
>) {
  const t = useTranslations("adminSettings.divisions");
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="divisions-history">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="divisions-history" className="text-ui font-semibold text-foreground">
          {t("versionHistory")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && latestVersion ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNewDraft(latestVersion.id)}
              disabled={newDraftPending}
            >
              {t("newDraft", { version: latestVersion.version })}
            </Button>
          ) : null}
          {canCreate && ladder && selectedGrid ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onLoadStandard}
              disabled={loadStandardPending}
            >
              {t("loadStandard")}
            </Button>
          ) : null}
          {children}
        </div>
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
            <SelectTrigger id="division-grid-select" className="w-72">
              <SelectValue placeholder={t("chooseGrid")} />
            </SelectTrigger>
            <SelectContent>
              {grids.map((grid) => (
                <SelectItem key={grid.id} value={String(grid.id)}>
                  {games ? (
                    <>
                      <GameLabel code={grid.discipline} games={games} /> ·{" "}
                    </>
                  ) : null}
                  {grid.archived_at ? t("archivedGrid", { name: grid.name }) : grid.name}
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
    </section>
  );
}

/** A grid in and out of the workspace: portable JSON both ways, or the guided workspace import. */
export function GridTransferMenu({
  canCreate,
  inputRef,
  onImportFile,
  importPending,
  onExport,
  canExport,
  exportPending
}: Readonly<{
  canCreate: boolean;
  /** Owned by the caller, which clears it once the picked file is read. */
  inputRef: RefObject<HTMLInputElement | null>;
  onImportFile: (file: File) => void;
  importPending: boolean;
  onExport: () => void;
  /** A grid is open, so there is something to export. */
  canExport: boolean;
  exportPending: boolean;
}>) {
  const t = useTranslations("adminSettings.divisions");
  if (!canCreate && !canExport) return null;
  return (
    <>
      {canCreate ? (
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
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t("transfer")} title={t("transfer")}>
            <MoreHorizontal aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {canCreate ? (
            <DropdownMenuItem disabled={importPending} onSelect={() => inputRef.current?.click()}>
              {t("importJson")}
            </DropdownMenuItem>
          ) : null}
          {canExport ? (
            <DropdownMenuItem disabled={exportPending} onSelect={onExport}>
              {t("exportJson")}
            </DropdownMenuItem>
          ) : null}
          {canCreate ? (
            <DropdownMenuItem asChild>
              <Link href="/admin/settings/divisions/import">{t("importWorkspace")}</Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
