"use client";

import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useFormatter } from "@/lib/datetime/client";

import { cn } from "@/lib/utils";
import { PageStateCard } from "@/components/ui/page-state-card";
import PlayerName from "@/components/PlayerName";
import { PerformanceBadge } from "@/components/PerformanceBadge";
import TeamName from "@/components/TeamName";
import { HeroStrip } from "@/components/hero/HeroImage";
import MatchTeamComparison from "@/app/(site)/matches/[id]/components/MatchTeamComparison";
import MatchLeaders from "@/app/(site)/matches/[id]/components/MatchLeaders";
import { Skeleton } from "@/components/ui/skeleton";
import encounterService from "@/services/encounter.service";
import type { MatchWithStats } from "@/types/encounter.types";
import { LogStatsName } from "@/types/stats.types";
import {
  COLUMN_PRESETS,
  STAT_META,
  formatStat,
  playerStat,
  columnMaxima,
  GROUP_COLOR,
  type MatchStatsPlayer
} from "@/lib/match-stats";
import { aggregateSeriesStats, type SeriesAggregate } from "@/lib/encounter/detail";
import styles from "@/components/match/EncounterDetail.module.css";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";

// Same chart, same reason as `MatchStatsSection`: recharts only loads once the
// series stats are on screen. The placeholder holds the chart's minimum height
// so the stats grid does not reflow under it.
const MatchContributionChart = dynamic(
  () => import("@/app/(site)/matches/[id]/components/MatchContributionChart"),
  { ssr: false, loading: () => <Skeleton className="h-70 w-full rounded-lg" /> }
);

interface EncounterSeriesStatsProps {
  matchIds: number[];
  /** `overview`: compare observed sides; `players`: totals grouped by participation. */
  view: "overview" | "players";
}

