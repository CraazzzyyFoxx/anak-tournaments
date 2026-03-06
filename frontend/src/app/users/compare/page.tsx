"use client";

import React, { useEffect } from "react";
import { Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import GlassGlow from "@/app/users/compare/components/GlassGlow";
import ComparePageHeader from "@/app/users/compare/components/ComparePageHeader";
import CompareFiltersPanel from "@/app/users/compare/components/CompareFiltersPanel";
import CompareSummaryBadges from "@/app/users/compare/components/CompareSummaryBadges";
import CompareUnifiedTable from "@/app/users/compare/components/CompareUnifiedTable";
import { useUserCompareSearchParams } from "@/app/users/compare/hooks/useUserCompareSearchParams";
import { useUserCompareData } from "@/app/users/compare/hooks/useUserCompareData";

const Page = () => {
  const compareParams = useUserCompareSearchParams();

  const {
    heroCompareQuery,
    heroes,
    maps,
    leftHero,
    rightHero,
    selectedMap,
    selectedMapIcon,
    selectedSubjectName,
    selectedTargetName,
    baselineSummary,
    rows,
    activeLoading,
    activeError,
    activeErrorMessage,
    compareDisplayName,
    heroesQuery,
    mapsQuery
  } = useUserCompareData({
    isHeroScope: compareParams.isHeroScope,
    subjectUserId: compareParams.subjectUserId,
    effectiveBaseline: compareParams.effectiveBaseline,
    targetUserId: compareParams.targetUserId,
    role: compareParams.role,
    divMin: compareParams.divMin,
    divMax: compareParams.divMax,
    leftHeroId: compareParams.leftHeroId,
    rightHeroId: compareParams.rightHeroId,
    mapId: compareParams.mapId
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

  return (
    <div
      className="liquid-glass space-y-6"
      style={
        {
          "--lg-a": "16 185 129",
          "--lg-b": "14 165 233",
          "--lg-c": "245 158 11"
        } as React.CSSProperties
      }
    >
      <Card className="relative overflow-hidden">
        <GlassGlow />

        <ComparePageHeader />

        <CompareFiltersPanel
          subjectUserId={compareParams.subjectUserId}
          targetUserId={compareParams.targetUserId}
          scope={compareParams.scope}
          role={compareParams.role}
          divMin={compareParams.divMin}
          divMax={compareParams.divMax}
          leftHeroId={compareParams.leftHeroId}
          rightHeroId={compareParams.rightHeroId}
          mapId={compareParams.mapId}
          isTargetBaseline={compareParams.isTargetBaseline}
          selectedSubjectName={selectedSubjectName}
          selectedTargetName={selectedTargetName}
          subjectNameLoading={activeLoading && !selectedSubjectName}
          targetNameLoading={Boolean(compareParams.targetUserId) && activeLoading && !selectedTargetName}
          heroes={heroes}
          maps={maps}
          isHeroesLoading={heroesQuery.isLoading}
          isHeroesError={heroesQuery.isError}
          isMapsLoading={mapsQuery.isLoading}
          isMapsError={mapsQuery.isError}
          updateParams={compareParams.updateParams}
        />

        {/* <div className="relative px-6 pb-6">
          <CompareSummaryBadges
            effectiveBaseline={compareParams.effectiveBaseline}
            baselineSummary={baselineSummary}
            isHeroScope={compareParams.isHeroScope}
            selectedMapName={heroCompareQuery.data?.map?.name}
          />
        </div> */}
      </Card>

      {compareParams.subjectUserId ? (
        <CompareUnifiedTable
          subjectName={selectedSubjectName ?? `User #${compareParams.subjectUserId}`}
          baselineName={compareDisplayName}
          rows={rows}
          loading={activeLoading}
          errorMessage={activeError ? activeErrorMessage : undefined}
          isHeroScope={compareParams.isHeroScope}
          isTargetBaseline={compareParams.isTargetBaseline}
          subjectHero={{
            name: heroCompareQuery.data?.subject_hero?.name ?? leftHero?.name ?? "All heroes",
            imagePath: heroCompareQuery.data?.subject_hero?.image_path ?? leftHero?.image_path,
            dominantColor: heroCompareQuery.data?.subject_hero?.color ?? leftHero?.color,
            playtimeSeconds: heroCompareQuery.data?.left_playtime_seconds ?? 0,
            playtimeLabel: "Playtime"
          }}
          baselineHero={{
            name: heroCompareQuery.data?.target_hero?.name ?? rightHero?.name ?? "All heroes",
            imagePath: heroCompareQuery.data?.target_hero?.image_path ?? rightHero?.image_path,
            dominantColor: heroCompareQuery.data?.target_hero?.color ?? rightHero?.color,
            playtimeSeconds: heroCompareQuery.data?.right_playtime_seconds ?? 0,
            playtimeLabel: "Avg playtime"
          }}
        />
      ) : (
        <Card className="relative overflow-hidden">
          <GlassGlow />
          <div className="relative flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Users className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Select a user above to start comparing
            </p>
          </div>
        </Card>
      )}
    </div>
  );
};

export default Page;
