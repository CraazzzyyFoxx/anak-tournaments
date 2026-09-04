"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { FilterChip, FilterChipGroup } from "@/components/ui/filter-chip";
import { cn } from "@/lib/utils";

import type { MapPoolStageView, MapPoolView } from "../_hooks/useTournamentMapPool";

export type MapPlayedCount = {
  played: number;
  /** Mean map duration in seconds, or null when no map has a recorded length. */
  avgDurationSec: number | null;
  /** Attack-side win share 0..1, or null for modes without an attacking side. */
  attackWinShare: number | null;
};

export type MapPoolProps = {
  pool: MapPoolView;
  /**
   * When stages play different pools, the caller passes them and the component
   * shows a stage switcher inside the card. `null` = one pool for the whole
   * tournament (the common case).
   */
  stages?: MapPoolStageView[] | null;
  /**
   * `tiles` — grid of mode columns with map names (overview, registration).
   * `summary` — one line of per-mode counts with a disclosure (overview, live).
   * `table` — every map as a row with played counts (statistics).
   */
  variant: "tiles" | "summary" | "table";
  /** Keyed by map id. Only read by the `table` variant. */
  playedCounts?: Record<number, MapPlayedCount>;
  /** Builds the "matches →" link for a map row; omit to hide the column. */
  matchesHref?: (mapId: number) => string;
  /** Anchor id so the header chip / redirects can deep-link. */
  id?: string;
  className?: string;
};

/**
 * The tournament's map pool in three densities, from one data shape.
 *
 * Replaces the standalone Maps tab: the pool is reference data (like rules and
 * format), not a section, so it lives as a card on the overview and as a table
 * with play counts under Statistics.
 */
export function MapPool({
  pool,
  stages = null,
  variant,
  playedCounts,
  matchesHref,
  id,
  className
}: Readonly<MapPoolProps>) {
  const t = useTranslations();
  const format = useFormatter();
  const [stageId, setStageId] = useState<number | null>(null);

  const shown =
    stages && stageId !== null ? (stages.find((s) => s.stageId === stageId)?.pool ?? pool) : pool;

  if (pool.total === 0) return null;

  const stageSwitcher =
    stages && stages.length > 1 ? (
      <FilterChipGroup label={t("tournamentDetail.mapPool.stageLabel")} className="mb-3">
        <FilterChip active={stageId === null} onClick={() => setStageId(null)}>
          {t("common.all")}
        </FilterChip>
        {stages.map((stage) => (
          <FilterChip
            key={stage.stageId}
            active={stageId === stage.stageId}
            count={stage.pool.total}
            onClick={() => setStageId(stage.stageId)}
          >
            {stage.title}
          </FilterChip>
        ))}
      </FilterChipGroup>
    ) : null;

  const title = t("tournamentDetail.mapPool.title", { count: shown.total });

  if (variant === "summary") {
    return (
      <details id={id} className={cn("group scroll-mt-28", className)}>
        <summary className="flex cursor-pointer list-none flex-col gap-1 [&::-webkit-details-marker]:hidden">
          <span className="aqt-card-title">{title}</span>
          <span className="font-mono text-[11px] uppercase leading-relaxed tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">
            {shown.byGamemode.map((g) => `${g.gamemode} ${g.maps.length}`).join(" · ")}
          </span>
        </summary>
        <div className="mt-3">
          {stageSwitcher}
          <Tiles pool={shown} />
        </div>
      </details>
    );
  }

  if (variant === "table") {
    return (
      <div id={id} className={cn("scroll-mt-28", className)}>
        {stageSwitcher}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--aqt-border)] font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--aqt-fg-faint)]">
                <th scope="col" className="py-2 pr-3 text-left font-medium">
                  {t("tournamentDetail.mapPool.col.map")}
                </th>
                <th scope="col" className="py-2 pr-3 text-left font-medium">
                  {t("tournamentDetail.mapPool.col.mode")}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t("tournamentDetail.mapPool.col.played")}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t("tournamentDetail.mapPool.col.avgDuration")}
                </th>
                <th scope="col" className="py-2 pr-3 text-left font-medium">
                  {t("tournamentDetail.mapPool.col.sides")}
                </th>
                {matchesHref ? (
                  <th scope="col" className="py-2">
                    <span className="sr-only">{t("common.matches")}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {shown.byGamemode.flatMap((group) =>
                group.maps.map((map) => {
                  const counts = playedCounts?.[map.id];
                  const played = counts?.played ?? 0;
                  const muted = played === 0;
                  return (
                    <tr
                      key={map.id}
                      className={cn(
                        "border-b border-[color:var(--aqt-border)]/60",
                        muted && "text-[color:var(--aqt-fg-dim)]"
                      )}
                    >
                      <td className={cn("py-2 pr-3", !muted && "font-semibold")}>{map.name}</td>
                      <td className="py-2 pr-3 text-[color:var(--aqt-fg-muted)]">
                        {group.gamemode}
                      </td>
                      <td className="aqt-tnum py-2 pr-3 text-right">{played}</td>
                      <td className="aqt-tnum py-2 pr-3 text-right">
                        {counts?.avgDurationSec != null
                          ? `${Math.floor(counts.avgDurationSec / 60)}:${String(Math.round(counts.avgDurationSec % 60)).padStart(2, "0")}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {counts?.attackWinShare != null ? (
                          <div
                            className="flex h-2 w-40 max-w-full overflow-hidden rounded-sm"
                            role="img"
                            aria-label={t("tournamentDetail.mapPool.attackShare", {
                              pct: format.number(counts.attackWinShare, {
                                style: "percent",
                                maximumFractionDigits: 0
                              })
                            })}
                          >
                            <span
                              className="bg-[color:var(--aqt-fg-muted)]"
                              style={{ width: `${Math.round(counts.attackWinShare * 100)}%` }}
                            />
                            <span className="flex-1 bg-[color:var(--aqt-border)]" />
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      {matchesHref ? (
                        <td className="py-2 text-right">
                          {played > 0 ? (
                            <Link
                              href={matchesHref(map.id)}
                              className="font-mono text-[11px] text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-teal)]"
                            >
                              {t("common.matches")} →
                            </Link>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div id={id} className={cn("scroll-mt-28", className)}>
      <h2 className="aqt-card-title mb-2">{title}</h2>
      {stageSwitcher}
      <Tiles pool={shown} />
    </div>
  );
}

function Tiles({ pool }: Readonly<{ pool: MapPoolView }>) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {pool.byGamemode.map((group) => (
        <div
          key={group.gamemode}
          className="rounded-md border border-dashed border-[color:var(--aqt-border)] px-2 py-1.5"
        >
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">
            {group.gamemode}
          </div>
          <ul className="space-y-0.5 text-xs">
            {group.maps.map((map) => (
              <li key={map.id} className="truncate" title={map.name}>
                {map.name}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