export default function EncounterSeriesStats({
  matchIds,
  view
}: Readonly<EncounterSeriesStatsProps>) {
  const t = useTranslations();

  const queries = useQueries({
    queries: matchIds.map((id) => ({
      queryKey: encounterQueryKeys.matchDetail(id),
      queryFn: () => encounterService.getMatch(id),
      staleTime: 5 * 60_000
    }))
  });

  const loaded = queries
    .map((query) => query.data)
    .filter((data): data is MatchWithStats => data != null);
  const isLoading = queries.some((query) => query.isPending);
  const failedAll = queries.length > 0 && queries.every((query) => query.isError);

  // Folded on every render rather than memoized: `useQueries` hands back a new
  // array each time, so a manual `useMemo` could not be keyed on it without
  // defeating the React Compiler — and the fold is a few thousand additions.
  const aggregate = aggregateSeriesStats(loaded);

  if (failedAll) {
    return (
      <PageStateCard
        state="error"
        onAction={() => queries.forEach((query) => void query.refetch())}
      />
    );
  }

  if (!aggregate) {
    return isLoading ? <SeriesStatsSkeleton /> : <PageStateCard state="empty" />;
  }

  const partial = loaded.length < matchIds.length;
  const [home, away] = aggregate.participations;
  const isDuel = aggregate.participations.length === 2;

  return (
    <div className={styles.statsStack}>
      {partial ? (
        <output className={cn("block", styles.card, styles.cardBody, styles.statsNotice)}>
          {t("encounters.detail.statsPartial", {
            counted: loaded.length,
            total: matchIds.length
          })}
        </output>
      ) : null}

      {view === "overview" && isDuel ? (
        <div className={styles.statsGrid}>
          <MatchTeamComparison home={home} away={away} round={aggregate.round} />
          <MatchLeaders
            home={home}
            away={away}
            round={aggregate.round}
            gridClassName="sm:grid-cols-3 xl:grid-cols-2"
          />
        </div>
      ) : (
        <>
          <SeriesPlayerTable aggregate={aggregate} />
          {isDuel ? (
            <MatchContributionChart home={home} away={away} round={aggregate.round} />
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Per-player series totals. Uses the same `overview` column preset as the
 * per-map tables so a reader moving between the two compares like with like.
 */
function SeriesPlayerTable({
  aggregate
}: Readonly<{
  aggregate: SeriesAggregate;
}>) {
  const t = useTranslations();
  const columns = COLUMN_PRESETS.overview;
  const maxima = columnMaxima(
    { players: aggregate.participations.flatMap((participation) => participation.players) },
    null,
    aggregate.round,
    columns
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{t("encounters.detail.seriesTableTitle")}</h3>
        <span className={styles.cardSub}>{t("encounters.detail.seriesTableSub")}</span>
      </div>
      <div
        className={styles.seriesScroll}
        tabIndex={0}
        role="group"
        aria-label={t("encounters.detail.seriesTableTitle")}
      >
        <table className={styles.seriesTable}>
          <thead>
            <tr>
              <th scope="col">{t("encounters.team.colName")}</th>
              <th scope="col">{t("common.heroes")}</th>
              <th scope="col" title={t("encounters.detail.colMapsTitle")}>
                {t("encounters.detail.colMaps")}
              </th>
              <th scope="col">{t("matches.stats.rating")}</th>
              {columns.map((name) => {
                const meta = STAT_META[name];
                return (
                  <th
                    key={name}
                    scope="col"
                    title={t(meta.labelKey as never)}
                    aria-label={t(meta.labelKey as never)}
                  >
                    {meta.abbr}
                  </th>
                );
              })}
            </tr>
          </thead>
          {aggregate.participations.map((participation) => (
            <tbody key={participation.id}>
              <tr className={styles.seriesSideHead}>
                <td colSpan={4 + columns.length}>
                  <TeamName
                    team={{ name: participation.name, image_url: participation.team?.image_url }}
                    size="xs"
                  />
                  <span className={styles.cardSub}>
                    {" · "}{t("encounters.history.participation", { id: participation.id })}
                    {!participation.active ? ` · ${t("encounters.history.retiredParticipation")}` : null}
                  </span>
                </td>
              </tr>
              {participation.players.map((player) => (
                <SeriesPlayerRow
                  key={player.workspace_member_id}
                  player={player}
                  round={aggregate.round}
                  columns={columns}
                  maxima={maxima}
                  mapsPlayed={participation.meta[player.workspace_member_id]?.mapsPlayed ?? 0}
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

function SeriesPlayerRow({
  player,
  round,
  columns,
  maxima,
  mapsPlayed
}: Readonly<{
  player: MatchStatsPlayer;
  round: number;
  columns: LogStatsName[];
  maxima: Record<string, number>;
  mapsPlayed: number;
}>) {
  const heroes = player.heroes?.[round] ?? [];
  const placement = player.stats?.[round]?.[LogStatsName.Performance];

  return (
    <tr>
      <td className={styles.seriesPlayerCell}>
        {player.user_id != null ? (
          <PlayerName player={player} includeSpecialization={false} />
        ) : (
          <span title={player.name}>{player.name}</span>
        )}
      </td>
      <td>
        <span className={styles.rosterCell}>
          <HeroStrip heroes={heroes} size="sm" limit={6} />
        </span>
      </td>
      <td>{mapsPlayed > 0 ? mapsPlayed : "—"}</td>
      <td className={styles.seriesRatingCell}>
        <span className={styles.seriesRating}>
          <PerformanceBadge performance={placement ?? null} />
        </span>
      </td>
      {columns.map((name) => (
        <SeriesStatCell
          key={name}
          name={name}
          value={playerStat(player, round, name)}
          max={maxima[name] ?? 0}
        />
      ))}
    </tr>
  );
}

/** Value plus the same 3px magnitude bar the per-map tables draw. */
function SeriesStatCell({
  name,
  value,
  max
}: Readonly<{ name: LogStatsName; value: number; max: number }>) {
  const format = useFormatter();
  const meta = STAT_META[name];
  const showBar = meta?.bar && max > 0;

  return (
    <td>
      <span className="inline-flex flex-col items-end gap-1">
        <span>{formatStat(name, value, format)}</span>
        {showBar ? (
          <span
            aria-hidden
            className="h-[3px] w-10 overflow-hidden rounded-full bg-[color:var(--aqt-overlay-3)]"
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.min(100, (value / max) * 100)}%`,
                background: GROUP_COLOR[meta.group]
              }}
            />
          </span>
        ) : null}
      </span>
    </td>
  );
}

function SeriesStatsSkeleton() {
  return (
    <div className={styles.statsStack} aria-busy>
      <span className={cn(styles.skeleton, "h-[68px] w-full")} />
      <div className={styles.statsGrid}>
        <span className={cn(styles.skeleton, "h-[320px] w-full")} />
        <span className={cn(styles.skeleton, "h-[320px] w-full")} />
      </div>
      <span className={cn(styles.skeleton, "h-[120px] w-full")} />
      <span className={cn(styles.skeleton, "h-[420px] w-full")} />
    </div>
  );
}

export type { EncounterSeriesStatsProps };
