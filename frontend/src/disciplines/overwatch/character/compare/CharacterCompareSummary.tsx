"use client";

import { useTranslations } from "next-intl";

import { HeroStat } from "@/components/site/PageHero";
import type { CharacterCompareProps } from "@/disciplines/types";
import { characterClass } from "@/lib/catalog/attrs";

import { atSampleFloor } from "./board";
import { COL, getSignatureKey } from "./stat-columns";
import { useCharacterLeaderboard } from "./useCharacterLeaderboard";

/** The headline's short name for each class's signature stat ("Top healing"); the board's column labels carry "/ 10". */
const SIGNATURE_LABEL = {
  per10_healing: "users.heroesCompare.hero.healing",
  per10_damage_blocked: "users.heroesCompare.hero.blocked",
  per10_damage: "users.heroesCompare.hero.damage"
} as const;

/** A battletag cannot wrap: it is cut to the stat's width, whole in its tooltip. */
const PlayerName = ({ name }: Readonly<{ name: string }>) => (
  <span className="block max-w-[11rem] truncate" title={name}>
    {name}
  </span>
);

/**
 * Overwatch's headline figures of the character comparison (the `characterCompareSummary` slot), over the players
 * the board ranks: the sample floor leaves the same players out of both.
 */
const CharacterCompareSummary = (props: CharacterCompareProps) => {
  const t = useTranslations();
  const { character, minGames } = props;
  const { rows } = useCharacterLeaderboard(props);
  const ranked = atSampleFloor(rows, minGames);

  const signatureKey = getSignatureKey(characterClass(character));
  const sigDef = COL[signatureKey];
  const signatureLabel = SIGNATURE_LABEL[signatureKey as keyof typeof SIGNATURE_LABEL];
  const topSig = ranked.length ? ranked.reduce((best, r) => (sigDef.getValue(r) > sigDef.getValue(best) ? r : best)) : undefined;
  const bestKd = ranked.length ? ranked.reduce((best, r) => (r.kd > best.kd ? r : best)) : undefined;

  const rankedSub = !character
    ? t("users.heroesCompare.hero.pickToRank")
    : minGames > 1
      ? t("users.heroesCompare.hero.rankedOf", { min: minGames, total: rows.length })
      : t("users.heroesCompare.hero.withLoggedTime", { name: character.name });

  return (
    <div className="flex flex-wrap gap-x-7 gap-y-4 lg:justify-end">
      <HeroStat label={t("users.heroesCompare.hero.playersRanked")} value={ranked.length || "—"} sub={rankedSub} />
      <HeroStat
        label={t("users.heroesCompare.hero.topStat", { stat: t(signatureLabel) })}
        value={
          topSig ? (
            <>
              {sigDef.formatValue(sigDef.getValue(topSig))}
              <span className="ml-1 text-label font-semibold text-[color:var(--aqt-fg-dim)]">/ 10</span>
            </>
          ) : (
            "—"
          )
        }
        sub={topSig ? <PlayerName name={topSig.username} /> : undefined}
      />
      <HeroStat
        label={t("users.heroesCompare.hero.bestKd")}
        value={bestKd ? COL.kd.formatValue(bestKd.kd) : "—"}
        sub={bestKd ? <PlayerName name={bestKd.username} /> : undefined}
      />
    </div>
  );
};

export default CharacterCompareSummary;
