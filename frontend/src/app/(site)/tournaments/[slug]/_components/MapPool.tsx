"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { FilterChip, FilterChipGroup } from "@/components/ui/filter-chip";
import { cn } from "@/lib/utils";

import type { MapPoolScopeView, MapPoolSlotView, MapPoolView } from "../_hooks/useTournamentMapPool";

export type MapPlayedCount = {
  played: number;
  /** Mean map duration in seconds, or null when no map has a recorded length. */
  avgDurationSec: number | null;
};

export type MapPoolProps = {
  pool: MapPoolView;
  /**
   * The pools the organizer authored per stage and per round. The card then
   * shows a scope switcher, because a round's pool is the one a reader of a
   * given match actually plays on. `null` = one pool decides everything.
   */
  scopes?: MapPoolScopeView[] | null;
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

/** The block eyebrow shared with the overview's sections (wireframes §11). */
const EYEBROW =
  "aqt-mono block text-[12px] uppercase tracking-[0.06em] text-[color:var(--aqt-fg-faint)]";

/**
 * The tournament's map pool in three densities, from one data shape.
 *
 * Replaces the standalone Maps tab: the pool is reference data (like rules and
 * format), not a section, so it lives as a card on the overview and as a table
 * with play counts under Statistics.
 */
export function MapPool({
  pool,
  scopes = null,
  variant,
  playedCounts,
  matchesHref,
  id,
  className
}: Readonly<MapPoolProps>) {
  const t = useTranslations();
  const [scopeKey, setScopeKey] = useState<string | null>(null);

  const scope = scopeKey === null ? null : (scopes?.find((item) => item.key === scopeKey) ?? null);
  const shown = scope?.pool ?? pool;

  if (pool.total === 0) return null;

  // One chip row per stage, so a tournament that configures every round of two
  // stages (thirteen scopes is a real count) reads as two short rows of round
  // chips instead of a wall of "Playoff · Lower R3".
  const stageRows: { stageId: number; stageName: string; items: MapPoolScopeView[] }[] = [];
  for (const item of scopes ?? []) {
    const row = stageRows.at(-1);
    if (row?.stageId === item.stageId) row.items.push(item);
    else stageRows.push({ stageId: item.stageId, stageName: item.stageName, items: [item] });
  }

  const scopeSwitcher =
    scopes && scopes.length > 1 ? (
      <div className="mb-3 grid gap-1.5">
        <FilterChipGroup label={t("tournamentDetail.mapPool.scopeLabel")}>
          <FilterChip active={scopeKey === null} onClick={() => setScopeKey(null)}>
            {t("tournamentDetail.mapPool.wholeTournament")}
          </FilterChip>
        </FilterChipGroup>
        {stageRows.map((row) => (
          <div key={row.stageId} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className={cn(EYEBROW, "shrink-0")}>{row.stageName}</span>
            <FilterChipGroup label={row.stageName}>
              {row.items.map((item) => (
                <FilterChip
                  key={item.key}
                  active={scopeKey === item.key}
                  count={item.pool.total}
                  title={item.title}
                  onClick={() => setScopeKey(item.key)}
                >
                  {item.round ?? t("tournamentDetail.mapPool.wholeStage")}
                </FilterChip>
              ))}
            </FilterChipGroup>
          </div>
        ))}
      </div>
    ) : null;

  const title = t("tournamentDetail.mapPool.title", { count: shown.total });

  if (variant === "summary") {
    return (
      <details id={id} className={cn("group scroll-mt-28", className)}>
        <summary className="flex cursor-pointer list-none flex-col gap-1 [&::-webkit-details-marker]:hidden">
          <span className={EYEBROW}>{title}</span>
          <span className="font-mono text-[12px] uppercase leading-relaxed tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">
            {shown.byGamemode.map((g) => `${g.gamemode} ${g.maps.length}`).join(" · ")}
          </span>
        </summary>
        <div className="mt-3">
          {scopeSwitcher}
          <Tiles pool={shown} slots={scope?.slots ?? null} />
        </div>
      </details>
    );
  }

  if (variant === "table") {
    return (
      <div id={id} className={cn("scroll-mt-28", className)}>
        {scopeSwitcher}
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
      <h2 className={cn(EYEBROW, "mb-3")}>{title}</h2>
      {scopeSwitcher}
      <Tiles pool={shown} slots={scope?.slots ?? null} />
    </div>
  );
}

/**
 * Columns of map names. Grouped by game mode for a whole pool; by SERIES SLOT
 * when the scope is slot-mode, because there each list is the pool for exactly
 * one map of the series — merging them would claim maps can be played where
 * they cannot.
 */
function Tiles({
  pool,
  slots
}: Readonly<{ pool: MapPoolView; slots: MapPoolSlotView[] | null }>) {
  const t = useTranslations();
  const columns = slots
    ? slots.map((slot) => ({
        key: `slot-${slot.position}`,
        label: t("tournamentDetail.mapPool.slot", { n: slot.position }),
        maps: slot.maps
      }))
    : pool.byGamemode.map((group) => ({
        key: group.gamemode,
        label: group.gamemode,
        maps: group.maps
      }));

  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(8.5rem, 1fr))" }}
    >
      {columns.map((column) => (
        <div key={column.key} className="border-t border-[color:var(--aqt-border)] pt-1.5">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">
            {column.label}
          </div>
          <ul className="space-y-0.5 text-[13px]">
            {column.maps.map((map) => (
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
