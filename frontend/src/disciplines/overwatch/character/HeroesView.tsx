"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/lib/datetime/client";
import type { SlotProps } from "@/disciplines/types";
import type { CharacterWithUserStats } from "@/types/user.types";
import { LogStatsName, getHumanizedStats } from "../stat-names";
import { characterClass } from "@/lib/catalog/attrs";
import { CardSurface } from "@/components/profile/atoms";
import { formatPercent } from "@/lib/format";
import { LOW_SAMPLE_GAMES } from "@/lib/colors";
import { computeDelta, formatDelta, formatStatValue, getOverall, heroWinrate, isRevertedStat } from "./utils";
import HeroRadar, { RADAR_STATS, type RadarPoint } from "./HeroRadar";
import HeroSpotlight, { QUICK_CANDIDATES } from "./HeroSpotlight";
import HeroStatsTable, { type StatSortKey } from "./HeroStatsTable";
import MapsForHero from "./MapsForHero";
import HeroRail, { type HeroRow } from "./HeroRail";
import HeroBestGames from "./HeroBestGames";
import RadarAxisPicker from "./RadarAxisPicker";
import { Eyebrow } from "@/components/ui/eyebrow";
import { FilterChip, FilterChipGroup } from "@/components/ui/filter-chip";

/** Overwatch's characters tab (the profile's `characterStats` slot). */
const HeroesView = ({ characters, filterSlot, maps, metadata }: SlotProps["characterStats"]) => {
  const t = useTranslations();
  const format = useFormatter();
  const safeHeroes = Array.isArray(characters) ? characters : [];

  // Compact label for spotlight quick-stats (falls back to humanized stat name).
  const quickLabel = useCallback(
    (name: LogStatsName): string => {
      switch (name) {
        case LogStatsName.Winrate:
          return t("users.heroes.quick.winrate");
        case LogStatsName.KDA:
          return t("users.heroes.quick.kda");
        case LogStatsName.HeroDamageDealt:
          return t("users.heroes.quick.dmg10");
        case LogStatsName.Eliminations:
          return t("users.heroes.quick.elims10");
        default:
          return getHumanizedStats(name);
      }
    },
    [t]
  );

  const items = useMemo(() => {
    return safeHeroes
      .map((h) => ({
        hero: h,
        playtime: getOverall(h, LogStatsName.HeroTimePlayed)
      }))
      .sort((a, b) => b.playtime - a.playtime);
  }, [safeHeroes]);

  const totalSeconds = items.reduce((sum, i) => sum + i.playtime, 0);
  const enriched = items.map((i) => ({
    ...i,
    share: totalSeconds > 0 ? i.playtime / totalSeconds : 0
  }));

  const [selectedId, setSelectedId] = useState<number>(enriched[0]?.hero.character.id ?? 0);
  const [insightsMode, setInsightsMode] = useState<"highlights" | "all">("highlights");
  const [statSort, setStatSort] = useState<StatSortKey>("delta");
  const [statSearch, setStatSearch] = useState("");
  const [radarStats, setRadarStats] = useState<LogStatsName[]>(RADAR_STATS);

  const selected = useMemo(() => enriched.find((i) => i.hero.character.id === selectedId) ?? enriched[0], [enriched, selectedId]);

  // Cross-hero overview rows (one per tracked hero) for the leaderboard table.
  const overviewRows = useMemo<HeroRow[]>(() => {
    const avg = (stats: CharacterWithUserStats["stats"], name: LogStatsName) => {
      const v = stats.find((s) => s.name === name)?.avg_10;
      return v != null && Number.isFinite(v) ? v : null;
    };
    return enriched.map((it) => {
      const stats = it.hero.stats;
      const wr = heroWinrate(it.hero);
      let positive = 0;
      let total = 0;
      for (const s of stats) {
        if (s.name === LogStatsName.HeroTimePlayed) continue;
        if (!Number.isFinite(s.avg_10) || !Number.isFinite(s.avg_10_all) || s.avg_10_all <= 0) continue;
        total++;
        if (isRevertedStat(s.name) ? s.avg_10 < s.avg_10_all : s.avg_10 > s.avg_10_all) positive++;
      }
      return {
        id: it.hero.character.id,
        hero: it.hero.character,
        role: characterClass(it.hero.character),
        playtime: it.playtime,
        share: it.share,
        winratePct: wr == null ? null : wr * 100,
        kda: avg(stats, LogStatsName.KDA),
        dmg10: avg(stats, LogStatsName.HeroDamageDealt),
        impact: total > 0 ? positive / total : 0
      };
    });
  }, [enriched]);

  // Build radar data for the selected hero (you vs global) over the chosen
  // axes. Stats the hero has no data for are dropped (no phantom 0-axis).
  const radarData = useMemo(() => {
    if (!selected) return null;
    const points = radarStats
      .map((statName) => {
        const stat = selected.hero.stats.find((s) => s.name === statName);
        if (!stat || !Number.isFinite(stat.avg_10) || !Number.isFinite(stat.avg_10_all) || stat.avg_10_all <= 0) {
          return null;
        }
        // Normalize: scale relative to max(you, global)
        const max = Math.max(stat.avg_10, stat.avg_10_all, 1);
        let you = stat.avg_10 / max;
        let global = stat.avg_10_all / max;
        if (isRevertedStat(statName)) {
          you = 1 - you;
          global = 1 - global;
        }
        return { stat: statName, you, global };
      })
      .filter((p): p is RadarPoint => p !== null);
    return points.length >= 3 ? points : null;
  }, [selected, radarStats]);

  // Stats that can be plotted on the radar for the selected hero (have data).
  const radarCandidates = useMemo(() => {
    if (!selected) return [] as LogStatsName[];
    return selected.hero.stats
      .filter((s) => s.name !== LogStatsName.HeroTimePlayed)
      .filter((s) => Number.isFinite(s.avg_10) && Number.isFinite(s.avg_10_all) && s.avg_10_all > 0)
      .map((s) => s.name as LogStatsName);
  }, [selected]);

  const toggleRadarStat = (name: LogStatsName) => {
    setRadarStats((prev) => {
      if (prev.includes(name)) {
        // Keep at least 3 axes so the radar stays a polygon.
        return prev.length <= 3 ? prev : prev.filter((s) => s !== name);
      }
      // Cap at 8 axes to keep the chart legible.
      return prev.length >= 8 ? prev : [...prev, name];
    });
  };

  // Insights rows
  const insightsRows = useMemo(() => {
    if (!selected) return [];
    return selected.hero.stats
      .filter((s) => s.name !== LogStatsName.HeroTimePlayed)
      .filter((s) => Number.isFinite(s.avg_10) && Number.isFinite(s.avg_10_all) && s.avg_10_all > 0)
      .map((s) => {
        const reversed = isRevertedStat(s.name);
        const delta = computeDelta(s.avg_10, s.avg_10_all, reversed) ?? 0;
        return {
          name: s.name as LogStatsName,
          label: getHumanizedStats(s.name as LogStatsName),
          value: formatStatValue(format, s.name, s.avg_10),
          delta
        };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 8);
  }, [selected, format]);

  // Spotlight quick-stats (Winrate / KDA / Dmg10 …) with delta vs global.
  const quickStats = useMemo(() => {
    if (!selected) return [];
    const hero = selected.hero;
    const out: { name: LogStatsName; label: string; value: string; delta: number | null }[] = [];
    for (const name of QUICK_CANDIDATES) {
      if (name === LogStatsName.Winrate) {
        // The winrate is the hero's game record, not a logged stat; its delta is in points and needs a sample.
        const wr = heroWinrate(hero);
        if (wr == null) continue;
        const delta = hero.games >= LOW_SAMPLE_GAMES && hero.win_rate_all != null ? wr - hero.win_rate_all : null;
        out.push({ name, label: quickLabel(name), value: formatPercent(wr, 0), delta });
      } else {
        const stat = hero.stats.find((s) => s.name === name);
        if (!stat || !Number.isFinite(stat.avg_10)) continue;
        const delta = computeDelta(stat.avg_10, stat.avg_10_all, isRevertedStat(name));
        out.push({ name, label: quickLabel(name), value: formatStatValue(format, name, stat.avg_10), delta });
      }
      if (out.length === 4) break;
    }
    return out;
  }, [selected, quickLabel, format]);

  // Full per-stat comparison table (All stats mode).
  const allStatsRows = useMemo(() => {
    if (!selected) return [];
    const q = statSearch.trim().toLowerCase();
    let rows = selected.hero.stats
      .filter((s) => s.name !== LogStatsName.HeroTimePlayed)
      .map((s) => {
        const reversed = isRevertedStat(s.name);
        const delta = computeDelta(s.avg_10, s.avg_10_all, reversed);
        const isRecord =
          s.best_all != null &&
          Number.isFinite(s.best?.value) &&
          Number.isFinite(s.best_all.value) &&
          s.best.value === s.best_all.value;
        return {
          name: s.name as LogStatsName,
          label: getHumanizedStats(s.name as LogStatsName),
          overall: s.overall,
          bestYou: s.best?.value,
          avg10: s.avg_10,
          delta,
          bestAll: s.best_all?.value ?? null,
          global10: s.avg_10_all,
          isRecord
        };
      });
    if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q));
    rows.sort((a, b) => {
      if (statSort === "name") return a.label.localeCompare(b.label);
      if (statSort === "overall") return (b.overall ?? 0) - (a.overall ?? 0);
      if (statSort === "avg10") return (b.avg10 ?? 0) - (a.avg10 ?? 0);
      return Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
    });
    return rows;
  }, [selected, statSearch, statSort]);

  // Maps the selected hero was played on, with the user's record on each.
  const heroMaps = useMemo(() => {
    if (!selected || !maps || maps.length === 0) return [];
    const heroId = selected.hero.character.id;
    const rows = maps
      .map((m) => {
        const hs = (m.character_stats ?? []).find((h) => h.character.id === heroId);
        return hs ? { id: m.map.id, name: m.map.name, mode: m.map.parent?.name ?? "—", winRate: hs.win_rate, win: hs.win, loss: hs.loss } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    rows.sort((a, b) => b.winRate - a.winRate || b.win + b.loss - (a.win + a.loss));
    return rows;
  }, [selected, maps]);

  if (!selected) {
    return (
      <div className="aqt-player">
        <CardSurface>
          <div className="py-10 text-center text-(--aqt-fg-dim)">{t("users.heroes.noStats")}</div>
        </CardSurface>
      </div>
    );
  }

  return (
    <div className="aqt-player flex flex-col gap-3.5">
      {/* Sticky hero rail (cross-hero compare) + detail, side by side so
          switching heroes never requires a long scroll up/down. */}
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1fr_360px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-3.5">
          {/* Spotlight */}
          <HeroSpotlight selected={selected} metadata={metadata} quickStats={quickStats} />

          {/* Radar + insights */}
          <CardSurface
            title={t("users.heroes.insights")}
            subtitle={t("users.heroes.insightsSubtitle", { hero: selected.hero.character.name })}
            action={
              <>
                {filterSlot ? <div className="flex justify-end">{filterSlot}</div> : null}
                <FilterChipGroup label={t("common.filters")} className="mb-0!">
                  <FilterChip
                    active={insightsMode === "highlights"}
                    onClick={() => setInsightsMode("highlights")}
                  >
                    {t("users.heroes.highlights")}
                  </FilterChip>
                  <FilterChip
                    active={insightsMode === "all"}
                    count={allStatsRows.length}
                    onClick={() => setInsightsMode("all")}
                  >
                    {t("users.heroes.allStats")}
                  </FilterChip>
                </FilterChipGroup>
              </>
            }
          >
            {insightsMode === "highlights" ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
              <div className="flex flex-col gap-2.5">
                <HeroRadar radarData={radarData} />
                {radarCandidates.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <Eyebrow className="text-center">{t("users.heroes.radarAxes")}</Eyebrow>
                    <RadarAxisPicker selected={radarStats} candidates={radarCandidates} onToggle={toggleRadarStat} />
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-x-6 self-start sm:grid-cols-2">
                {insightsRows.map((row) => (
                  <div
                    key={row.name}
                    className="flex items-center justify-between gap-3 border-b border-[color:var(--aqt-border)] py-2.5 last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-label text-(--aqt-fg-muted)">{row.label}</span>
                    <span className="ml-auto aqt-tnum text-body font-semibold text-(--aqt-fg)">{row.value}</span>
                    <span
                      className="aqt-tnum w-12 shrink-0 text-right text-label font-bold"
                      style={{ color: row.delta >= 0 ? "var(--aqt-emerald)" : "var(--aqt-rose)" }}
                    >
                      {formatDelta(row.delta)}
                    </span>
                  </div>
                ))}
                {insightsRows.length === 0 ? (
                  <div className="col-span-2 py-6 text-center text-caption text-(--aqt-fg-dim)">
                    {t("users.heroes.notEnoughData")}
                  </div>
                ) : null}
              </div>
            </div>
            ) : (
              <HeroStatsTable
                rows={allStatsRows}
                sort={statSort}
                onSortChange={setStatSort}
                search={statSearch}
                onSearchChange={setStatSearch}
              />
            )}
          </CardSurface>

          {/* Career-best single-game performances for the selected hero */}
          <HeroBestGames hero={selected.hero} />

          {/* Maps the selected hero was played on (best → worst) */}
          <MapsForHero heroName={selected.hero.character.name} heroMaps={heroMaps} />
        </div>
        <HeroRail
          rows={overviewRows}
          selectedId={selected.hero.character.id}
          onSelect={setSelectedId}
          metadata={metadata}
        />
      </div>
    </div>
  );
};

export default HeroesView;
