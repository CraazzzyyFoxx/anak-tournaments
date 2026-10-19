"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { PageStateCard } from "@/components/ui/page-state-card";
import { SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipSelect } from "@/components/ui/tooltip-select";
import type { SlotProps } from "@/disciplines/types";
import { analyticsQueryKeys } from "@/lib/analytics/query-keys";
import analyticsService from "@/services/analytics.service";

import { type GlossaryTerm } from "./analytics-glossary";
import { getPreferredAnalyticsAlgorithmId, sortAnalyticsAlgorithms, type KpiId } from "./analytics.helpers";
import styles from "./components/Analytics.module.css";
import BottomSheet, { type SheetState } from "./components/BottomSheet";
import HowItWorksCard from "./components/HowItWorksCard";
import KpiRail from "./components/KpiRail";
import MasterDetail from "./components/MasterDetail";
import OrganizerTools from "./components/OrganizerTools";
import { type StandingsMode } from "./components/StandingsList";
import VerdictBanner from "./components/VerdictBanner";
import { useAnalyticsViewModel } from "./useAnalyticsViewModel";

function parseId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Placeholder rows while a result loads (verdict + KPI cards, standings board, deep dive). */
export function AnalyticsBoardSkeleton() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[520px] rounded-lg" />
      <Skeleton className="h-12 rounded-lg" />
    </>
  );
}

/**
 * Overwatch's tournament analytics board (the `analytics` slot): the ranking-algorithm choice (`?algorithm=`), the
 * v1 shift result plus the permission-gated v2 ML reads, and the fan-facing verdict, KPIs and standings drawn from
 * them. Every read is keyed by this tournament (and owner workspace), with no placeholder: another tournament's
 * algorithms or result never stand in while this one's load, and the result is not requested until this
 * tournament's own algorithm list has confirmed the chosen id.
 */
