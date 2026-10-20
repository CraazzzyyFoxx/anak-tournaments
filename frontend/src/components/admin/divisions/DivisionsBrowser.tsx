"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  bandsFromTiers,
  createLadder,
  standardTiers,
  type Band
} from "@/app/admin/settings/divisions/editor/draftReducer";
import { gameFilterDefs } from "@/components/admin/game-filter";
import { DataTable } from "@/components/data-table";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters } from "@/components/kit/useFilters";
import { Button } from "@/components/ui/button";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";
import { useGameScope } from "@/hooks/useGameScope";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useQueryParams } from "@/hooks/useQueryParams";
import { usePermissions } from "@/hooks/usePermissions";
import { activeGridVersionId, resolveOwnerGrid } from "@/lib/divisions/grid";
import { showsGameMarks } from "@/lib/site/discipline-scope";
import { divisionGridQueryKeys } from "@/lib/divisions/query-keys";
import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type {
  DivisionGridPortableImportDocument,
  DivisionGridVersion
} from "@/types/workspace.types";

import { GridInForceSection } from "./GridInForceSection";
import { editorHref } from "./model";
import { ReadersSection } from "./ReadersSection";
import { useDivisionColumns } from "./useDivisionColumns";
import { GridTransferMenu, VersionHistorySection } from "./VersionHistorySection";

/**
 * Settings › Divisions: what grid is in force, the version history behind it,
 * and the one thing worth doing next.
 *
 * The editor is a full-screen route of its own and the importer is a wizard,
 * because a version is either immutable or a draft and only one of those is
 * worth 1000 lines of editor.
 *
 * The active version is read from the workspace, not from the grid list: a
 * workspace may point at a version of a shared grid it does not own, and that
 * version is still the one every rank resolves through.
 */
