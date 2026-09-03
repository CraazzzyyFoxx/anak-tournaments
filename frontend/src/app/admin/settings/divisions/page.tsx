"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Upload, Wand2 } from "lucide-react";
import Link from "next/link";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { StatusPill } from "@/components/admin/kit/StatusPill";
import { EYEBROW_CLASS } from "@/components/admin/tone";
import { Button } from "@/components/ui/button";
import { PageStateCard } from "@/components/ui/page-state-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryParams } from "@/hooks/useQueryParams";
import { usePermissions } from "@/hooks/usePermissions";
import { OW_REFERENCE_GRID } from "@/lib/division-grid";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DivisionGridPortableDocument } from "@/types/workspace.types";

import { VersionStrip } from "./VersionStrip";
import {
  bandRangeLabel,
  bandSize,
  bandsFromTiers,
  tiersFromBands,
  type Band
} from "./editor/draftReducer";

const SOURCE_STATUS_TONE = {
  ok: "success",
  incomplete: "warning",
  missing: "danger"
} as const;

/**
 * The whole OW ladder as a saveable version — what "Load standard OW ladder"
 * writes.
 *
 * Derived by the same band conversion the editor uses, so the standard ladder
 * and a hand-edited draft cannot disagree about `rank_min` / `ow_rank_*`. No
 * tier carries an `id`, which is what makes the save a new version rather than
 * a rewrite of an existing one.
 */
const STANDARD_OW_TIERS = tiersFromBands(bandsFromTiers(OW_REFERENCE_GRID.tiers));

/**
 * Settings › Divisions (T5 section, F11): the version history of the
 * workspace's division grid and the four ways into the draft editor.
 *
 * The section renders bare — the settings layout owns the page header, the rail
 * and the `<main>`. What used to be four always-mounted cards here (grid
 * library, spreadsheet editor, import wizard, conflict resolver) is now a
 * strip of versions plus links: the editor is a full-screen route of its own
 * and the importer is a wizard, because a version is either immutable or a
 * draft and only one of those is worth 1000 lines of editor.
 */