export default function AnalyticsBoard({
  tournamentId,
  workspaceId,
  metadata,
  canReadV2,
  canUpdate,
  hero
}: Readonly<SlotProps["analytics"]>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations();

  const algorithmId = parseId(searchParams.get("algorithm"));

  const algorithmsQuery = useQuery({
    // Per tournament: each list carries that tournament's `has_data`, which picks the default.
    queryKey: analyticsQueryKeys.algorithms(tournamentId),
    queryFn: ({ signal }) => analyticsService.getAlgorithms(tournamentId, { signal })
  });
  const algorithms = useMemo(
    () => sortAnalyticsAlgorithms(algorithmsQuery.data?.results ?? []),
    [algorithmsQuery.data?.results]
  );
  const activeAlgorithm = algorithms.find((algorithm) => algorithm.id === algorithmId) ?? null;
  const preferredAlgorithmId = getPreferredAnalyticsAlgorithmId(algorithms);

  const analyticsQuery = useQuery({
    queryKey: analyticsQueryKeys.performance(workspaceId, tournamentId, algorithmId),
    queryFn: ({ signal }) => analyticsService.getAnalytics(tournamentId, algorithmId!, workspaceId, { signal }),
    enabled: activeAlgorithm !== null
  });
  const analytics = analyticsQuery.data;

  const { data: performanceRows } = useQuery({
    queryKey: analyticsQueryKeys.performanceV2(tournamentId),
    queryFn: ({ signal }) => analyticsService.getPerformanceV2(tournamentId, undefined, { signal }),
    enabled: canReadV2
  });
  const performanceByPlayer = useMemo(
    () => new Map((performanceRows ?? []).map((row) => [row.player_id, row])),
    [performanceRows]
  );

  // Monte Carlo standings distribution — woven into the team detail (and the
  // organizer table view); gated to analytics.read viewers.
  const { data: standingsRows } = useQuery({
    queryKey: analyticsQueryKeys.standingsDistribution(tournamentId),
    queryFn: ({ signal }) => analyticsService.getStandingsDistribution(tournamentId, undefined, { signal }),
    enabled: canReadV2,
    staleTime: 60_000
  });
  const distributionByTeam = useMemo(
    () => new Map((standingsRows ?? []).map((row) => [row.team_id, row])),
    [standingsRows]
  );

  // Fan-facing view model: per-player impact, the six KPIs, the verdict and the
  // group count. Derived from the public v1 payload (+ v2 impact when allowed).
  const viewModel = useAnalyticsViewModel(analytics, performanceByPlayer, canReadV2);

  // Glossary / how-it-works explainer sheet, opened by info dots + the help card.
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const explain = useCallback((term: GlossaryTerm) => setSheet({ kind: "term", term }), []);
  const showHow = useCallback(() => setSheet({ kind: "how" }), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  // Standings sort/filter is lifted so the KPI cards can drive it (triage folds
  // into the standings instead of a separate section).
  const [standingsMode, setStandingsMode] = useState<StandingsMode>("standings");
  const standingsRef = React.useRef<HTMLDivElement | null>(null);
  const onKpiSelect = useCallback((id: KpiId) => {
    setStandingsMode(id === "watch" ? "watch" : "movers");
    standingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // An absent or unknown ranking (e.g. one kept in the URL from another tournament) is replaced, without a history
  // entry, by this tournament's preferred one once its list has loaded.
  const replaceAlgorithm = algorithmsQuery.isSuccess && preferredAlgorithmId !== null && activeAlgorithm === null;
  useEffect(() => {
    if (!replaceAlgorithm) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("algorithm", String(preferredAlgorithmId));
    router.replace(`${pathname}?${next.toString()}`);
  }, [replaceAlgorithm, preferredAlgorithmId, pathname, router, searchParams]);

  const pushAlgorithm = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("algorithm", value);
    router.push(`${pathname}?${next.toString()}`);
  };

  const algorithmPicker = (
    <TooltipSelect
      tooltip={t("analytics.briefing.algorithm")}
      value={activeAlgorithm ? String(activeAlgorithm.id) : ""}
      placeholder={
        algorithmsQuery.isPending
          ? t("analytics.briefing.loadingAlgorithms")
          : algorithmsQuery.isError
            ? t("analytics.briefing.errorAlgorithms")
            : t("analytics.briefing.selectAlgorithm")
      }
      disabled={algorithmsQuery.isPending || algorithmsQuery.isError}
      className={styles.cPickAlgorithm}
      onValueChange={pushAlgorithm}
    >
      <SelectContent>
        <SelectGroup>
          {algorithms.map((item) => (
            <SelectItem key={item.id} value={item.id.toString()}>
              {item.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </TooltipSelect>
  );

  // One body per state, in priority order: a failed read outranks a pending one so a retry is offered instead of a
  // skeleton that will never resolve.
  const renderBody = () => {
    if (algorithmsQuery.isError) {
      return (
        <PageStateCard
          state="error"
          title={t("analytics.page.unavailable")}
          description={t("analytics.page.unavailableDesc")}
          onAction={() => void algorithmsQuery.refetch()}
        />
      );
    }
    if (algorithmsQuery.isPending || replaceAlgorithm) return <AnalyticsBoardSkeleton />;
    if (activeAlgorithm === null) {
      return (
        <PageStateCard
          state="empty"
          title={t("analytics.page.chooseParams")}
          description={t("analytics.page.chooseParamsDesc")}
        />
      );
    }
    if (analyticsQuery.isError) {
      return (
        <PageStateCard
          state="error"
          title={t("analytics.page.unavailable")}
          description={t("analytics.page.unavailableDesc")}
          onAction={() => void analyticsQuery.refetch()}
        />
      );
    }
    if (!analytics || !viewModel) return <AnalyticsBoardSkeleton />;
    if (analytics.teams.length === 0) {
      return (
        <PageStateCard
          state="empty"
          title={t("analytics.page.noTeams")}
          description={t("analytics.page.noTeamsDesc")}
        />
      );
    }
    return (
      <>
        <VerdictBanner verdict={viewModel.verdict} onExplain={explain} />
        <KpiRail kpis={viewModel.kpis} onExplain={explain} onSelect={onKpiSelect} />
        <div ref={standingsRef}>
          <MasterDetail
            key={`${tournamentId}-${algorithmId}`}
            tournamentId={tournamentId}
            teams={viewModel.teams}
            canReadV2={canReadV2}
            mode={standingsMode}
            onModeChange={setStandingsMode}
            performanceByPlayer={performanceByPlayer}
            distributionByTeam={distributionByTeam}
            ontology={metadata}
            onExplain={explain}
          />
        </div>
        <HowItWorksCard onOpen={showHow} />
      </>
    );
  };

  return (
    <>
      {hero({
        rankedBy: activeAlgorithm?.name,
        counts:
          analytics && viewModel
            ? {
                teams: analytics.summary.total_teams,
                players: analytics.summary.total_players,
                groups: viewModel.groupCount
              }
            : null,
        controls: algorithmPicker
      })}
      {canUpdate ? <OrganizerTools tournamentId={tournamentId} workspaceId={workspaceId} /> : null}
      {renderBody()}
      <BottomSheet state={sheet} onClose={closeSheet} />
    </>
  );
}
