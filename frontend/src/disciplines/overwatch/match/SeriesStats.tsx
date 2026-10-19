"use client";

import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";

import { useFormatter } from "@/lib/datetime/client";
import PlayerName from "@/components/PlayerName";
import { PerformanceBadge } from "@/components/PerformanceBadge";
import TeamName from "@/components/TeamName";
import { HeroStrip } from "@/components/hero/HeroImage";
import { Skeleton } from "@/components/ui/skeleton";
import type { SlotProps } from "@/disciplines/types";
import { LogStatsName } from "@/types/stats.types";
import styles from "@/components/match/EncounterDetail.module.css";
import {
  COLUMN_PRESETS,
  STAT_META,
  formatStat,
  playerStat,
  columnMaxima,
  GROUP_COLOR,
  type MatchStatsPlayer
} from "./stats";
import { aggregateSeriesStats, type SeriesAggregate } from "./series";
import TeamComparison from "./TeamComparison";
import Leaders from "./Leaders";

// Same chart, same reason as `MatchStats`: recharts only loads once the
// series stats are on screen. The placeholder holds the chart's minimum height
// so the stats grid does not reflow under it.
const ContributionChart = dynamic(() => import("./ContributionChart"), {
  ssr: false,
  loading: () => <Skeleton className="h-70 w-full rounded-lg" />
});

/**
 * The Overwatch series statistics of an encounter's duel maps: side comparison and leaders (`overview`), or the
 * per-player totals grouped by participation (`players`). The host renders it only when every loaded match is a
 * duel.
 */
export default function SeriesStats({ matches, view }: Readonly<SlotProps["seriesStats"]>) {
  // Folded on every render rather than memoized: the fold is a few thousand additions, and a manual `useMemo`
  // keyed on the host's per-render array would defeat the React Compiler.
  const aggregate = aggregateSeriesStats(matches);
  if (!aggregate) return null;

  const [home, away] = aggregate.participations;
  const isDuel = aggregate.participations.length === 2;

  return view === "overview" && isDuel ? (
    <div className={styles.statsGrid}>
      <TeamComparison home={home} away={away} round={aggregate.round} />
      <Leaders
        home={home}
        away={away}
        round={aggregate.round}
        gridClassName="sm:grid-cols-3 xl:grid-cols-2"
      />
    </div>
  ) : (
    <>
      <SeriesPlayerTable aggregate={aggregate} />
      {isDuel ? <ContributionChart home={home} away={away} round={aggregate.round} /> : null}
    </>
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
                    {" · "}
                    {t("encounters.history.participation", { id: participation.id })}
                    {participation.live === false
                      ? ` · ${t("encounters.history.retiredParticipation")}`
                      : null}
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
        <PlayerName
          player={player}
          profileName={player.profile_name}
          includeSpecialization={false}
        />
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
