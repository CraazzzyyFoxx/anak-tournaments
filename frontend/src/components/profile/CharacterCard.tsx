"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import CatalogEntityImage from "@/components/catalog/CatalogEntityImage";
import { Progress } from "@/components/ui/progress";
import { getWinrateColor } from "@/lib/colors";
import { formatPercent, formatSeconds } from "@/lib/format";
import type { CatalogEntityRead } from "@/types/catalog.types";
import type { UserMapCharacterStats } from "@/types/user.types";

export interface CharacterCardCell {
  label: string;
  value: string;
  color?: string;
}

/**
 * A character's hover card on a profile (design-book §11): portrait and name, then only the figures that are
 * present — a map's record (`mapStats`), the caller's `cells`, a playtime share — never a fabricated value. A game
 * module adds its own presentation through `subtitle` and `cells`.
 */
export default function CharacterCard({
  entity,
  subtitle,
  cells = [],
  mapStats,
  playtimeShare
}: Readonly<{
  entity: Pick<CatalogEntityRead, "name" | "image_path">;
  subtitle?: ReactNode;
  cells?: CharacterCardCell[];
  /** The player's record with this character on one map, and its share of that map's playtime. */
  mapStats?: UserMapCharacterStats;
  /** Share (0..1) of the player's total playtime; shown when no map is in view. */
  playtimeShare?: number | null;
}>) {
  const t = useTranslations();
  const shown: CharacterCardCell[] = mapStats
    ? [
        {
          label: t("common.heroStats.winrate"),
          value: formatPercent(mapStats.win_rate, 0),
          color: getWinrateColor(mapStats.win_rate)
        },
        { label: t("common.heroStats.games"), value: String(mapStats.games) },
        { label: t("common.heroStats.record"), value: `${mapStats.win}-${mapStats.loss}-${mapStats.draw}` }
      ]
    : cells;
  const share = playtimeShare != null && Number.isFinite(playtimeShare) ? playtimeShare : null;
  const mapShare = mapStats ? Math.max(0, Math.min(100, mapStats.playtime_share_on_map * 100)) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <CatalogEntityImage entity={entity} size="lg" decorative />
        <div className="min-w-0">
          <div className="aqt-display truncate text-ui font-bold text-[color:var(--aqt-fg)]">{entity.name}</div>
          {subtitle}
        </div>
      </div>

      {shown.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {shown.map((cell) => (
            <div key={cell.label} className="rounded-[7px] border border-[color:var(--aqt-border)] px-2 py-1.5">
              <div className="aqt-tnum text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
                {cell.label}
              </div>
              <div className="aqt-tnum text-ui font-bold tabular-nums" style={{ color: cell.color ?? "var(--aqt-fg)" }}>
                {cell.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {mapStats && mapShare != null ? (
        <div className="border-t border-[color:var(--aqt-border)] pt-2">
          <div className="flex items-center justify-between">
            <span className="aqt-tnum text-label uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
              {t("common.heroStats.playtimeOnMap")}
            </span>
            <span className="aqt-tnum text-label font-bold tabular-nums text-[color:var(--aqt-fg)]">
              {formatSeconds(mapStats.playtime_seconds)} · {mapShare.toFixed(0)}%
            </span>
          </div>
          <div className="mt-2">
            <Progress value={mapShare} aria-label={t("common.heroStats.playtimeOnMap")} />
          </div>
          <div className="mt-2 text-label text-[color:var(--aqt-fg-faint)]">{t("common.heroStats.countedNote")}</div>
        </div>
      ) : null}

      {!mapStats && share != null ? (
        <div
          className={`flex items-center justify-between ${
            shown.length > 0 ? "border-t border-[color:var(--aqt-border)] pt-2" : ""
          }`}
        >
          <span className="aqt-tnum text-label uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
            {t("users.heroes.playtimeShare")}
          </span>
          <span className="aqt-tnum text-label font-bold tabular-nums text-[color:var(--aqt-fg)]">
            {(share * 100).toFixed(0)}%
          </span>
        </div>
      ) : null}

      {shown.length === 0 && share == null && !mapStats ? (
        <span className="aqt-tnum text-label text-[color:var(--aqt-fg-faint)]">{t("users.heroes.noStats")}</span>
      ) : null}
    </div>
  );
}