export function DivisionsBrowser({ workspaceId }: Readonly<{ workspaceId: number }>) {
  const t = useTranslations("adminSettings.divisions");
  const gameT = useTranslations("common.discipline");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { searchParams, setParams } = useQueryParams();
  const { isSuperuser, canAccessPermission } = usePermissions();
  const getCurrentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace);
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);
  const workspace = getCurrentWorkspace();
  const portableInputRef = useRef<HTMLInputElement>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [activating, setActivating] = useState<DivisionGridVersion | null>(null);

  const canCreate = isSuperuser || canAccessPermission("division_grid.create", workspaceId);
  const canActivate = isSuperuser || canAccessPermission("division_grid.update", workspaceId);

  const gridsQuery = useQuery({
    queryKey: divisionGridQueryKeys.grids(workspaceId),
    queryFn: () => workspaceService.getDivisionGrids(workspaceId)
  });
  const grids = useMemo(() => gridsQuery.data ?? [], [gridsQuery.data]);

  // An explicitly opened `?grid=` is an OWNER (spec §5, §6.12): its own game is the page's, whatever `?discipline=`
  // says. Without a pin the index is a multi page: every game's grids unfiltered, one game's under the game filter.
  const gridParam = Number(searchParams?.get("grid"));
  const hasGridPin = searchParams?.has("grid") === true;
  const ownerGrid = hasGridPin ? (grids.find((grid) => grid.id === gridParam) ?? null) : null;
  const gameScope = useGameScope({
    pageClass: ownerGrid ? "owner" : "multi",
    axis: workspaceId,
    ownerGame: ownerGrid?.discipline ?? null
  });
  // Picking another game than the pinned grid's unpins it, or the pick would show nothing; clearing the filter keeps it.
  const gameDefs = gameFilterDefs(gameScope.games, gameT("column"), (next) =>
    ownerGrid !== null && next !== null && next !== ownerGrid.discipline ? ["grid"] : []
  );
  const filters = useFilters(gameDefs);
  const browsedDiscipline = gameScope.game;
  // Only "all games" lists every game's grids: an invalid or empty game opens none.
  const scopedGrids =
    gameScope.resolution?.game.kind === "all"
      ? grids
      : grids.filter((grid) => grid.discipline === browsedDiscipline);
  const pinnedGrid = scopedGrids.find((grid) => grid.id === gridParam) ?? null;
  const selectedGrid =
    pinnedGrid ??
    scopedGrids.find((grid) =>
      grid.versions.some((version) => version.id === activeGridVersionId(workspace, grid.discipline))
    ) ??
    scopedGrids.find((grid) => grid.archived_at === null) ??
    scopedGrids[0] ??
    null;
  // Under "all games" the open grid's own game drives its ladder, versions and readiness.
  const selectedDiscipline = browsedDiscipline ?? selectedGrid?.discipline ?? null;
  const descriptors = useGameDescriptors();
  const gridMarks =
    gameScope.resolution !== null && showsGameMarks(gameScope.resolution, gameScope.games ?? [])
      ? descriptors
      : undefined;
  const activeVersionId = activeGridVersionId(workspace, selectedDiscipline);

  const metadataQuery = useDisciplineMetadata(workspaceId, selectedDiscipline);
  const metadata = metadataQuery.data;
  const ladder = useMemo(
    () =>
      metadata?.discipline.capabilities.native_ladder ? createLadder(metadata.native_ladder) : null,
    [metadata]
  );
  // A declared native ladder with no ranks is invalid metadata, never "no ladder".
  const metadataInvalid =
    metadata !== undefined && metadata.discipline.capabilities.native_ladder && ladder === null;
  const hasNativeLadder = ladder !== null;
  // The game's own standard ladder as a saveable version, and what an unactivated workspace resolves through.
  const standardLadderTiers = useMemo(() => (ladder ? standardTiers(ladder) : null), [ladder]);
  const builtInBands = useMemo(
    () => (ladder && standardLadderTiers ? bandsFromTiers(ladder, standardLadderTiers) : []),
    [ladder, standardLadderTiers]
  );

  const versionsQuery = useQuery({
    queryKey: divisionGridQueryKeys.versions(workspaceId, selectedDiscipline, selectedGrid?.id ?? null),
    queryFn: () => workspaceService.getDivisionGridVersions(workspaceId, selectedGrid!.id),
    enabled: selectedGrid !== null
  });
  const versions = versionsQuery.data ?? selectedGrid?.versions ?? [];
  const latestVersion =
    [...versions].sort((left, right) => right.version - left.version)[0] ?? null;
  const draft =
    [...versions]
      .filter((version) => version.status === "draft")
      .sort((left, right) => right.version - left.version)[0] ?? null;
  const activeVersion =
    versions.find((version) => version.id === activeVersionId) ??
    resolveOwnerGrid(workspace, selectedDiscipline) ??
    null;
  const activeIsShared =
    activeVersion !== null && !grids.some((grid) => grid.id === activeVersion.grid_id);

  const readinessQuery = useQuery({
    queryKey: divisionGridQueryKeys.readiness(workspaceId, selectedDiscipline, activeVersionId),
    queryFn: () => workspaceService.getDivisionGridVersionReadiness(workspaceId, activeVersionId!),
    enabled: activeVersionId !== null
  });
  const sources = readinessQuery.data?.sources ?? [];
  const tournamentCounts = useMemo(
    () =>
      readinessQuery.data
        ? Object.fromEntries(sources.map((source) => [source.version_id, source.tournament_count]))
        : null,
    [readinessQuery.data, sources]
  );

  // Published versions the workspace is not on yet: each needs its own
  // readiness to know whether "Activate" is honest right now.
  const candidates = useMemo(
    () =>
      canActivate
        ? versions
            .filter((version) => version.status === "published" && version.id !== activeVersionId)
            .sort((left, right) => right.version - left.version)
        : [],
    [activeVersionId, canActivate, versions]
  );
  const candidateReadiness = useQueries({
    queries: candidates.map((version) => ({
      queryKey: divisionGridQueryKeys.readiness(workspaceId, selectedDiscipline, version.id),
      queryFn: () => workspaceService.getDivisionGridVersionReadiness(workspaceId, version.id)
    }))
  });
  const activatable = useMemo(
    () =>
      Object.fromEntries(
        candidates.map((version, index) => [version.id, candidateReadiness[index]?.data?.is_ready])
      ) as Record<number, boolean | undefined>,
    [candidates, candidateReadiness]
  );
  const readyCandidate = candidates.find((version) => activatable[version.id] === true) ?? null;

  const activeBands = useMemo(
    () => (activeVersion ? bandsFromTiers(ladder, activeVersion.tiers) : []),
    [activeVersion, ladder]
  );

  // Scope captured at submit: a game or workspace switch while a request is in flight must not
  // redirect its invalidation (§2.6).
  const submitScope = { workspaceId, discipline: selectedDiscipline ?? "" };
  type SubmitScope = typeof submitScope;
  const refresh = async (scope: SubmitScope) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: divisionGridQueryKeys.grids(scope.workspaceId) }),
      queryClient.invalidateQueries({
        queryKey: divisionGridQueryKeys.versionsByDiscipline(scope.workspaceId, scope.discipline)
      }),
      queryClient.invalidateQueries({
        queryKey: divisionGridQueryKeys.readinessByDiscipline(scope.workspaceId, scope.discipline)
      }),
      fetchWorkspaces()
    ]);
  };

  const cloneMutation = useMutation({
    mutationFn: (input: { scope: SubmitScope; versionId: number }) =>
      workspaceService.cloneDivisionGridVersion(input.versionId),
    onSuccess: async (version, input) => {
      await refresh(input.scope);
      notify.success(t("toast.draftCreated", { version: version.version }));
      router.push(editorHref(version.id));
    },
    onError: reportFailure(t("errors.draftCreate"), t)
  });

  const standardMutation = useMutation({
    mutationFn: (input: { scope: SubmitScope; gridId: number | undefined; tiers: typeof standardLadderTiers }) => {
      if (input.gridId === undefined || !input.tiers) {
        throw new Error(t("errors.noStandardLadder"));
      }
      return workspaceService.createDivisionGridVersion(input.scope.workspaceId, input.gridId, {
        label: t("standardLadder"),
        tiers: input.tiers
      });
    },
    onSuccess: async (version, input) => {
      await refresh(input.scope);
      notify.success(t("toast.standardLoaded", { version: version.version }));
      router.push(editorHref(version.id));
    },
    onError: reportFailure(t("errors.standardLoad"), t)
  });

  const activateMutation = useMutation({
    mutationFn: async (input: { scope: SubmitScope; version: DivisionGridVersion; ownVersionIds: number[] }) => {
      // Defaults are per game: a version that is not one of the open grid's own is never activated here.
      if (!input.ownVersionIds.includes(input.version.id)) {
        throw new Error(t("errors.activateWrongGame"));
      }
      return workspaceService.activateDivisionGridVersion(input.scope.workspaceId, input.version.id);
    },
    onSuccess: async (version, input) => {
      setActivating(null);
      await refresh(input.scope);
      notify.success(t("toast.activated", { version: version.version }));
    },
    onError: reportFailure(t("errors.activate"), t)
  });

  const portableImportMutation = useMutation({
    mutationFn: (input: { scope: { workspaceId: number }; document: DivisionGridPortableImportDocument }) =>
      workspaceService.importDivisionGridPortable(input.scope.workspaceId, input.document),
    onSuccess: async (grid, input) => {
      await refresh({ workspaceId: input.scope.workspaceId, discipline: grid.discipline });
      // Open the imported grid as an owner of its game, whatever the browsing choice was.
      setParams({ grid: String(grid.id), discipline: grid.discipline });
      notify.success(t("toast.jsonImported"));
    },
    onError: reportFailure(t("errors.jsonImport"), t)
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
      reportFailure(t("errors.jsonExport"), t)(error);
    } finally {
      setPendingAction(null);
    }
  };

  const importPortable = async (file: File) => {
    try {
      portableImportMutation.mutate(
{ scope: { workspaceId: submitScope.workspaceId }, document: JSON.parse(await file.text()) as DivisionGridPortableImportDocument }
      );
    } catch (error) {
      notify.error(t("errors.invalidJson"), {
        description: t("errors.invalidJsonDescription", {
          reason: error instanceof Error ? error.message : t("errors.invalidJsonReason")
        })
      });
    } finally {
      if (portableInputRef.current) portableInputRef.current.value = "";
    }
  };

  const columns = useDivisionColumns(ladder);

  if (gridsQuery.isError) {
    return (
      <PageStateCard
        state="error"
        title={t("loadError.title")}
        description={t("loadError.description")}
        actionLabel={t("retry")}
        onAction={() => void gridsQuery.refetch()}
      />
    );
  }

  if (gridsQuery.isLoading) {
    return (
      <div aria-hidden className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // Nothing game-shaped is read or drawn until the games are known: an explicit invalid `?discipline=` is named,
  // never corrected.
  const resolution = gameScope.resolution;
  if (resolution === null) {
    return gameScope.isError ? (
      <PageStateCard
        state="error"
        title={t("loadError.title")}
        description={t("loadError.description")}
        actionLabel={t("retry")}
        onAction={gameScope.refetch}
      />
    ) : (
      <Skeleton className="h-40 w-full rounded-xl" />
    );
  }
  if (resolution.game.kind === "invalid" || resolution.game.kind === "empty") {
    return <GameScopeControl scope={gameScope} variant="multi" />;
  }
  if (selectedDiscipline !== null && (metadataQuery.isError || metadataInvalid)) {
    return (
      <PageStateCard
        state="error"
        title={t("loadError.title")}
        description={t("loadError.description")}
        actionLabel={t("retry")}
        onAction={() => void metadataQuery.refetch()}
      />
    );
  }
  if (selectedDiscipline !== null && metadata === undefined) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  // The one thing worth doing next, ranked: finish the draft, put a finished
  // version in force, start a draft, start from the standard ladder.
  const nextAction = draft ? (
    <Button size="sm" asChild>
      <Link href={editorHref(draft.id)}>{t("openDraft", { version: draft.version })}</Link>
    </Button>
  ) : readyCandidate ? (
    <Button size="sm" onClick={() => setActivating(readyCandidate)}>
      {t("activateVersion", { version: readyCandidate.version })}
    </Button>
  ) : canCreate && latestVersion ? (
    <Button size="sm" onClick={() => cloneMutation.mutate({ scope: submitScope, versionId: latestVersion.id })} disabled={cloneMutation.isPending}>
      {t("newDraft", { version: latestVersion.version })}
    </Button>
  ) : canCreate && selectedGrid && ladder ? (
    <Button
      size="sm"
      onClick={() => standardMutation.mutate({ scope: submitScope, gridId: selectedGrid?.id, tiers: standardLadderTiers })}
      disabled={standardMutation.isPending}
    >
      {t("loadStandard")}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      {gameDefs.length > 0 ? <FilterBar defs={gameDefs} filters={filters} /> : null}
      <GridInForceSection
        ladder={ladder}
        activeVersion={activeVersion}
        bands={activeVersion ? activeBands : builtInBands}
        activeIsShared={activeIsShared}
        systemFallback={activeVersionId === null}
        nextAction={nextAction}
      />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          <VersionHistorySection
            canCreate={canCreate}
            versions={versions}
            latestVersion={latestVersion}
            ladder={ladder}
            grids={scopedGrids}
            games={gridMarks}
            selectedGrid={selectedGrid}
            onSelectGrid={(value) => setParams({ grid: value })}
            activeVersionId={activeVersionId}
            tournamentCounts={tournamentCounts}
            activatable={activatable}
            onActivate={setActivating}
            onNewDraft={(versionId) => cloneMutation.mutate({ scope: submitScope, versionId })}
            newDraftPending={cloneMutation.isPending}
            onLoadStandard={() => standardMutation.mutate({ scope: submitScope, gridId: selectedGrid?.id, tiers: standardLadderTiers })}
            loadStandardPending={standardMutation.isPending}
          >
            <GridTransferMenu
              canCreate={canCreate}
              inputRef={portableInputRef}
              onImportFile={(file) => void importPortable(file)}
              importPending={portableImportMutation.isPending}
              onExport={() => void exportPortable()}
              canExport={selectedGrid !== null}
              exportPending={pendingAction === "export"}
            />
          </VersionHistorySection>

          <ReadersSection
            activeVersion={activeVersion}
            loading={readinessQuery.isLoading}
            sources={sources}
          />
        </div>

        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="divisions-table">
          <h2 id="divisions-table" className="text-ui font-semibold text-foreground">
            {t("divisionsInForce")}
          </h2>
          {activeVersion ? (
            <DataTable<Band>
              rows={activeBands}
              columns={columns}
              getRowId={(row) => row.slug}
              initialPageSize={50}
              emptyMessage={t("table.empty")}
            />
          ) : (
            <EmptyNote size="sm">
              {t(hasNativeLadder ? "playersUntilActivated" : "organizerGridRequired")}
            </EmptyNote>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={activating !== null}
        onOpenChange={(open) => {
          if (!open) setActivating(null);
        }}
        intent={{
          title: t("confirm.activateTitle", { version: activating?.version ?? "" }),
          description: t("confirm.activateDescription", { version: activating?.version ?? "" }),
          confirmLabel: t("activateVersion", { version: activating?.version ?? "" }),
          tone: "neutral"
        }}
        pending={activateMutation.isPending}
        onConfirm={() => {
          if (activating) {
            activateMutation.mutate({
              scope: submitScope,
              version: activating,
              ownVersionIds: versions.map((entry) => entry.id)
            });
          }
        }}
      />
    </div>
  );
}

function reportFailure(
  title: string,
  t: ReturnType<typeof useTranslations<"adminSettings.divisions">>
) {
  return (error: unknown) =>
    notify.error(title, {
      description: t("failureDescription", {
        reason: error instanceof Error ? error.message : t("operationFailed")
      })
    });
}
