"use client";

import { Suspense, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import AnalyticsPicker from "@/app/(site)/tournaments/analytics/components/AnalyticsPicker";
import TournamentHero from "@/app/(site)/tournaments/analytics/components/TournamentHero";
import styles from "@/app/(site)/tournaments/analytics/components/Analytics.module.css";
import { DisciplineWidget } from "@/disciplines/DisciplineWidget";
import { loadAnalyticsUI } from "@/disciplines/registry/analytics";
import type { AnalyticsHeroParts } from "@/disciplines/types";
import { useDisciplineMetadata, useDisciplines } from "@/hooks/useDisciplineMetadata";
import { useEntityWorkspace } from "@/hooks/useEntityWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import type { StatsScope } from "@/lib/site/stats-scope";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";
import tournamentService from "@/services/tournament.service";
import { useWorkspaceStore } from "@/stores/workspace.store";

function parseId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The tournament analytics page (P7 §7 `analytics` slot host). The page owns what is game-neutral: the tournament
 * picker (the viewing scope's tournaments of games that declare analytics), the selected tournament as owner (its
 * workspace and game metadata, never the browsing filter), the viewer's analytics permissions and the page shell.
 * The board itself — rankings, forecasts, standings — is the tournament's game module's. A game without an analytics
 * capability gets an explicit unsupported state and no analytics read.
 */
const AnalyticsPage = ({ scope }: Readonly<{ scope: StatsScope }>) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, canAccessPermission } = usePermissions();
  const t = useTranslations();
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);

  const tournamentId = parseId(searchParams.get("tournamentId"));

  // Resolve the selected tournament's owner without changing the viewing filter.
  const ownerQuery = useQuery({
    queryKey: tournamentQueryKeys.overview(tournamentId),
    queryFn: () => tournamentService.getPublicOverview(tournamentId!),
    enabled: tournamentId != null,
    staleTime: 5 * 60_000
  });
  const owner = ownerQuery.data;
  const ownerWorkspaceId = owner?.workspace_id ?? null;
  useEntityWorkspace(ownerWorkspaceId);
  const metadataQuery = useDisciplineMetadata(ownerWorkspaceId ?? "all", owner?.discipline ?? null);
  const metadata = metadataQuery.data;

  // The picker follows the viewing filter; the selected event keeps its owner.
  const pickerWorkspaceId = scope === "all" ? "all" : currentWorkspaceId;
  const tournamentsQuery = useQuery({
    queryKey: tournamentQueryKeys.byWorkspace(pickerWorkspaceId ?? "global"),
    queryFn: () => tournamentService.getAll(null, pickerWorkspaceId)
  });
  const gamesQuery = useDisciplines(pickerWorkspaceId ?? "all");
  // Offered (and opened by default): tournaments of the scope's ENABLED games that have an analytics board. A
  // disabled game's historical tournaments stay reachable only as an explicitly opened owner (by URL).
  const analyticsGames = useMemo(
    () =>
      new Set(
        (gamesQuery.data ?? []).filter((game) => game.enabled && game.capabilities.analytics).map((game) => game.code)
      ),
    [gamesQuery.data]
  );
  const offered = useMemo(
    () => (tournamentsQuery.data?.results ?? []).filter((tournament) => analyticsGames.has(tournament.discipline)),
    [tournamentsQuery.data?.results, analyticsGames]
  );
  const tournaments = useMemo(
    () => (owner && !offered.some((item) => item.id === owner.id) ? [owner, ...offered] : offered),
    [offered, owner]
  );
  const activeTournament = tournaments.find((tournament) => tournament.id === tournamentId) ?? null;

  const listsReady = tournamentsQuery.isSuccess && gamesQuery.isSuccess;
  const firstOfferedId = offered[0]?.id ?? null;
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    let changed = false;
    if (next.get("tab")) {
      next.delete("tab");
      changed = true;
    }
    if (tournamentId == null && listsReady && firstOfferedId !== null) {
      next.set("tournamentId", String(firstOfferedId));
      changed = true;
    }
    if (changed) router.replace(`${pathname}?${next.toString()}`);
  }, [pathname, router, searchParams, tournamentId, listsReady, firstOfferedId]);

  // Algorithm ids are global: a ranking picked for one tournament stays chosen for the next one when it has it
  // (the board replaces an id the new tournament's list does not offer).
  const pushTournamentId = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tournamentId", value);
    router.push(`${pathname}?${next.toString()}`);
  };

  const hero = (parts: AnalyticsHeroParts) => (
    <TournamentHero
      tournament={activeTournament}
      algorithmName={parts.rankedBy}
      totals={
        parts.counts && activeTournament ? { ...parts.counts, stages: activeTournament.stages?.length ?? 0 } : null
      }
      controlsSlot={
        <AnalyticsPicker
          tournaments={tournaments}
          tournamentId={tournamentId}
          loadingTournaments={tournamentsQuery.isPending || gamesQuery.isPending}
          isErrorTournaments={tournamentsQuery.isError || gamesQuery.isError}
          onTournamentChange={pushTournamentId}
          controls={parts.controls}
        />
      }
    />
  );

  const renderPage = () => {
    if (!listsReady && !tournamentsQuery.isError && !gamesQuery.isError) {
      return <AnalyticsContentSkeleton />;
    }
    if (tournamentId == null) {
      return (
        <PageStateCard
          state="empty"
          title={t("analytics.page.chooseParams")}
          description={t("analytics.page.chooseParamsDesc")}
        />
      );
    }
    if (ownerQuery.isError || metadataQuery.isError) {
      return (
        <PageStateCard
          state="error"
          title={t("analytics.page.unavailable")}
          description={t("analytics.page.unavailableDesc")}
          onAction={() => void (ownerQuery.isError ? ownerQuery.refetch() : metadataQuery.refetch())}
        />
      );
    }
    if (!owner || !metadata) return <AnalyticsContentSkeleton />;
    if (!metadata.discipline.capabilities.analytics) {
      return (
        <PageStateCard
          state="empty"
          title={t("analytics.page.unsupported", { game: metadata.discipline.name })}
          description={t("analytics.page.unsupportedDesc")}
        />
      );
    }
    return null;
  };

  const blocked = renderPage();
  return (
    <div className={cn(styles.surface, styles.cRoot)}>
      {blocked !== null || !owner || !metadata ? (
        <>
          {hero({})}
          {blocked}
        </>
      ) : (
        <DisciplineWidget
          discipline={metadata.discipline.code}
          load={loadAnalyticsUI}
          slot="analytics"
          capabilities={metadata.discipline.capabilities}
          requires="analytics"
          props={{
            tournamentId: owner.id,
            workspaceId: owner.workspace_id,
            metadata,
            // v2 ML reads (performance, Monte-Carlo distribution, match quality, SHAP) are permission-gated
            // server-side; gating the board's fetches keeps the public baseline from firing a 403.
            canReadV2: canAccessPermission("analytics.read", owner.workspace_id),
            canUpdate: hasPermission("analytics.update"),
            hero
          }}
          fallback={null}
          pending={
            <>
              {hero({})}
              <AnalyticsContentSkeleton />
            </>
          }
        />
      )}
    </div>
  );
};

const AnalyticsContentSkeleton = () => (
  <>
    {/* Needs-attention triage */}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-24 rounded-lg" />
      ))}
    </div>
    {/* Standings board */}
    <Skeleton className="h-[520px] rounded-lg" />
    {/* Deep dive (collapsed) */}
    <Skeleton className="h-12 rounded-lg" />
  </>
);

const AnalyticsPageFallback = () => (
  <div className={styles.surface}>
    <Card className="overflow-hidden">
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <div className="space-y-4">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-12 w-full max-w-2xl" />
          <Skeleton className="h-5 w-full max-w-xl" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-11 sm:col-span-2" />
        </div>
      </div>
    </Card>
    <AnalyticsContentSkeleton />
  </div>
);

const AnalyticsClient = ({ scope }: Readonly<{ scope: StatsScope }>) => (
  <Suspense fallback={<AnalyticsPageFallback />}>
    <AnalyticsPage scope={scope} />
  </Suspense>
);

export default AnalyticsClient;