export default function DivisionsSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { searchParams, setParams } = useQueryParams();
  const { isSuperuser, canAccessPermission } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const getCurrentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace);
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);
  const workspace = getCurrentWorkspace();
  const activeVersionId = workspace?.default_division_grid_version_id ?? null;
  const portableInputRef = useRef<HTMLInputElement>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const canRead =
    workspaceId !== null && (isSuperuser || canAccessPermission("division_grid.read", workspaceId));
  const canCreate =
    workspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.create", workspaceId));

  const gridsQuery = useQuery({
    queryKey: ["division-grids", workspaceId],
    queryFn: () => workspaceService.getDivisionGrids(workspaceId!),
    enabled: canRead
  });
  const grids = useMemo(() => gridsQuery.data ?? [], [gridsQuery.data]);

  const gridParam = Number(searchParams?.get("grid"));
  const selectedGrid =
    grids.find((grid) => grid.id === gridParam) ??
    grids.find((grid) => grid.versions.some((version) => version.id === activeVersionId)) ??
    grids.find((grid) => grid.archived_at === null) ??
    grids[0] ??
    null;

  const versionsQuery = useQuery({
    queryKey: ["division-grid-versions", workspaceId, selectedGrid?.id ?? null],
    queryFn: () => workspaceService.getDivisionGridVersions(workspaceId!, selectedGrid!.id),
    enabled: canRead && selectedGrid !== null
  });
  const versions = versionsQuery.data ?? selectedGrid?.versions ?? [];
  const latestVersion =
    [...versions].sort((left, right) => right.version - left.version)[0] ?? null;
  const activeVersion = versions.find((version) => version.id === activeVersionId) ?? null;

  const readinessQuery = useQuery({
    queryKey: ["division-grid-readiness", workspaceId, activeVersionId],
    queryFn: () => workspaceService.getDivisionGridVersionReadiness(workspaceId!, activeVersionId!),
    enabled: canRead && activeVersionId !== null
  });
  const sources = readinessQuery.data?.sources ?? [];
  const tournamentCounts = useMemo(
    () => Object.fromEntries(sources.map((source) => [source.version_id, source.tournament_count])),
    [sources]
  );

  const activeBands = useMemo(
    () => (activeVersion ? bandsFromTiers(activeVersion.tiers) : []),
    [activeVersion]
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["division-grids", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["division-grid-versions", workspaceId] }),
      fetchWorkspaces()
    ]);
  };

  const openEditor = (versionId: number) => router.push(`/admin/settings/divisions/v/${versionId}`);

  const cloneMutation = useMutation({
    mutationFn: () => workspaceService.cloneDivisionGridVersion(latestVersion!.id),
    onSuccess: async (version) => {
      await refresh();
      notify.success(`Draft v${version.version} created`);
      openEditor(version.id);
    },
    onError: reportFailure("Draft could not be created")
  });

  const standardMutation = useMutation({
    mutationFn: () =>
      workspaceService.createDivisionGridVersion(workspaceId!, selectedGrid!.id, {
        label: "Standard OW ladder",
        tiers: STANDARD_OW_TIERS
      }),
    onSuccess: async (version) => {
      await refresh();
      notify.success(`Draft v${version.version} loaded with the standard ladder`);
      openEditor(version.id);
    },
    onError: reportFailure("Standard ladder could not be loaded")
  });

  const portableImportMutation = useMutation({
    mutationFn: (document: DivisionGridPortableDocument) =>
      workspaceService.importDivisionGridPortable(workspaceId!, document),
    onSuccess: async (grid) => {
      await refresh();
      setParams({ grid: String(grid.id) });
      notify.success("Division grid imported from JSON");
    },
    onError: reportFailure("JSON import failed")
  });

  const exportPortable = async () => {
    if (!selectedGrid) return;
    setPendingAction("export");
    try {
      const document = await workspaceService.exportDivisionGridPortable(selectedGrid.id);
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedGrid.slug}.division-grid.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      reportFailure("JSON export failed")(error);
    } finally {
      setPendingAction(null);
    }
  };

  const importPortable = async (file: File) => {
    try {
      portableImportMutation.mutate(JSON.parse(await file.text()) as DivisionGridPortableDocument);
    } catch (error) {
      notify.error("Invalid division grid JSON", {
        description: `Nothing was imported. ${
          error instanceof Error ? error.message : "The file is not valid JSON."
        } Export a grid from another workspace and import that file unchanged.`
      });
    } finally {
      if (portableInputRef.current) portableInputRef.current.value = "";
    }
  };

  const columns = useMemo<ColumnDef<Band>[]>(
    () => [
      {
        id: "number",
        header: "#",
        size: 56,
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.number}</span>
      },
      { id: "name", header: "Division", cell: ({ row }) => row.original.name },
      {
        id: "band",
        header: "OW band",
        cell: ({ row }) => <span className="font-mono text-sm">{bandRangeLabel(row.original)}</span>
      },
      {
        id: "ranks",
        header: "Ranks",
        size: 80,
        cell: ({ row }) => <span className="font-mono tabular-nums">{bandSize(row.original)}</span>
      },
      {
        id: "players",
        header: "Players",
        size: 90,
        cell: () => (
          <span
            className="text-muted-foreground"
            title="Player distribution per division is not exposed yet (backend gap G1)."
          >
            &mdash;
          </span>
        )
      }
    ],
    []
  );

  if (workspaceId === null) {
    return (
      <PageStateCard
        state="empty"
        title="No workspace selected"
        description="Pick a workspace to manage its division grid."
      />
    );
  }

  if (!canRead) {
    return (
      <PageStateCard
        state="not-found"
        title="Divisions are not available to you"
        description="Reading the division grid needs the division_grid.read permission in this workspace."
      />
    );
  }

  if (gridsQuery.isError) {
    return (
      <PageStateCard
        state="error"
        title="Division grids could not be loaded"
        description="The list of grids failed to load, so nothing below is trustworthy."
        actionLabel="Retry"
        onAction={() => void gridsQuery.refetch()}
      />
    );
  }

  if (gridsQuery.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          A division is a band of the Overwatch ladder. Published versions are immutable — every
          tournament keeps the version it was played on, and a mapping translates its divisions into
          the current grid.
        </p>
        <div className="flex flex-wrap gap-2">
          {canCreate ? (
            <>
              <input
                ref={portableInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-hidden
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importPortable(file);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => portableInputRef.current?.click()}
                disabled={portableImportMutation.isPending}
              >
                <Upload aria-hidden className="size-4" />
                Import JSON
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportPortable()}
            disabled={selectedGrid === null || pendingAction === "export"}
          >
            <Download aria-hidden className="size-4" />
            Export JSON
          </Button>
          {canCreate ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/settings/divisions/import">Import from workspace…</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {grids.length > 1 ? (
        <div className="flex items-center gap-2">
          <label className={EYEBROW_CLASS} htmlFor="division-grid-select">
            Grid
          </label>
          <Select
            value={selectedGrid ? String(selectedGrid.id) : undefined}
            onValueChange={(value) => setParams({ grid: value })}
          >
            <SelectTrigger id="division-grid-select" className="h-9 w-72">
              <SelectValue placeholder="Choose a grid" />
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

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold">Version history</h2>
          <span className={cn(EYEBROW_CLASS, "font-mono")}>
            {activeVersion ? "1 active" : "none active"} · {versions.length}{" "}
            {versions.length === 1 ? "version" : "versions"}
          </span>
        </div>

        {versions.length === 0 ? (
          <PageStateCard
            state="empty"
            title="No versions yet"
            description="Load the standard Overwatch ladder to start, or import a grid from another workspace."
          />
        ) : (
          <VersionStrip
            versions={versions}
            activeVersionId={activeVersionId}
            tournamentCounts={tournamentCounts}
            editorHref={(versionId) => `/admin/settings/divisions/v/${versionId}`}
          />
        )}

        <p className="text-sm text-muted-foreground">
          {activeVersion
            ? `v${activeVersion.version} stays the workspace grid until another version is published and activated.`
            : "No version is active yet, so ranks resolve through the built-in Overwatch ladder."}{" "}
          {canCreate ? (
            <span className="inline-flex flex-wrap gap-2 align-middle">
              {latestVersion ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => cloneMutation.mutate()}
                  disabled={cloneMutation.isPending}
                >
                  + New draft from v{latestVersion.version}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => standardMutation.mutate()}
                disabled={standardMutation.isPending || selectedGrid === null}
              >
                <Wand2 aria-hidden className="size-4" />
                Load standard OW ladder
              </Button>
            </span>
          ) : null}
        </p>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="font-display text-base font-semibold">
            {activeVersion
              ? `v${activeVersion.version} · ${activeVersion.label} — read-only`
              : "Active version"}
          </h2>
          {activeVersion ? (
            <AdminDataTable<Band>
              rows={activeBands}
              columns={columns}
              getRowId={(row) => row.slug}
              initialPageSize={25}
              emptyMessage="This version has no divisions."
            />
          ) : (
            <PageStateCard
              state="empty"
              title="Nothing activated"
              description="Publish and activate a version to use it for rank interpretation."
            />
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="font-display text-base font-semibold">Who reads which version</h2>
          {readinessQuery.isLoading ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every tournament in this workspace reads the active version, so no mapping is needed.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {sources.map((source) => (
                  <li
                    key={source.version_id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="font-mono text-sm">{source.version_label}</span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {source.tournament_count}{" "}
                      {source.tournament_count === 1 ? "tournament" : "tournaments"}
                    </span>
                    <StatusPill tone={SOURCE_STATUS_TONE[source.status]}>
                      {source.status === "ok" ? "mapping complete" : `mapping ${source.status}`}
                    </StatusPill>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Which tournaments read a version is not exposed yet — only how many (backend gap
                G2).
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function reportFailure(title: string) {
  return (error: unknown) =>
    notify.error(title, {
      description: `Nothing changed. ${
        error instanceof Error ? error.message : "The division grid operation failed."
      } Retry, or reload the page if it keeps failing.`
    });
}
