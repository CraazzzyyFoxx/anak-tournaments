"use client";

import { Suspense, useEffect } from "react";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { CardSurface } from "@/app/(site)/users/components/shared/atoms";
import ComparePageHero from "@/app/(site)/users/compare/components/ComparePageHero";
import CompareFiltersPanel from "@/app/(site)/users/compare/components/CompareFiltersPanel";
import CompareUnifiedTable from "@/app/(site)/users/compare/components/CompareUnifiedTable";
import { useUserCompareSearchParams } from "@/app/(site)/users/compare/hooks/useUserCompareSearchParams";
import { useUserCompareData } from "@/app/(site)/users/compare/hooks/useUserCompareData";
import { Spinner } from "@/components/ui/spinner";
import { PageStateCard } from "@/components/ui/page-state-card";
import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";
import type { StatsScope } from "@/lib/site/stats-scope";

const colorOf = (entity: { attrs: Record<string, unknown> } | undefined) =>
  typeof entity?.attrs.color === "string" ? entity.attrs.color : undefined;
const imageOf = (entity: { image_path: string | null } | undefined) => entity?.image_path ?? undefined;

const PageContent = ({ scope }: Readonly<{ scope: StatsScope }>) => {
  const t = useTranslations();
  const compareParams = useUserCompareSearchParams();
  const browsing = useBrowsingDiscipline({ allowsAll: false });
  const discipline = browsing.resolved?.kind === "concrete" ? browsing.resolved.code : null;

  const {
    compareQuery,
    heroCompareQuery,
    heroes,
    maps,
    tournaments,
    leftHero,
    rightHero,
    selectedSubjectName,
    selectedTargetName,
    baselineSummary,
    rows,
    activeLoading,
    activeRefreshing,
    activeError,
    activeErrorMessage,
    compareDisplayName,
    selectionInvalid,
    selectionsSettled,
    selectionError,
    selectionPending,
    retrySelections,
    heroesQuery,
    mapsQuery,
    tournamentsQuery,
    divisionGrid
  } = useUserCompareData({
    isHeroScope: compareParams.isHeroScope,
    subjectUserId: compareParams.subjectUserId,
    effectiveBaseline: compareParams.effectiveBaseline,
    targetUserId: compareParams.targetUserId,
    role: compareParams.role,
    divMin: compareParams.divMin,
    divMax: compareParams.divMax,
    tournamentId: compareParams.tournamentId,
    leftHeroId: compareParams.leftHeroId,
    rightHeroId: compareParams.rightHeroId,
    mapId: compareParams.mapId,
    scope,
    discipline
  });

  useEffect(() => {
    if (!compareParams.isTargetBaseline) return;
    if (compareParams.divMin === undefined && compareParams.divMax === undefined) return;

    compareParams.updateParams({ div_min: undefined, div_max: undefined });
  }, [
    compareParams.divMax,
    compareParams.divMin,
    compareParams.isTargetBaseline,
    compareParams.updateParams
  ]);

  const activeData = compareParams.isHeroScope
    ? selectionsSettled
      ? heroCompareQuery.data
      : undefined
    : compareQuery.data;
  const sampleSize = activeData?.baseline.sample_size;
  const retryActiveQuery = () => {
    void (compareParams.isHeroScope ? heroCompareQuery.refetch() : compareQuery.refetch());
  };

  if (browsing.resolved?.kind === "invalid" || browsing.resolved?.kind === "empty") {
    return (
      <div className="aqt-player space-y-3.5">
        <DisciplineUnavailable
          resolved={browsing.resolved}
          disciplines={browsing.disciplines ?? []}
          allowsAll={false}
          onSelect={browsing.select}
        />
      </div>
    );
  }

  return (
    <div className="aqt-player space-y-3.5">
      {browsing.disciplines ? (
        <div className="flex justify-end">
          <DisciplineSelector
            disciplines={browsing.disciplines}
            value={discipline ?? undefined}
            allowsAll={false}
            onSelect={browsing.select}
          />
        </div>
      ) : null}
      <ComparePageHero
        hasSubject={compareParams.subjectUserId !== undefined}
        hasData={activeData !== undefined}
        isLoading={activeLoading}
        isRefreshing={activeRefreshing}
        scope={compareParams.scope}
        baseline={compareParams.effectiveBaseline}
        baselineSummary={baselineSummary}
        sampleSize={sampleSize}
        metricCount={rows.length}
      />

      <CardSurface bodyClassName="space-y-5">
        <CompareFiltersPanel
          subjectUserId={compareParams.subjectUserId}
          targetUserId={compareParams.targetUserId}
          scope={compareParams.scope}
          role={compareParams.role}
          divMin={compareParams.divMin}
          divMax={compareParams.divMax}
          tournamentId={compareParams.tournamentId}
          leftHeroId={compareParams.leftHeroId}
          rightHeroId={compareParams.rightHeroId}
          mapId={compareParams.mapId}
          isTargetBaseline={compareParams.isTargetBaseline}
          selectedSubjectName={selectedSubjectName}
          selectedTargetName={selectedTargetName}
          subjectNameLoading={activeLoading && !selectedSubjectName}
          targetNameLoading={
            Boolean(compareParams.targetUserId) && activeLoading && !selectedTargetName
          }
          divisionGrid={divisionGrid}
          heroes={heroes}
          maps={maps}
          tournaments={tournaments}
          isHeroesLoading={heroesQuery.isLoading}
          isHeroesError={heroesQuery.isError}
          isMapsLoading={mapsQuery.isLoading}
          isMapsError={mapsQuery.isError}
          isTournamentsLoading={tournamentsQuery.isLoading}
          isTournamentsError={tournamentsQuery.isError}
          updateParams={compareParams.updateParams}
        />
      </CardSurface>

      {selectionInvalid ? (
        <PageStateCard
          state="error"
          title={t("users.compare.invalidSelection.title")}
          description={t("users.compare.invalidSelection.description", {
            game: browsing.disciplines?.find((entry) => entry.code === discipline)?.name ?? discipline ?? ""
          })}
        />
      ) : selectionError ? (
        <PageStateCard
          state="error"
          description={t("users.compare.invalidSelection.checkFailed")}
          onAction={retrySelections}
          actionLabel={t("common.retry")}
        />
      ) : selectionPending ? (
        <CardSurface>
          <div className="flex justify-center py-16" role="status" aria-busy="true">
            <Spinner />
          </div>
        </CardSurface>
      ) : compareParams.subjectUserId ? (
        <CompareUnifiedTable
          subjectName={
            selectedSubjectName ??
            t("users.compare.userNumber", { id: String(compareParams.subjectUserId) })
          }
          baselineName={compareDisplayName}
          rows={rows}
          loading={activeLoading}
          refreshing={activeRefreshing}
          errorMessage={activeError ? activeErrorMessage : undefined}
          onRetry={retryActiveQuery}
          isHeroScope={compareParams.isHeroScope}
          isTargetBaseline={compareParams.isTargetBaseline}
          subjectHero={{
            name:
              heroCompareQuery.data?.subject_hero?.name ??
              leftHero?.name ??
              t("users.compare.allHeroes"),
            imagePath: heroCompareQuery.data?.subject_hero?.image_path ?? imageOf(leftHero),
            dominantColor: heroCompareQuery.data?.subject_hero?.color ?? colorOf(leftHero),
            playtimeSeconds: heroCompareQuery.data?.left_playtime_seconds ?? 0,
            playtimeLabel: t("users.compare.playtime")
          }}
          baselineHero={{
            name:
              heroCompareQuery.data?.target_hero?.name ??
              rightHero?.name ??
              t("users.compare.allHeroes"),
            imagePath: heroCompareQuery.data?.target_hero?.image_path ?? imageOf(rightHero),
            dominantColor: heroCompareQuery.data?.target_hero?.color ?? colorOf(rightHero),
            playtimeSeconds: heroCompareQuery.data?.right_playtime_seconds ?? 0,
            playtimeLabel: t("users.compare.avgPlaytime")
          }}
        />
      ) : (
        <CardSurface>
          <div
            aria-live="polite"
            className="flex flex-col items-center justify-center gap-3 py-16 text-center"
          >
            <Users className="h-10 w-10 text-[color:var(--aqt-fg-dim)]" />
            <p className="text-sm text-[color:var(--aqt-fg-muted)]">
              {t("users.compare.selectUserPrompt")}
            </p>
          </div>
        </CardSurface>
      )}
    </div>
  );
};

const CompareClient = ({ scope }: Readonly<{ scope: StatsScope }>) => (
  <Suspense fallback={null}>
    <PageContent scope={scope} />
  </Suspense>
);

export default CompareClient;
