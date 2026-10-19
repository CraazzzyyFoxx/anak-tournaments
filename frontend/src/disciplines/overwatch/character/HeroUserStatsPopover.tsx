"use client";

import { useTranslations } from "next-intl";

import CharacterCard, { type CharacterCardCell } from "@/components/profile/CharacterCard";
import { characterClass } from "@/lib/catalog/attrs";
import { getWinrateColor } from "@/lib/colors";
import type { CatalogEntityRead } from "@/types/catalog.types";
import type { DisciplineMetadata } from "@/types/discipline.types";
import type { CharacterStat, UserMapCharacterStats } from "@/types/user.types";

import { LogStatsName } from "../stat-names";
import { useHeroClass } from "./classes";

type HeroPopoverStat = Pick<CharacterStat, "name" | "avg_10">;

// Winrate can arrive as a 0..1 fraction or an already-scaled percent; normalize.
const toFraction = (value: number | null | undefined): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  return value <= 1 ? value : value / 100;
};

const avg10 = (stats: HeroPopoverStat[] | undefined, name: LogStatsName): number | null => {
  const stat = stats?.find((s) => s.name === name);
  return stat && Number.isFinite(stat.avg_10) ? stat.avg_10 : null;
};

const compact = (value: number): string =>
  Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0);

interface Props {
  entity: Pick<CatalogEntityRead, "name" | "image_path" | "attrs">;
  metadata: DisciplineMetadata;
  /** Per-hero aggregate stats (Winrate, KDA and Dmg/10 are read). Optional — sources without per-hero win/kda
   *  omit it and the card degrades to the hero identity + playtime share. */
  stats?: HeroPopoverStat[];
  /** Normalized playtime share in [0, 1], shown when stats aren't available. */
  playtimeShare?: number | null;
  /** Map-scoped aggregate (Maps tab): winrate / games / W-L-D plus the hero's playtime share of that map. */
  mapStats?: UserMapCharacterStats;
}

/**
 * Overwatch's hero hover card (design-book §11; the profile's `characterPopover` slot): the hero's class glyph and
 * name, then Winrate / KDA / Dmg-10 — or the map-scoped record. Only stats that are present render.
 */
const HeroUserStatsPopover = ({ entity, metadata, stats, playtimeShare, mapStats }: Props) => {
  const t = useTranslations();
  const heroClass = useHeroClass(metadata);
  const cls = characterClass(entity);
  const icon = heroClass.icon(cls, 13);

  const cells: CharacterCardCell[] = [];
  const winFrac = toFraction(avg10(stats, LogStatsName.Winrate));
  if (winFrac != null) {
    cells.push({
      label: t("users.heroes.quick.winrate"),
      value: `${(winFrac * 100).toFixed(0)}%`,
      color: getWinrateColor(winFrac)
    });
  }
  const kda = avg10(stats, LogStatsName.KDA);
  if (kda != null) cells.push({ label: t("users.heroes.quick.kda"), value: kda.toFixed(2) });
  const dmg = avg10(stats, LogStatsName.HeroDamageDealt);
  if (dmg != null) cells.push({ label: t("users.heroes.quick.dmg10"), value: compact(dmg) });

  return (
    <CharacterCard
      entity={entity}
      subtitle={
        icon ? (
          <div className="mt-0.5 flex items-center gap-1.5" style={{ color: heroClass.color(cls) }}>
            {icon}
            <span className="aqt-tnum text-label font-bold uppercase tracking-label">{heroClass.label(cls)}</span>
          </div>
        ) : null
      }
      cells={cells}
      mapStats={mapStats}
      playtimeShare={playtimeShare}
    />
  );
};

export default HeroUserStatsPopover;
